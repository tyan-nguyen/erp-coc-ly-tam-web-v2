import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import {
  canConfirmShipment,
  canCreateShipment,
  canViewShipment,
  isAdminRole,
} from '@/lib/auth/roles'
import { writeAuditLog } from '@/lib/audit-log/write'
import { loadDonHangList } from '@/lib/don-hang/repository'
import type { AvailableSegmentOption } from '@/lib/san-xuat/types'
import { buildStockIdentityKey } from '@/lib/ton-kho-thanh-pham/internal'
import {
  loadFinishedGoodsCurrentInventoryRows,
  loadFinishedGoodsProjectPoolByBucket,
} from '@/lib/ton-kho-thanh-pham/repository'

type AnySupabase = SupabaseClient

type RawVoucherLine = {
  lineId: string
  itemLabel: string
  templateId: string | null
  maCoc: string | null
  loaiCoc: string
  tenDoan: string
  chieuDaiM: number
  originalItemLabel: string | null
  originalLoaiCoc: string | null
  originalTenDoan: string | null
  originalChieuDaiM: number | null
  isSubstituted: boolean
  substitutionReason: string | null
  bocId: string | null
  requestedQty: number
  actualQty: number
  availableQtySnapshot: number
  unitPriceSnapshot: number | null
  lineTotalSnapshot: number | null
  orderSourceKey: string | null
  stockSourceKey: string
  orderId: string | null
  maOrder: string | null
  quoteId: string | null
  maBaoGia: string | null
  customerId: string | null
  customerName: string | null
  projectId: string | null
  projectName: string | null
  sourceType: 'DON_HANG' | 'TON_KHO'
}

type RawVoucherConfirmedSerial = {
  lineId: string
  serialId: string
  serialCode: string
  orderSourceKey: string | null
  stockSourceKey: string
}

type RawReturnedSerial = {
  returnSerialId: string
  serialId: string
  serialCode: string
  lineId: string
  orderSourceKey: string | null
  stockSourceKey: string
  resolutionStatus: 'NHAP_DU_AN' | 'NHAP_KHACH_LE' | 'HUY'
  note: string
}

async function writeShipmentReopenAudit(
  supabase: AnySupabase,
  input: {
    entityType: 'PHIEU_XUAT_BAN' | 'PHIEU_XUAT_BAN_RETURN_REQUEST'
    entityId: string
    actorId: string
    reopenedFromStatus?: string | null
    reopenedToStatus?: string | null
    result: 'REOPENED' | 'BLOCKED'
    blockedDownstreamType?: string | null
    note: string
  }
) {
  await writeAuditLog(supabase, {
    action: 'REOPEN',
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    beforeJson: input.reopenedFromStatus ? { reopened_from_status: input.reopenedFromStatus } : null,
    afterJson: input.reopenedToStatus ? { reopened_to_status: input.reopenedToStatus } : null,
    summaryJson: {
      result: input.result,
      blocked_downstream_type: input.blockedDownstreamType || null,
    },
    note: input.note,
  })
}

export type XuatHangSourceMode = 'DON_HANG' | 'TON_KHO'
export type XuatHangStatus = 'CHO_XAC_NHAN' | 'DA_XUAT' | 'XUAT_MOT_PHAN'

export type XuatHangCustomerOption = {
  khId: string
  tenKh: string
}

export type XuatHangQuoteOption = {
  quoteId: string
  maBaoGia: string
  customerId: string
  customerName: string
  projectId: string
  projectName: string
  orderIds: string[]
  orderLabels: string[]
  totalPrice: number | null
}

export type XuatHangSourceLine = {
  sourceKey: string
  mode: XuatHangSourceMode
  bocId: string | null
  orderId: string | null
  maOrder: string | null
  quoteId: string | null
  maBaoGia: string | null
  customerId: string | null
  customerName: string | null
  projectId: string | null
  projectName: string | null
  templateId: string | null
  maCoc: string | null
  loaiCoc: string
  tenDoan: string
  chieuDaiM: number
  itemLabel: string
  orderedQty: number
  acceptedQty: number
  shippedQty: number
  physicalQty: number
  availableQty: number
  reservedQty: number
  reservedByVouchers: Array<{
    voucherId: string
    maPhieu: string
    requestedQty: number
    customerName: string | null
    projectName: string | null
    createdAt: string
  }>
  unitPriceRef: number | null
  stockSourceKey: string
  orderSourceKey: string | null
}

export type XuatHangVoucherListItem = {
  voucherId: string
  maPhieu: string
  sourceType: XuatHangSourceMode
  status: XuatHangStatus
  customerName: string | null
  projectName: string | null
  orderLabel: string | null
  requestedQtyTotal: number
  actualQtyTotal: number
  operationDate: string | null
  createdAt: string
  hasReturnData?: boolean
  detail?: XuatHangVoucherDetail | null
}

export type XuatHangVoucherDetail = {
  voucherId: string
  maPhieu: string
  sourceType: XuatHangSourceMode
  status: XuatHangStatus
  customerName: string | null
  projectName: string | null
  orderLabel: string | null
  quoteLabel: string | null
  note: string
  locked: boolean
  lines: RawVoucherLine[]
  confirmedSerials: RawVoucherConfirmedSerial[]
  returnedSerials: RawReturnedSerial[]
  availableShipmentSerials: XuatHangAvailableShipmentSerial[]
  returnRequest: XuatHangReturnRequest | null
  returnFeatureReady: boolean
  requestedQtyTotal: number
  actualQtyTotal: number
  canSoftReopenReturnRequest: boolean
  canAdminReopenShipment: boolean
}

export type XuatHangReturnRequestLine = {
  lineId: string
  requestedQty: number
}

export type XuatHangReturnRequest = {
  status: 'PENDING' | 'COMPLETED'
  note: string
  requestedQtyTotal: number
  requestedLines: XuatHangReturnRequestLine[]
  requestedAt: string | null
  requestedBy: string | null
  completedAt: string | null
  completedBy: string | null
}

export type ShipmentSerialScanResult = {
  serialId: string
  serialCode: string
  lineId: string
  itemLabel: string
  stockSourceKey: string
}

export type XuatHangAvailableShipmentSerial = {
  serialId: string
  serialCode: string
  lineId: string
  itemLabel: string
  stockSourceKey: string
}

export type ShipmentReturnResult = {
  returnVoucherId: string
  processedCount: number
}

export type ShipmentReturnRequestResult = {
  requestedCount: number
}

export type ShipmentReopenResult = {
  status: XuatHangStatus
  revertedCount?: number
}

export type DeleteXuatHangVoucherResult = {
  deletedCount: number
}

export type XuatHangPageData = {
  customers: XuatHangCustomerOption[]
  quoteOptions: XuatHangQuoteOption[]
  orderSources: XuatHangSourceLine[]
  stockSources: XuatHangSourceLine[]
  vouchers: XuatHangVoucherListItem[]
}

export type XuatHangCreateBootstrap = Omit<XuatHangPageData, 'vouchers'>
export type XuatHangCreateBootstrapMode = 'DON_HANG' | 'TON_KHO' | 'ALL'

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round3(value: number) {
  const rounded = Math.round(Number(value || 0) * 1000) / 1000
  return Number.isFinite(rounded) ? rounded : 0
}

function deriveStockSegmentGroup(tenDoan: string) {
  const normalized = normalizeText(tenDoan).toUpperCase()
  if (normalized === 'MUI') return 'MUI'
  if (normalized.startsWith('THAN')) return 'THAN'
  return normalizeText(tenDoan)
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function makeVoucherCode(voucherId: string) {
  return `PX-${String(voucherId || '').slice(-6).toUpperCase()}`
}

function buildItemLabel(loaiCoc: string, tenDoan: string, chieuDaiM: number, maCoc?: string | null) {
  return `${normalizeText(maCoc) || loaiCoc} | ${tenDoan} | ${formatNumber(chieuDaiM)}m`
}

function buildStockItemLabel(loaiCoc: string, tenDoan: string, chieuDaiM: number, maCoc?: string | null) {
  return `${normalizeText(maCoc) || loaiCoc} | ${deriveStockSegmentGroup(tenDoan)} | ${formatNumber(chieuDaiM)}m`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0))
}

function buildShipmentIdentityKey(input: { templateId?: string | null; maCoc?: string | null; loaiCoc: string }) {
  return buildStockIdentityKey(input)
}

function buildLegacyShipmentKey(loaiCoc: string, tenDoan: string, chieuDaiM: number) {
  return `${normalizeText(loaiCoc)}::${deriveStockSegmentGroup(normalizeText(tenDoan))}::${round3(chieuDaiM)}`
}

function buildOrderSourceKey(
  orderId: string,
  identity: { templateId?: string | null; maCoc?: string | null; loaiCoc: string },
  tenDoan: string,
  chieuDaiM: number
) {
  return `${orderId}::${buildShipmentIdentityKey(identity)}::${tenDoan}::${round3(chieuDaiM)}`
}

export async function loadNetDeliveredTotalsByOrderSegment(supabase: AnySupabase) {
  const totals = new Map<string, number>()
  const voucherRows = await loadShipmentVoucherRows(supabase)
  const voucherIds = voucherRows.map((row) => String(row.voucher_id || '')).filter(Boolean)
  const [confirmedInfoByVoucher, returnedInfo] = await Promise.all([
    loadConfirmedSerialsByVoucher(supabase, voucherIds),
    loadReturnedSerialsByVoucher(supabase, voucherIds),
  ])

  for (const row of voucherRows) {
    const detail = buildVoucherDetail(row)
    if (detail.status === 'CHO_XAC_NHAN') continue

    const lineMetaById = new Map(
      detail.lines.map((item) => [
        item.lineId,
        {
          orderSourceKey: item.orderSourceKey || null,
        },
      ])
    )

    const confirmedSerials =
      confirmedInfoByVoucher.get(detail.voucherId)?.length
        ? confirmedInfoByVoucher.get(detail.voucherId) || []
        : detail.confirmedSerials
    const returnedSerials =
      returnedInfo.byVoucher.get(detail.voucherId)?.length
        ? returnedInfo.byVoucher.get(detail.voucherId) || []
        : detail.returnedSerials

    const confirmedCountByLine = new Map<string, number>()
    for (const item of confirmedSerials) {
      const lineId = resolveVoucherLineId(item.lineId, detail.lines)
      if (!lineId) continue
      confirmedCountByLine.set(lineId, (confirmedCountByLine.get(lineId) ?? 0) + 1)
    }

    const returnedCountByLine = new Map<string, number>()
    for (const item of returnedSerials) {
      const lineId = resolveVoucherLineId(item.lineId, detail.lines)
      if (!lineId) continue
      returnedCountByLine.set(lineId, (returnedCountByLine.get(lineId) ?? 0) + 1)
    }

    for (const line of detail.lines) {
      const lineId = resolveVoucherLineId(line.lineId, detail.lines)
      const orderSourceKey = lineMetaById.get(lineId)?.orderSourceKey || line.orderSourceKey || null
      if (!orderSourceKey) continue

      const shippedQty = confirmedCountByLine.has(lineId) ? confirmedCountByLine.get(lineId) ?? 0 : toNumber(line.actualQty)
      const returnedQty = returnedCountByLine.get(lineId) ?? 0
      const netDeliveredQty = Math.max(round3(shippedQty - returnedQty), 0)
      if (netDeliveredQty <= 0) continue

      totals.set(orderSourceKey, round3((totals.get(orderSourceKey) ?? 0) + netDeliveredQty))
    }
  }

  return totals
}

function buildQuoteAccessorySourceKey(quoteId: string, key: string) {
  return `${quoteId}::ACCESSORY::${key}`
}

function buildStockSourceKey(
  identity: { templateId?: string | null; maCoc?: string | null; loaiCoc: string },
  tenDoan: string,
  chieuDaiM: number
) {
  return `${buildShipmentIdentityKey(identity)}::${deriveStockSegmentGroup(normalizeText(tenDoan))}::${round3(chieuDaiM)}`
}

function buildExactShipmentItemKey(
  identity: { templateId?: string | null; maCoc?: string | null; loaiCoc: string },
  tenDoan: string,
  chieuDaiM: number
) {
  return `${buildShipmentIdentityKey(identity)}::${normalizeText(tenDoan)}::${round3(chieuDaiM)}`
}

function normalizeShipmentStockSourceKey(line: {
  stockSourceKey?: string | null
  templateId?: string | null
  maCoc?: string | null
  loaiCoc?: string | null
  tenDoan?: string | null
  chieuDaiM?: number | null
}) {
  const rebuilt = buildStockSourceKey(
    {
      templateId: String(line.templateId || ''),
      maCoc: String(line.maCoc || ''),
      loaiCoc: String(line.loaiCoc || ''),
    },
    String(line.tenDoan || ''),
    round3(toNumber(line.chieuDaiM))
  )
  return rebuilt || normalizeText(line.stockSourceKey)
}

function parseOrderSegments(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as Array<{
      templateId?: string | null
      maCoc?: string | null
      doanKey: string
      tenDoan: string
      chieuDaiM: number
      soLuongDat: number
    }>
  }

  return raw
    .map((segment, index) => {
      if (!segment || typeof segment !== 'object') return null
      const row = segment as Record<string, unknown>
      const tenDoan =
        normalizeText(row.ten_doan) ||
        normalizeText(row.tenDoan) ||
        normalizeText(row.name) ||
        `Đoạn ${index + 1}`
      const doanKey = normalizeText(row.doan_key) || normalizeText(row.doanKey) || tenDoan
      const chieuDaiM =
        toNumber(row.len_m, NaN) ||
        toNumber(row.chieu_dai_m, NaN) ||
        toNumber(row.length_m, NaN) ||
        0
      const soLuongDat =
        toNumber(row.so_luong_doan, NaN) ||
        toNumber(row.so_luong, NaN) ||
        toNumber(row.cnt, NaN) ||
        0

      return {
        templateId: normalizeText(row.template_id) || null,
        maCoc: normalizeText(row.ma_coc) || null,
        doanKey,
        tenDoan,
        chieuDaiM,
        soLuongDat,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

async function loadCustomerMap(supabase: AnySupabase) {
  const { data, error } = await supabase.from('dm_kh').select('kh_id, ten_kh').order('ten_kh')
  if (error) throw error
  return new Map((data ?? []).map((row) => [String(row.kh_id), String(row.ten_kh || row.kh_id)]))
}

async function loadShipmentVoucherRows(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('phieu_xuat_ban')
    .select('voucher_id, source_type, trang_thai, ngay_thao_tac, kh_id, da_id, order_id, quote_id, ghi_chu, payload_json, is_active, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('phieu_xuat_ban')) ||
      (message.includes('schema cache') && message.includes('phieu_xuat_ban'))
    ) {
      return [] as Array<Record<string, unknown>>
    }
    throw error
  }

  return (data ?? []) as Array<Record<string, unknown>>
}

async function loadReturnedSerialsByVoucher(supabase: AnySupabase, voucherIds: string[]) {
  if (!voucherIds.length) {
    return {
      featureReady: true,
      byVoucher: new Map<string, RawReturnedSerial[]>(),
    }
  }

  const { data, error } = await supabase
    .from('return_voucher_serial')
    .select('return_serial_id, shipment_voucher_id, serial_id, resolution_status, note')
    .in('shipment_voucher_id', voucherIds)
    .order('created_at', { ascending: true })

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('relation') && message.includes('return_voucher_serial')) {
      return {
        featureReady: false,
        byVoucher: new Map<string, RawReturnedSerial[]>(),
      }
    }
    throw error
  }

  const baseRows = safeArray<Record<string, unknown>>(data)
  const serialIds = Array.from(new Set(baseRows.map((row) => String(row.serial_id || '')).filter(Boolean)))
  const serialMetaById = new Map<
    string,
    { serialCode: string; orderSourceKey: string | null; stockSourceKey: string }
  >()
  if (serialIds.length) {
    const { data: serialRows, error: serialError } = await supabase
      .from('pile_serial')
      .select('serial_id, serial_code, order_id, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m')
      .in('serial_id', serialIds)
      .eq('is_active', true)
    if (serialError) throw serialError
    for (const row of safeArray<Record<string, unknown>>(serialRows)) {
      const serialId = String(row.serial_id || '')
      const loaiCoc = String(row.loai_coc || '')
      const tenDoan = String(row.ten_doan || '')
      const chieuDaiM = toNumber(row.chieu_dai_m)
      const identity = {
        templateId: String(row.template_id || ''),
        maCoc: String(row.ma_coc || ''),
        loaiCoc,
      }
      serialMetaById.set(serialId, {
        serialCode: String(row.serial_code || ''),
        orderSourceKey: row.order_id ? buildOrderSourceKey(String(row.order_id), identity, tenDoan, chieuDaiM) : null,
        stockSourceKey: buildStockSourceKey(identity, tenDoan, chieuDaiM),
      })
    }
  }
  const lineIdByVoucherSerial = new Map<string, string>()
  if (voucherIds.length && serialIds.length) {
    const { data: shipmentRows, error: shipmentError } = await supabase
      .from('shipment_voucher_serial')
      .select('voucher_id, voucher_line_id, serial_id')
      .in('voucher_id', voucherIds)
      .in('serial_id', serialIds)
    if (shipmentError) throw shipmentError
    for (const row of safeArray<Record<string, unknown>>(shipmentRows)) {
      const voucherId = String(row.voucher_id || '')
      const serialId = String(row.serial_id || '')
      if (!voucherId || !serialId) continue
      lineIdByVoucherSerial.set(`${voucherId}::${serialId}`, String(row.voucher_line_id || ''))
    }
  }

  const byVoucher = new Map<string, RawReturnedSerial[]>()
  for (const row of baseRows) {
    const voucherId = String(row.shipment_voucher_id || '')
    const current = byVoucher.get(voucherId) || []
    const serialMeta = serialMetaById.get(String(row.serial_id || ''))
    current.push({
      returnSerialId: String(row.return_serial_id || ''),
      serialId: String(row.serial_id || ''),
      serialCode: serialMeta?.serialCode || '',
      lineId: lineIdByVoucherSerial.get(`${voucherId}::${String(row.serial_id || '')}`) || '',
      orderSourceKey: serialMeta?.orderSourceKey || null,
      stockSourceKey: serialMeta?.stockSourceKey || '',
      resolutionStatus: (String(row.resolution_status || '') === 'NHAP_KHACH_LE'
        ? 'NHAP_KHACH_LE'
        : String(row.resolution_status || '') === 'HUY'
          ? 'HUY'
          : 'NHAP_DU_AN') as RawReturnedSerial['resolutionStatus'],
      note: String(row.note || ''),
    })
    byVoucher.set(voucherId, current)
  }

  return { featureReady: true, byVoucher }
}

async function loadReturnedVoucherIdSet(supabase: AnySupabase, voucherIds: string[]) {
  if (!voucherIds.length) return new Set<string>()

  const { data, error } = await supabase
    .from('return_voucher_serial')
    .select('shipment_voucher_id')
    .in('shipment_voucher_id', voucherIds)

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('relation') && message.includes('return_voucher_serial')) {
      return new Set<string>()
    }
    throw error
  }

  return new Set(
    safeArray<Record<string, unknown>>(data)
      .map((row) => normalizeText(row.shipment_voucher_id))
      .filter(Boolean)
  )
}

async function loadConfirmedSerialsByVoucher(supabase: AnySupabase, voucherIds: string[]) {
  if (!voucherIds.length) {
    return new Map<string, RawVoucherConfirmedSerial[]>()
  }

  const { data, error } = await supabase
    .from('shipment_voucher_serial')
    .select('voucher_id, voucher_line_id, serial_id')
    .in('voucher_id', voucherIds)
    .order('created_at', { ascending: true })

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('relation') && message.includes('shipment_voucher_serial')) {
      return new Map<string, RawVoucherConfirmedSerial[]>()
    }
    throw error
  }

  const baseRows = safeArray<Record<string, unknown>>(data)
  const serialIds = Array.from(new Set(baseRows.map((row) => String(row.serial_id || '')).filter(Boolean)))
  const serialMetaById = new Map<
    string,
    { serialCode: string; orderSourceKey: string | null; stockSourceKey: string }
  >()
  if (serialIds.length) {
    const { data: serialRows, error: serialError } = await supabase
      .from('pile_serial')
      .select('serial_id, serial_code, order_id, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m')
      .in('serial_id', serialIds)
      .eq('is_active', true)
    if (serialError) throw serialError
    for (const row of safeArray<Record<string, unknown>>(serialRows)) {
      const serialId = String(row.serial_id || '')
      const loaiCoc = String(row.loai_coc || '')
      const tenDoan = String(row.ten_doan || '')
      const chieuDaiM = toNumber(row.chieu_dai_m)
      const identity = {
        templateId: String(row.template_id || ''),
        maCoc: String(row.ma_coc || ''),
        loaiCoc,
      }
      serialMetaById.set(serialId, {
        serialCode: String(row.serial_code || ''),
        orderSourceKey: row.order_id ? buildOrderSourceKey(String(row.order_id), identity, tenDoan, chieuDaiM) : null,
        stockSourceKey: buildStockSourceKey(identity, tenDoan, chieuDaiM),
      })
    }
  }

  const byVoucher = new Map<string, RawVoucherConfirmedSerial[]>()
  for (const row of baseRows) {
    const voucherId = String(row.voucher_id || '')
    const current = byVoucher.get(voucherId) || []
    const serialMeta = serialMetaById.get(String(row.serial_id || ''))
    current.push({
      lineId: String(row.voucher_line_id || ''),
      serialId: String(row.serial_id || ''),
      serialCode: serialMeta?.serialCode || '',
      orderSourceKey: serialMeta?.orderSourceKey || null,
      stockSourceKey: serialMeta?.stockSourceKey || '',
    })
    byVoucher.set(voucherId, current)
  }
  return byVoucher
}

async function loadReturnedSourceRows(
  supabase: AnySupabase,
  orders: Awaited<ReturnType<typeof loadDonHangList>>
) {
  const { data, error } = await supabase
    .from('return_voucher_serial')
    .select('serial_id, resolution_status, visible_in_project, visible_in_retail')
    .order('created_at', { ascending: true })

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('relation') && message.includes('return_voucher_serial')) {
      return [] as XuatHangSourceLine[]
    }
    throw error
  }

  const baseRows = safeArray<Record<string, unknown>>(data)
  const serialIds = Array.from(new Set(baseRows.map((row) => String(row.serial_id || '')).filter(Boolean)))
  const { data: serialRows, error: serialError } = serialIds.length
    ? await supabase
        .from('pile_serial')
        .select('serial_id, order_id, boc_id, quote_id, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m')
        .in('serial_id', serialIds)
        .eq('is_active', true)
    : { data: [], error: null }
  if (serialError) throw serialError

  const serialById = new Map(
    safeArray<Record<string, unknown>>(serialRows).map((row) => [String(row.serial_id || ''), row])
  )
  const orderMap = new Map(orders.map((item) => [item.order.order_id, item]))
  const rows: XuatHangSourceLine[] = []
  for (const row of baseRows) {
    const pileSerial = serialById.get(String(row.serial_id || '')) || {}
    const orderId = String(pileSerial.order_id || '')
    const order = orderMap.get(orderId)
    const loaiCoc = String(pileSerial.loai_coc || order?.order.loai_coc || '-')
    const tenDoan = String(pileSerial.ten_doan || '-')
    const chieuDaiM = toNumber(pileSerial.chieu_dai_m)
    const identity = {
      templateId: String(pileSerial.template_id || ''),
      maCoc: String(pileSerial.ma_coc || ''),
      loaiCoc,
    }
    const stockSourceKey = buildStockSourceKey(identity, tenDoan, chieuDaiM)
    const orderSourceKey = orderId ? buildOrderSourceKey(orderId, identity, tenDoan, chieuDaiM) : null
    const resolutionStatus = String(row.resolution_status || '')
    const visibleInProject =
      row.visible_in_project == null ? resolutionStatus === 'NHAP_DU_AN' : Boolean(row.visible_in_project)
    const visibleInRetail =
      row.visible_in_retail == null
        ? resolutionStatus === 'NHAP_DU_AN' || resolutionStatus === 'NHAP_KHACH_LE'
        : Boolean(row.visible_in_retail)

    if (visibleInProject && orderSourceKey) {
      rows.push({
        sourceKey: orderSourceKey,
        mode: 'DON_HANG',
        bocId: String(pileSerial.boc_id || order?.order.boc_id || '') || null,
        orderId: orderId || null,
        maOrder: order?.order.ma_order || null,
        quoteId: String(pileSerial.quote_id || order?.linkedQuote.quoteId || '') || null,
        maBaoGia: order?.linkedQuote.maBaoGia || null,
        customerId: order?.order.kh_id || null,
        customerName: order?.khachHangName || null,
        projectId: order?.order.da_id || null,
        projectName: order?.duAnName || null,
        templateId: identity.templateId || null,
        maCoc: identity.maCoc || null,
        loaiCoc,
        tenDoan,
        chieuDaiM,
        itemLabel: buildItemLabel(loaiCoc, tenDoan, chieuDaiM, identity.maCoc),
        orderedQty: 0,
        acceptedQty: 1,
        shippedQty: 0,
        physicalQty: 1,
        availableQty: 1,
        reservedQty: 0,
        reservedByVouchers: [],
        unitPriceRef: null,
        stockSourceKey,
        orderSourceKey,
      })
      continue
    }

    if (visibleInRetail) {
      rows.push({
        sourceKey: stockSourceKey,
        mode: 'TON_KHO',
        bocId: String(pileSerial.boc_id || order?.order.boc_id || '') || null,
        orderId: null,
        maOrder: null,
        quoteId: null,
        maBaoGia: null,
        customerId: null,
        customerName: null,
        projectId: null,
        projectName: null,
        templateId: identity.templateId || null,
        maCoc: identity.maCoc || null,
        loaiCoc,
        tenDoan,
        chieuDaiM,
        itemLabel: buildItemLabel(loaiCoc, tenDoan, chieuDaiM, identity.maCoc),
        orderedQty: 0,
        acceptedQty: 1,
        shippedQty: 0,
        physicalQty: 1,
        availableQty: 1,
        reservedQty: 0,
        reservedByVouchers: [],
        unitPriceRef: null,
        stockSourceKey,
        orderSourceKey: null,
      })
    }
  }

  return rows
}

async function loadLatestQuoteProductRows(supabase: AnySupabase, quoteIds: string[]) {
  if (!quoteIds.length) return new Map<string, Array<Record<string, unknown>>>()

  const { data, error } = await supabase
    .from('bao_gia_version')
    .select('quote_id, version_no, snapshot_json')
    .in('quote_id', quoteIds)
    .order('version_no', { ascending: false })

  if (error) throw error

  const latestByQuote = new Map<string, Record<string, unknown>>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const quoteId = String(row.quote_id || '')
    if (!quoteId || latestByQuote.has(quoteId)) continue
    latestByQuote.set(quoteId, row)
  }

  const rowsByQuote = new Map<string, Array<Record<string, unknown>>>()
  for (const [quoteId, row] of latestByQuote.entries()) {
    const snapshot = (row.snapshot_json as Record<string, unknown> | null) || {}
    rowsByQuote.set(quoteId, safeArray<Record<string, unknown>>(snapshot.productRows))
  }

  return rowsByQuote
}

async function loadQuoteUnitPriceMapByBocId(supabase: AnySupabase, approvedSegments: AvailableSegmentOption[]) {
  const quoteIds = Array.from(new Set(approvedSegments.map((item) => String(item.quoteId || '')).filter(Boolean)))
  const productRowsByQuote = await loadLatestQuoteProductRows(supabase, quoteIds)

  const priceByBocId = new Map<string, number>()
  for (const segment of approvedSegments) {
    const bocId = String(segment.bocId || '')
    const quoteId = String(segment.quoteId || '')
    if (!bocId || !quoteId) continue
    const productRows = productRowsByQuote.get(quoteId) || []
    const pileRow = productRows.find((row) => String(row.kind || '') === 'pile' && String(row.key || '') === bocId)
    if (!pileRow) continue
    const unitPriceVat = toNumber(pileRow.unitPriceVat)
    const unitPrice = toNumber(pileRow.unitPrice)
    const effective = unitPriceVat > 0 ? unitPriceVat : unitPrice
    if (effective > 0) {
      priceByBocId.set(bocId, effective)
    }
  }

  return priceByBocId
}

function buildShipmentOrderSegments(orders: Awaited<ReturnType<typeof loadDonHangList>>) {
  return orders.flatMap((item) =>
    parseOrderSegments(item.order.to_hop_doan)
      .filter((segment) => Number(segment.soLuongDat || 0) > 0)
      .map((segment) => ({
        orderId: item.order.order_id,
        bocId: item.order.boc_id || null,
        quoteId: item.linkedQuote.quoteId,
        maOrder: item.order.ma_order || item.order.order_id,
        maBaoGia: item.linkedQuote.maBaoGia,
        khachHang: item.khachHangName || item.order.kh_id,
        duAn: item.duAnName || item.order.da_id,
        templateId: segment.templateId || null,
        maCoc: segment.maCoc || null,
        loaiCoc: item.order.loai_coc,
        doanKey: segment.doanKey,
        tenDoan: segment.tenDoan,
        chieuDaiM: Number(segment.chieuDaiM || 0),
        soLuongDat: Number(segment.soLuongDat || 0),
        soLuongDaSanXuat: 0,
        soLuongDaLenKeHoach: 0,
        soLuongConLaiTam: 0,
      } satisfies AvailableSegmentOption))
  )
}

async function loadQcAcceptedSourceRows(
  supabase: AnySupabase,
  options: {
    includeRetailSources?: boolean
  } = {}
) {
  const includeRetailSources = options.includeRetailSources ?? true
  const [{ data: qcRows, error: qcError }, orders] = await Promise.all([
    supabase.from('sx_qc_nghiem_thu').select('plan_id, payload_json').eq('is_active', true),
    loadDonHangList(supabase, {
      viewerRole: 'qlsx',
    }),
  ])

  if (qcError) throw qcError

  const today = formatLocalDate(new Date())
  const planIds = Array.from(
    new Set(((qcRows ?? []) as Array<Record<string, unknown>>).map((row) => String(row.plan_id || '')).filter(Boolean))
  )
  const validPlanIds = new Set<string>()

  if (planIds.length) {
    const { data: planRows, error: planError } = await supabase
      .from('ke_hoach_sx_ngay')
      .select('plan_id, ngay_ke_hoach')
      .in('plan_id', planIds)
      .eq('is_active', true)

    if (planError) throw planError
    for (const row of safeArray<Record<string, unknown>>(planRows)) {
      const planId = String(row.plan_id || '')
      const planDate = String(row.ngay_ke_hoach || '')
      if (planId && planDate && planDate <= today) {
        validPlanIds.add(planId)
      }
    }
  }

  const lineMap = new Map<string, Record<string, unknown>>()
  if (validPlanIds.size) {
    const { data: lineRows, error: lineError } = await supabase
      .from('ke_hoach_sx_line')
      .select('line_id, plan_id, order_id, boc_id, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m, so_luong_dat')
      .in('plan_id', Array.from(validPlanIds))
      .eq('is_active', true)

    if (lineError) throw lineError
    for (const row of (lineRows ?? []) as Array<Record<string, unknown>>) {
      if (!validPlanIds.has(String(row.plan_id || ''))) continue
      lineMap.set(String(row.line_id || ''), row)
    }
  }

  const orderMap = new Map(orders.map((item) => [item.order.order_id, item]))
  const acceptedRows: XuatHangSourceLine[] = []
  const serialManagedLineIds = new Set<string>()
  const retailQtyByLineFromPileSerial = new Map<string, number>()

  let serialQuery = supabase
    .from('pile_serial')
    .select(
      'serial_id, template_id, ma_coc, qc_status, disposition_status, loai_coc, ten_doan, chieu_dai_m, production_lot!inner(plan_line_id, order_id, boc_id, quote_id)'
    )
    .eq('is_active', true)
  serialQuery = includeRetailSources ? serialQuery.in('qc_status', ['DAT', 'LOI']) : serialQuery.eq('qc_status', 'DAT')
  const { data: serialRows, error: serialError } = await serialQuery

  if (serialError) {
    const message = String(serialError.message || '').toLowerCase()
    if (!(message.includes('relation') && message.includes('pile_serial'))) {
      throw serialError
    }
  }
  const serialTableReady = !serialError

  for (const row of safeArray<Record<string, unknown>>(serialRows)) {
    const lot = (row.production_lot as Record<string, unknown> | null) || {}
    const lineId = String(lot.plan_line_id || '')
    if (lineId && !lineMap.has(lineId)) continue
    if (lineId) {
      serialManagedLineIds.add(lineId)
    }

    const orderId = String(lot.order_id || '')
    const order = orderMap.get(orderId)
    const loaiCoc = String(row.loai_coc || lot.loai_coc || order?.order.loai_coc || '-')
    const tenDoan = String(row.ten_doan || lot.ten_doan || '-')
    const chieuDaiM = toNumber(row.chieu_dai_m ?? lot.chieu_dai_m)
    const identity = {
      templateId: String(row.template_id || lot.template_id || ''),
      maCoc: String(row.ma_coc || lot.ma_coc || ''),
      loaiCoc,
    }
    const stockSourceKey = buildStockSourceKey(identity, tenDoan, chieuDaiM)
    const orderSourceKey = orderId ? buildOrderSourceKey(orderId, identity, tenDoan, chieuDaiM) : null
    const bocId = String(lot.boc_id || order?.order.boc_id || '') || null
    const quoteId = String(lot.quote_id || order?.linkedQuote.quoteId || '') || null
    const qcStatus = String(row.qc_status || '')
    const dispositionStatus = String(row.disposition_status || '')

    if (qcStatus === 'DAT') {
      acceptedRows.push({
        sourceKey: orderSourceKey || stockSourceKey,
        mode: orderSourceKey ? 'DON_HANG' : 'TON_KHO',
        bocId,
        orderId: orderId || null,
        maOrder: order?.order.ma_order || null,
        quoteId,
        maBaoGia: order?.linkedQuote.maBaoGia || null,
        customerId: order?.order.kh_id || null,
        customerName: order?.khachHangName || null,
        projectId: order?.order.da_id || null,
        projectName: order?.duAnName || null,
        templateId: identity.templateId || null,
        maCoc: identity.maCoc || null,
        loaiCoc,
        tenDoan,
        chieuDaiM,
        itemLabel: buildItemLabel(loaiCoc, tenDoan, chieuDaiM, identity.maCoc),
        orderedQty: 0,
        acceptedQty: 1,
        shippedQty: 0,
        physicalQty: 1,
        availableQty: 1,
        reservedQty: 0,
        reservedByVouchers: [],
        unitPriceRef: null,
        stockSourceKey,
        orderSourceKey,
      })
      continue
    }

    if (includeRetailSources && qcStatus === 'LOI' && dispositionStatus === 'THANH_LY') {
      if (lineId) {
        retailQtyByLineFromPileSerial.set(lineId, round3((retailQtyByLineFromPileSerial.get(lineId) ?? 0) + 1))
      }
      acceptedRows.push({
        sourceKey: stockSourceKey,
        mode: 'TON_KHO',
        bocId,
        orderId: null,
        maOrder: null,
        quoteId: null,
        maBaoGia: null,
        customerId: null,
        customerName: null,
        projectId: null,
        projectName: null,
        templateId: identity.templateId || null,
        maCoc: identity.maCoc || null,
        loaiCoc,
        tenDoan,
        chieuDaiM,
        itemLabel: buildItemLabel(loaiCoc, tenDoan, chieuDaiM, identity.maCoc),
        orderedQty: 0,
        acceptedQty: 1,
        shippedQty: 0,
        physicalQty: 1,
        availableQty: 1,
        reservedQty: 0,
        reservedByVouchers: [],
        unitPriceRef: null,
        stockSourceKey,
        orderSourceKey: null,
      })
    }
  }

  for (const qcRow of (qcRows ?? []) as Array<Record<string, unknown>>) {
    if (!validPlanIds.has(String(qcRow.plan_id || ''))) continue
    const payload = (qcRow.payload_json as Record<string, unknown> | null) || {}
    const lineResults = safeArray<Record<string, unknown>>(payload.lineResults)
    const serialResults = safeArray<Record<string, unknown>>(payload.serialResults)
    const acceptedQtyByLineFromSerial = new Map<string, number>()
    const retailQtyByLineFromSerial = new Map<string, number>()

    for (const serial of serialResults) {
      const lineId = String(serial.lineId || '')
      if (!lineId) continue
      const qcStatus = String(serial.qcStatus || '')
      if (qcStatus === 'DAT') {
        acceptedQtyByLineFromSerial.set(lineId, round3((acceptedQtyByLineFromSerial.get(lineId) ?? 0) + 1))
        continue
      }
      const dispositionStatus = String(serial.dispositionStatus || '')
      if (includeRetailSources && qcStatus === 'LOI' && dispositionStatus === 'THANH_LY') {
        retailQtyByLineFromSerial.set(lineId, round3((retailQtyByLineFromSerial.get(lineId) ?? 0) + 1))
      }
    }

    for (const result of lineResults) {
      const lineId = String(result.lineId || '')
      const acceptedQty = acceptedQtyByLineFromSerial.has(lineId)
        ? acceptedQtyByLineFromSerial.get(lineId) ?? 0
        : toNumber(result.acceptedQty)
      const line = lineMap.get(lineId)
      if (!line) continue
      const orderId = String(line.order_id || '')
      const order = orderMap.get(orderId)
      const loaiCoc = String(line.loai_coc || order?.order.loai_coc || '-')
      const tenDoan = String(line.ten_doan || '-')
      const chieuDaiM = toNumber(line.chieu_dai_m)
      const identity = {
        templateId: String(line.template_id || ''),
        maCoc: String(line.ma_coc || ''),
        loaiCoc,
      }
      const orderSourceKey = orderId ? buildOrderSourceKey(orderId, identity, tenDoan, chieuDaiM) : null
      const stockSourceKey = buildStockSourceKey(identity, tenDoan, chieuDaiM)
      if (!serialTableReady && !serialManagedLineIds.has(lineId) && acceptedQty > 0) {
        acceptedRows.push({
          sourceKey: orderSourceKey || stockSourceKey,
          mode: orderSourceKey ? 'DON_HANG' : 'TON_KHO',
          bocId: String(line.boc_id || order?.order.boc_id || '') || null,
          orderId: orderId || null,
          maOrder: order?.order.ma_order || null,
          quoteId: order?.linkedQuote.quoteId || null,
          maBaoGia: order?.linkedQuote.maBaoGia || null,
          customerId: order?.order.kh_id || null,
          customerName: order?.khachHangName || null,
          projectId: order?.order.da_id || null,
          projectName: order?.duAnName || null,
          templateId: identity.templateId || null,
          maCoc: identity.maCoc || null,
          loaiCoc,
          tenDoan,
          chieuDaiM,
          itemLabel: buildItemLabel(loaiCoc, tenDoan, chieuDaiM, identity.maCoc),
          orderedQty: toNumber(line.so_luong_dat),
          acceptedQty,
          shippedQty: 0,
          physicalQty: acceptedQty,
          availableQty: acceptedQty,
          reservedQty: 0,
          reservedByVouchers: [],
          unitPriceRef: null,
          stockSourceKey,
          orderSourceKey,
        })
      }

      const retailQty = includeRetailSources ? retailQtyByLineFromSerial.get(lineId) ?? 0 : 0
      const retailQtyFromPileSerial = includeRetailSources ? retailQtyByLineFromPileSerial.get(lineId) ?? 0 : 0
      const retailDelta = !serialTableReady && includeRetailSources ? Math.max(round3(retailQty - retailQtyFromPileSerial), 0) : 0
      if (includeRetailSources && retailDelta > 0) {
        acceptedRows.push({
          sourceKey: stockSourceKey,
          mode: 'TON_KHO',
          bocId: String(line.boc_id || order?.order.boc_id || '') || null,
          orderId: null,
          maOrder: null,
          quoteId: null,
          maBaoGia: null,
          customerId: null,
          customerName: null,
          projectId: null,
          projectName: null,
          templateId: identity.templateId || null,
          maCoc: identity.maCoc || null,
          loaiCoc,
          tenDoan,
          chieuDaiM,
          itemLabel: buildItemLabel(loaiCoc, tenDoan, chieuDaiM, identity.maCoc),
          orderedQty: 0,
          acceptedQty: retailDelta,
          shippedQty: 0,
          physicalQty: retailDelta,
          availableQty: retailDelta,
          reservedQty: 0,
          reservedByVouchers: [],
          unitPriceRef: null,
          stockSourceKey,
          orderSourceKey: null,
        })
      }
    }
  }

  return { acceptedRows, orders }
}

function aggregateShipmentUsage(
  voucherRows: Array<Record<string, unknown>>,
  confirmedInfoByVoucher?: Map<string, RawVoucherConfirmedSerial[]>,
  returnedInfoByVoucher?: Map<string, RawReturnedSerial[]>
) {
  const orderUsage = new Map<string, number>()
  const stockUsage = new Map<string, number>()
  const orderShipped = new Map<string, number>()
  const stockShipped = new Map<string, number>()
  const orderGrossShipped = new Map<string, number>()
  const stockGrossShipped = new Map<string, number>()
  const returnedCountByOrderSource = new Map<string, number>()
  const returnedCountByStockSource = new Map<string, number>()
  const reservedByStockSource = new Map<
    string,
    Map<
      string,
      {
        voucherId: string
        maPhieu: string
        requestedQty: number
        customerName: string | null
        projectName: string | null
        createdAt: string
      }
    >
  >()

  for (const row of voucherRows) {
    const detail = buildVoucherDetail(row)
    const voucherId = String(row.voucher_id || '')
    const status = String(row.trang_thai || 'CHO_XAC_NHAN') as XuatHangStatus
    const payload = (row.payload_json as Record<string, unknown> | null) || {}
    const lines = safeArray<Record<string, unknown>>(payload.lines)
    const lineMetaById = new Map(
      detail.lines.map((item) => [
        item.lineId,
        {
          orderSourceKey: item.orderSourceKey || null,
          stockSourceKey: item.stockSourceKey || '',
        },
      ])
    )
    const confirmedSerials =
      confirmedInfoByVoucher?.get(voucherId)?.length
        ? confirmedInfoByVoucher.get(voucherId) || []
        : detail.confirmedSerials
    const confirmedLineBySerialId = new Map<string, string>()
    const confirmedMetaBySerialId = new Map<
      string,
      { lineId: string; orderSourceKey: string | null; stockSourceKey: string }
    >()
    for (const item of confirmedSerials) {
      const lineId = resolveVoucherLineId(item.lineId, detail.lines)
      if (!lineId) continue
      const lineMeta = lineMetaById.get(lineId)
      const effectiveOrderSourceKey = lineMeta?.orderSourceKey || item.orderSourceKey || null
      const effectiveStockSourceKey = item.stockSourceKey || lineMeta?.stockSourceKey || ''
      confirmedLineBySerialId.set(item.serialId, lineId)
      confirmedMetaBySerialId.set(item.serialId, {
        lineId,
        orderSourceKey: effectiveOrderSourceKey,
        stockSourceKey: effectiveStockSourceKey,
      })
    }
    const confirmedCountByLine = new Map<string, number>()
    for (const confirmedLineId of confirmedLineBySerialId.values()) {
      confirmedCountByLine.set(confirmedLineId, (confirmedCountByLine.get(confirmedLineId) ?? 0) + 1)
    }
    const returnedSerials =
      returnedInfoByVoucher?.get(voucherId)?.length
        ? returnedInfoByVoucher.get(voucherId) || []
        : detail.returnedSerials
    const returnedCountByLine = new Map<string, number>()
    for (const item of returnedSerials) {
      const confirmedMeta = confirmedMetaBySerialId.get(item.serialId)
      const lineId = resolveVoucherLineId(
        item.lineId || confirmedMeta?.lineId || confirmedLineBySerialId.get(item.serialId) || '',
        detail.lines
      )
      if (!lineId) continue
      returnedCountByLine.set(lineId, (returnedCountByLine.get(lineId) ?? 0) + 1)
      const lineMeta = lineMetaById.get(lineId)
      const effectiveOrderSourceKey = lineMeta?.orderSourceKey || confirmedMeta?.orderSourceKey || item.orderSourceKey || null
      const effectiveStockSourceKey = item.stockSourceKey || confirmedMeta?.stockSourceKey || lineMeta?.stockSourceKey || ''
      if (effectiveOrderSourceKey) {
        returnedCountByOrderSource.set(
          effectiveOrderSourceKey,
          (returnedCountByOrderSource.get(effectiveOrderSourceKey) ?? 0) + 1
        )
      }
      if (effectiveStockSourceKey) {
        returnedCountByStockSource.set(
          effectiveStockSourceKey,
          (returnedCountByStockSource.get(effectiveStockSourceKey) ?? 0) + 1
        )
      }
    }
    for (const line of lines) {
      const requestedQty = toNumber(line.requestedQty)
      const actualQty = toNumber(line.actualQty)
      const reservedQty = status === 'CHO_XAC_NHAN' ? requestedQty : 0
      const lineId = resolveVoucherLineId(line.lineId, detail.lines)
      const orderSourceKey = normalizeText(line.orderSourceKey)
      const stockSourceKey = normalizeText(line.stockSourceKey)
      const shippedLineQty = confirmedCountByLine.has(lineId) ? confirmedCountByLine.get(lineId) ?? 0 : actualQty
      if (orderSourceKey) {
        orderUsage.set(orderSourceKey, round3((orderUsage.get(orderSourceKey) ?? 0) + reservedQty))
        if (status !== 'CHO_XAC_NHAN') {
          orderGrossShipped.set(orderSourceKey, round3((orderGrossShipped.get(orderSourceKey) ?? 0) + shippedLineQty))
        }
      }
      if (stockSourceKey) {
        stockUsage.set(stockSourceKey, round3((stockUsage.get(stockSourceKey) ?? 0) + reservedQty))
        if (status === 'CHO_XAC_NHAN' && requestedQty > 0) {
          const currentBucket = reservedByStockSource.get(stockSourceKey) || new Map()
          const currentVoucher = currentBucket.get(voucherId)
          if (currentVoucher) {
            currentVoucher.requestedQty = round3(currentVoucher.requestedQty + requestedQty)
          } else {
            currentBucket.set(voucherId, {
              voucherId,
              maPhieu: detail.maPhieu,
              requestedQty: round3(requestedQty),
              customerName: detail.customerName,
              projectName: detail.projectName,
              createdAt: normalizeText(row.created_at),
            })
          }
          reservedByStockSource.set(stockSourceKey, currentBucket)
        }
        if (status !== 'CHO_XAC_NHAN') {
          stockGrossShipped.set(stockSourceKey, round3((stockGrossShipped.get(stockSourceKey) ?? 0) + shippedLineQty))
        }
      }
    }
  }

  for (const [key, gross] of orderGrossShipped.entries()) {
    orderShipped.set(key, Math.max(round3(gross - (returnedCountByOrderSource.get(key) ?? 0)), 0))
  }
  for (const [key, gross] of stockGrossShipped.entries()) {
    stockShipped.set(key, Math.max(round3(gross - (returnedCountByStockSource.get(key) ?? 0)), 0))
  }

  return { orderUsage, stockUsage, orderShipped, stockShipped, reservedByStockSource }
}

function aggregateOrderSources(
  approvedSegments: AvailableSegmentOption[],
  orders: Awaited<ReturnType<typeof loadDonHangList>>,
  acceptedRows: XuatHangSourceLine[],
  usage: ReturnType<typeof aggregateShipmentUsage>,
  quoteUnitPriceByBocId: Map<string, number>,
  projectPoolBySource: Map<string, number>
) {
  const acceptedMap = new Map<string, XuatHangSourceLine>()
  const ordersWithOperationalRows = new Set<string>()
  for (const row of acceptedRows) {
    if (!row.orderSourceKey) {
      continue
    }

    const key = row.orderSourceKey as string
    const current = acceptedMap.get(key)
    if (row.orderId) {
      ordersWithOperationalRows.add(row.orderId)
    }
    if (current) {
      current.acceptedQty = round3(current.acceptedQty + row.acceptedQty)
      current.orderedQty = Math.max(current.orderedQty, row.orderedQty)
      continue
    }
    acceptedMap.set(key, { ...row, sourceKey: key, mode: 'DON_HANG' })
  }

  for (const key of [...usage.orderUsage.keys(), ...usage.orderShipped.keys()]) {
    const orderId = String(key || '').split('::')[0]
    if (orderId) {
      ordersWithOperationalRows.add(orderId)
    }
  }

  const orderMap = new Map(orders.map((item) => [item.order.order_id, item]))
  const bucket = new Map<string, XuatHangSourceLine>()

  for (const segment of approvedSegments) {
    const order = orderMap.get(segment.orderId)
    if (!order) continue
    const key = buildOrderSourceKey(
      segment.orderId,
      {
        templateId: segment.templateId || null,
        maCoc: segment.maCoc || null,
        loaiCoc: segment.loaiCoc,
      },
      segment.tenDoan,
      segment.chieuDaiM
    )
    const accepted = acceptedMap.get(key)
    const unitPriceRef =
      (segment.bocId ? quoteUnitPriceByBocId.get(segment.bocId) : undefined) ??
      (() => {
        const totalPrice = toNumber(
          order.order.gia_ban_sau_giam ?? order.order.gia_ban_goc ?? order.linkedQuote.totalAmount
        )
        const totalOrderedMd = approvedSegments
          .filter((item) => item.orderId === segment.orderId)
          .reduce((sum, item) => sum + toNumber(item.soLuongDat) * toNumber(item.chieuDaiM), 0)
        return totalPrice > 0 && totalOrderedMd > 0 ? round3(totalPrice / totalOrderedMd) : null
      })()
    bucket.set(key, {
      sourceKey: key,
      mode: 'DON_HANG',
      bocId: segment.bocId,
      orderId: segment.orderId,
      maOrder: segment.maOrder,
      quoteId: segment.quoteId,
      maBaoGia: segment.maBaoGia,
      customerId: order.order.kh_id,
      customerName: segment.khachHang,
      projectId: order.order.da_id,
      projectName: segment.duAn,
      templateId: segment.templateId || null,
      maCoc: segment.maCoc || null,
      loaiCoc: segment.loaiCoc,
      tenDoan: segment.tenDoan,
      chieuDaiM: segment.chieuDaiM,
      itemLabel: buildItemLabel(segment.loaiCoc, segment.tenDoan, segment.chieuDaiM, segment.maCoc),
      orderedQty: segment.soLuongDat,
      acceptedQty: accepted?.acceptedQty ?? 0,
      shippedQty: 0,
      physicalQty: 0,
      availableQty: 0,
      reservedQty: 0,
      reservedByVouchers: [],
      unitPriceRef,
      stockSourceKey: buildStockSourceKey(
        {
          templateId: segment.templateId || null,
          maCoc: segment.maCoc || null,
          loaiCoc: segment.loaiCoc,
        },
        segment.tenDoan,
        segment.chieuDaiM
      ),
      orderSourceKey: key,
    })
  }

  for (const row of acceptedRows.filter((item) => item.mode === 'DON_HANG' && !item.orderId && item.quoteId)) {
    if (bucket.has(row.sourceKey)) continue
    bucket.set(row.sourceKey, { ...row })
  }

  return Array.from(bucket.values())
    .map((row) => {
      const physicalPoolQty = projectPoolBySource.get(row.stockSourceKey) ?? 0
      const reservedQty = usage.stockUsage.get(row.stockSourceKey) ?? 0
      const reservedByVouchers = Array.from(usage.reservedByStockSource.get(row.stockSourceKey)?.values() || []).sort((a, b) =>
        `${b.createdAt} ${b.maPhieu}`.localeCompare(`${a.createdAt} ${a.maPhieu}`)
      )
      const shipped = usage.orderShipped.get(row.orderSourceKey || '') ?? 0
      return {
        ...row,
        shippedQty: shipped,
        physicalQty: Math.max(round3(physicalPoolQty), 0),
        availableQty: Math.max(round3(physicalPoolQty - reservedQty), 0),
        reservedQty: Math.max(round3(reservedQty), 0),
        reservedByVouchers,
      }
    })
    .sort((a, b) => `${a.maOrder || ''} ${a.itemLabel}`.localeCompare(`${b.maOrder || ''} ${b.itemLabel}`))
}

async function buildQuoteAccessorySources(
  supabase: AnySupabase,
  quoteOptions: XuatHangQuoteOption[],
  usage: ReturnType<typeof aggregateShipmentUsage>
) {
  const productRowsByQuote = await loadLatestQuoteProductRows(
    supabase,
    quoteOptions.map((item) => item.quoteId)
  )

  const rows: XuatHangSourceLine[] = []
  for (const option of quoteOptions) {
    const productRows = productRowsByQuote.get(option.quoteId) || []
    for (const row of productRows) {
      if (String(row.kind || '') !== 'accessory') continue
      const qty = Math.max(toNumber(row.qty), 0)
      if (qty <= 0) continue

      const accessoryKey = String(row.key || row.rowId || randomUUID())
      const label =
        normalizeText(row.label) ||
        normalizeText(row.specText) ||
        normalizeText(row.name) ||
        'Phụ kiện'
      const sourceKey = buildQuoteAccessorySourceKey(option.quoteId, accessoryKey)
      const shipped = usage.orderShipped.get(sourceKey) ?? 0
      const unitPriceVat = Math.max(toNumber(row.unitPriceVat), 0)
      const unitPrice = Math.max(toNumber(row.unitPrice), 0)
      rows.push({
        sourceKey,
        mode: 'DON_HANG',
        bocId: null,
        orderId: null,
        maOrder: option.orderLabels.join(', ') || null,
        quoteId: option.quoteId,
        maBaoGia: option.maBaoGia,
      customerId: option.customerId,
      customerName: option.customerName,
      projectId: option.projectId,
      projectName: option.projectName,
      templateId: null,
      maCoc: null,
      loaiCoc: 'PHU_KIEN',
        tenDoan: label,
        chieuDaiM: 0,
        itemLabel: label,
        orderedQty: qty,
        acceptedQty: 0,
        shippedQty: shipped,
        physicalQty: 0,
        availableQty: 0,
        reservedQty: 0,
        reservedByVouchers: [],
        unitPriceRef: unitPriceVat > 0 ? unitPriceVat : unitPrice > 0 ? unitPrice : null,
        stockSourceKey: buildStockSourceKey({ templateId: null, maCoc: null, loaiCoc: 'PHU_KIEN' }, label, 0),
        orderSourceKey: sourceKey,
      })
    }
  }

  return rows
}

async function loadRetailInventorySources(
  supabase: AnySupabase,
  usage: ReturnType<typeof aggregateShipmentUsage>
) {
  const currentRows = await loadFinishedGoodsCurrentInventoryRows(supabase)
  const bucket = new Map<string, XuatHangSourceLine>()

  for (const row of currentRows) {
    if (!row.visibleInRetail) continue

    const stockSourceKey = buildStockSourceKey(
      {
        templateId: row.templateId || null,
        maCoc: row.maCoc || null,
        loaiCoc: row.loaiCoc,
      },
      row.tenDoan,
      row.chieuDaiM
    )

    const current = bucket.get(stockSourceKey)
    if (current) {
      current.physicalQty = round3(current.physicalQty + 1)
      current.acceptedQty = round3(current.acceptedQty + 1)
      continue
    }

    bucket.set(stockSourceKey, {
      sourceKey: stockSourceKey,
      mode: 'TON_KHO',
      bocId: null,
      orderId: null,
      maOrder: null,
      quoteId: null,
      maBaoGia: null,
      customerId: null,
      customerName: null,
      projectId: null,
      projectName: null,
      templateId: row.templateId || null,
      maCoc: row.maCoc || null,
      loaiCoc: row.loaiCoc,
      tenDoan: deriveStockSegmentGroup(row.tenDoan),
      chieuDaiM: row.chieuDaiM,
      itemLabel: buildStockItemLabel(row.loaiCoc, row.tenDoan, row.chieuDaiM, row.maCoc),
      orderedQty: 0,
      acceptedQty: 1,
      shippedQty: 0,
      physicalQty: 1,
      availableQty: 1,
      reservedQty: 0,
      reservedByVouchers: [],
      unitPriceRef: null,
      stockSourceKey,
      orderSourceKey: null,
    })
  }

  return Array.from(bucket.values())
    .map((row) => {
      const reservedQty = usage.stockUsage.get(row.stockSourceKey) ?? 0
      const shippedQty = usage.stockShipped.get(row.stockSourceKey) ?? 0
      return {
        ...row,
        shippedQty,
        availableQty: Math.max(round3(row.physicalQty - reservedQty), 0),
        reservedQty: Math.max(round3(reservedQty), 0),
        reservedByVouchers: Array.from(usage.reservedByStockSource.get(row.stockSourceKey)?.values() || []).sort((a, b) =>
          `${b.createdAt} ${b.maPhieu}`.localeCompare(`${a.createdAt} ${a.maPhieu}`)
        ),
      }
    })
    .filter((row) => row.availableQty > 0)
    .sort((a, b) => a.itemLabel.localeCompare(b.itemLabel))
}

function buildQuoteOptions(
  orders: Awaited<ReturnType<typeof loadDonHangList>>,
  approvedSegments: AvailableSegmentOption[]
) {
  const orderMap = new Map(orders.map((item) => [item.order.order_id, item]))
  const optionMap = new Map<string, XuatHangQuoteOption>()

  for (const segment of approvedSegments) {
    const quoteId = String(segment.quoteId || '')
    if (!quoteId) continue
    const order = orderMap.get(segment.orderId)
    if (!order) continue

    const current =
      optionMap.get(quoteId) || {
        quoteId,
        maBaoGia: segment.maBaoGia || order.linkedQuote.maBaoGia || quoteId,
        customerId: order.order.kh_id,
        customerName: segment.khachHang || order.khachHangName || order.order.kh_id,
        projectId: order.order.da_id,
        projectName: segment.duAn || order.duAnName || order.order.da_id,
        orderIds: [],
        orderLabels: [],
        totalPrice: order.linkedQuote.totalAmount ?? order.order.gia_ban_sau_giam ?? order.order.gia_ban_goc ?? null,
      }

    if (!current.orderIds.includes(segment.orderId)) current.orderIds.push(segment.orderId)
    const orderLabel = segment.maOrder || order.order.ma_order || segment.orderId
    if (orderLabel && !current.orderLabels.includes(orderLabel)) current.orderLabels.push(orderLabel)
    optionMap.set(quoteId, current)
  }

  return Array.from(optionMap.values()).sort((a, b) => `${a.maBaoGia}`.localeCompare(`${b.maBaoGia}`))
}

function buildVoucherDetail(row: Record<string, unknown>) {
  const payload = (row.payload_json as Record<string, unknown> | null) || {}
  const summary = (payload.summary as Record<string, unknown> | null) || {}
  const lines = safeArray<Record<string, unknown>>(payload.lines).map((line) => ({
    lineId: String(line.lineId || ''),
    itemLabel: String(line.itemLabel || '-'),
    templateId: normalizeText(line.templateId) || null,
    maCoc: normalizeText(line.maCoc) || null,
    loaiCoc: String(line.loaiCoc || '-'),
    tenDoan: String(line.tenDoan || '-'),
    chieuDaiM: toNumber(line.chieuDaiM),
    originalItemLabel: normalizeText(line.originalItemLabel) || String(line.itemLabel || '-'),
    originalLoaiCoc: normalizeText(line.originalLoaiCoc) || String(line.loaiCoc || '-'),
    originalTenDoan: normalizeText(line.originalTenDoan) || String(line.tenDoan || '-'),
    originalChieuDaiM:
      line.originalChieuDaiM == null || line.originalChieuDaiM === ''
        ? toNumber(line.chieuDaiM)
        : toNumber(line.originalChieuDaiM),
    isSubstituted:
      Boolean(line.isSubstituted) ||
      (normalizeText(line.originalItemLabel) !== '' && normalizeText(line.originalItemLabel) !== normalizeText(line.itemLabel)),
    substitutionReason: normalizeText(line.substitutionReason) || null,
    requestedQty: toNumber(line.requestedQty),
    actualQty: toNumber(line.actualQty),
    availableQtySnapshot: toNumber(line.availableQtySnapshot),
    bocId: normalizeText(line.bocId) || null,
    unitPriceSnapshot:
      line.unitPriceSnapshot == null || line.unitPriceSnapshot === '' ? null : toNumber(line.unitPriceSnapshot),
    lineTotalSnapshot:
      line.lineTotalSnapshot == null || line.lineTotalSnapshot === '' ? null : toNumber(line.lineTotalSnapshot),
    orderSourceKey: normalizeText(line.orderSourceKey) || null,
    stockSourceKey: normalizeShipmentStockSourceKey(line),
    orderId: normalizeText(line.orderId) || null,
    maOrder: normalizeText(line.maOrder) || null,
    quoteId: normalizeText(line.quoteId) || null,
    maBaoGia: normalizeText(line.maBaoGia) || null,
    customerId: normalizeText(line.customerId) || null,
    customerName: normalizeText(line.customerName) || null,
    projectId: normalizeText(line.projectId) || null,
    projectName: normalizeText(line.projectName) || null,
    sourceType: (line.sourceType === 'TON_KHO' ? 'TON_KHO' : 'DON_HANG') as XuatHangSourceMode,
  }))
  const confirmedSerials = safeArray<Record<string, unknown>>(payload.confirmedSerials).map((item) => {
    const lineId = resolveVoucherLineId(item.lineId, lines)
    const line = lines.find((entry) => entry.lineId === lineId)
    return {
      lineId,
      serialId: String(item.serialId || ''),
      serialCode: String(item.serialCode || ''),
      orderSourceKey: normalizeText(item.orderSourceKey) || null,
      stockSourceKey:
        normalizeText(item.stockSourceKey) ||
        (line ? normalizeShipmentStockSourceKey(line) : ''),
    }
  })
  const confirmedLineBySerialId = new Map(confirmedSerials.map((item) => [item.serialId, item.lineId]))
  const returnedSerials = safeArray<Record<string, unknown>>(payload.returnedSerials).map((item) => {
    const lineId = resolveVoucherLineId(item.lineId || confirmedLineBySerialId.get(String(item.serialId || '')) || '', lines)
    const line = lines.find((entry) => entry.lineId === lineId)
    return {
      returnSerialId: String(item.returnSerialId || ''),
      serialId: String(item.serialId || ''),
      serialCode: String(item.serialCode || ''),
      lineId,
      orderSourceKey: normalizeText(item.orderSourceKey) || null,
      stockSourceKey:
        normalizeText(item.stockSourceKey) ||
        (line ? normalizeShipmentStockSourceKey(line) : ''),
      resolutionStatus: (String(item.resolutionStatus || '') === 'NHAP_KHACH_LE'
        ? 'NHAP_KHACH_LE'
        : String(item.resolutionStatus || '') === 'HUY'
          ? 'HUY'
          : 'NHAP_DU_AN') as RawReturnedSerial['resolutionStatus'],
      note: String(item.note || ''),
    }
  })
  const returnRequestPayload =
    payload.returnRequest && typeof payload.returnRequest === 'object'
      ? (payload.returnRequest as Record<string, unknown>)
      : null
  const returnRequest: XuatHangReturnRequest | null = returnRequestPayload
    ? {
        status: String(returnRequestPayload.status || '') === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
        note: String(returnRequestPayload.note || ''),
        requestedQtyTotal: Math.max(
          0,
          toNumber(
            returnRequestPayload.requestedQtyTotal,
            safeArray<Record<string, unknown>>(returnRequestPayload.requestedLines).reduce(
              (sum, item) => sum + Math.max(0, toNumber(item.requestedQty)),
              0
            )
          )
        ),
        requestedLines: safeArray<Record<string, unknown>>(returnRequestPayload.requestedLines).map((item) => ({
          lineId: String(item.lineId || ''),
          requestedQty: Math.max(0, toNumber(item.requestedQty)),
        })),
        requestedAt: normalizeText(returnRequestPayload.requestedAt) || null,
        requestedBy: normalizeText(returnRequestPayload.requestedBy) || null,
        completedAt: normalizeText(returnRequestPayload.completedAt) || null,
        completedBy: normalizeText(returnRequestPayload.completedBy) || null,
      }
    : null

  const requestedQtyTotal = round3(lines.reduce((sum, item) => sum + item.requestedQty, 0))
  const actualQtyTotal = round3(lines.reduce((sum, item) => sum + item.actualQty, 0))

  return {
    voucherId: String(row.voucher_id || ''),
    maPhieu: makeVoucherCode(String(row.voucher_id || '')),
    sourceType: (String(row.source_type || 'DON_HANG') === 'TON_KHO' ? 'TON_KHO' : 'DON_HANG') as XuatHangSourceMode,
    status: String(row.trang_thai || 'CHO_XAC_NHAN') as XuatHangStatus,
    customerName: normalizeText(summary.customerName) || null,
    projectName: normalizeText(summary.projectName) || null,
    orderLabel: normalizeText(summary.maOrder) || null,
    quoteLabel: normalizeText(summary.maBaoGia) || null,
    note: String(row.ghi_chu || payload.note || ''),
    locked: String(row.trang_thai || '') !== 'CHO_XAC_NHAN',
    lines,
    confirmedSerials,
    returnedSerials,
    availableShipmentSerials: [],
    returnRequest,
    returnFeatureReady: Boolean(payload.returnFeatureReady),
    requestedQtyTotal,
    actualQtyTotal,
    canSoftReopenReturnRequest: false,
    canAdminReopenShipment: false,
  } satisfies XuatHangVoucherDetail
}

async function loadAvailableShipmentSerials(
  supabase: AnySupabase,
  detail: XuatHangVoucherDetail
): Promise<XuatHangAvailableShipmentSerial[]> {
  const lineMetas = detail.lines
    .filter((line) => line.loaiCoc !== 'PHU_KIEN' && normalizeShipmentStockSourceKey(line))
    .map((line) => ({
      lineId: line.lineId,
      itemLabel: line.itemLabel,
      templateId: normalizeText(line.templateId),
      maCoc: normalizeText(line.maCoc),
      stockSourceKey: normalizeShipmentStockSourceKey(line),
      legacyStockSourceKey: buildLegacyShipmentKey(
        normalizeText(line.loaiCoc),
        normalizeText(line.tenDoan),
        round3(toNumber(line.chieuDaiM))
      ),
    }))

  if (!lineMetas.length) return []

  const allowedTemplateIds = Array.from(new Set(lineMetas.map((line) => line.templateId).filter(Boolean)))
  const allowedMaCocs = Array.from(new Set(lineMetas.map((line) => line.maCoc).filter(Boolean)))

  let serialQuery = supabase
    .from('pile_serial')
    .select(
      'serial_id, serial_code, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m, qc_status, disposition_status, lifecycle_status, current_shipment_voucher_id, is_active'
    )
    .eq('is_active', true)

  if (allowedTemplateIds.length) {
    serialQuery = serialQuery.in('template_id', allowedTemplateIds)
  } else if (allowedMaCocs.length) {
    serialQuery = serialQuery.in('ma_coc', allowedMaCocs)
  } else {
    return []
  }

  const { data, error } = await serialQuery

  if (error) throw error

  const lineByStockSourceKey = new Map<string, (typeof lineMetas)[number]>()
  for (const line of lineMetas) {
    lineByStockSourceKey.set(line.stockSourceKey, line)
    lineByStockSourceKey.set(line.legacyStockSourceKey, line)
  }
  const usedSerialIds = new Set([
    ...detail.confirmedSerials.map((item) => normalizeText(item.serialId)).filter(Boolean),
    ...detail.returnedSerials.map((item) => normalizeText(item.serialId)).filter(Boolean),
  ])

  return safeArray<Record<string, unknown>>(data)
    .map((row) => {
      const serialId = normalizeText(row.serial_id)
      const serialCode = normalizeCode(row.serial_code)
      const stockSourceKey = buildStockSourceKey(
        {
          templateId: normalizeText(row.template_id),
          maCoc: normalizeText(row.ma_coc),
          loaiCoc: normalizeText(row.loai_coc),
        },
        normalizeText(row.ten_doan),
        round3(toNumber(row.chieu_dai_m))
      )
      const legacyStockSourceKey = buildLegacyShipmentKey(
        normalizeText(row.loai_coc),
        normalizeText(row.ten_doan),
        round3(toNumber(row.chieu_dai_m))
      )
      const line = lineByStockSourceKey.get(stockSourceKey) || lineByStockSourceKey.get(legacyStockSourceKey)
      if (!line || !serialId || !serialCode) return null
      if (usedSerialIds.has(serialId)) return null

      const currentVoucherId = normalizeText(row.current_shipment_voucher_id)
      if (currentVoucherId && currentVoucherId !== detail.voucherId) return null
      if (normalizeText(row.lifecycle_status) === 'DA_XUAT') return null

      const qcStatus = normalizeText(row.qc_status)
      const dispositionStatus = normalizeText(row.disposition_status)
      const canShipForOrder = qcStatus === 'DAT'
      const canShipForRetail = qcStatus === 'DAT' || (qcStatus === 'LOI' && dispositionStatus === 'THANH_LY')
      if (detail.sourceType === 'DON_HANG' ? !canShipForOrder : !canShipForRetail) {
        return null
      }

      return {
        serialId,
        serialCode,
        lineId: line.lineId,
        itemLabel: line.itemLabel,
        stockSourceKey,
      } satisfies XuatHangAvailableShipmentSerial
    })
    .filter(Boolean)
    .sort((left, right) => String(left?.serialCode || '').localeCompare(String(right?.serialCode || ''))) as XuatHangAvailableShipmentSerial[]
}

function hydrateVoucherLineOrigins(
  detail: XuatHangVoucherDetail,
  orderSources: XuatHangSourceLine[]
): XuatHangVoucherDetail {
  const orderSourceMap = new Map(orderSources.map((item) => [item.orderSourceKey || item.sourceKey, item]))
  return {
    ...detail,
    lines: detail.lines.map((line) => {
      const origin = orderSourceMap.get(line.orderSourceKey || '')
      const originalItemLabel = line.originalItemLabel || origin?.itemLabel || line.itemLabel
      const originalLoaiCoc = line.originalLoaiCoc || origin?.loaiCoc || line.loaiCoc
      const originalTenDoan = line.originalTenDoan || origin?.tenDoan || line.tenDoan
      const originalChieuDaiM =
        line.originalChieuDaiM != null ? line.originalChieuDaiM : origin?.chieuDaiM != null ? origin.chieuDaiM : line.chieuDaiM
      return {
        ...line,
        originalItemLabel,
        originalLoaiCoc,
        originalTenDoan,
        originalChieuDaiM,
        isSubstituted: Boolean(
          line.isSubstituted ||
            originalItemLabel !== line.itemLabel ||
            originalLoaiCoc !== line.loaiCoc ||
            originalTenDoan !== line.tenDoan ||
            round3(originalChieuDaiM || 0) !== round3(line.chieuDaiM || 0)
        ),
      }
    }),
  }
}

function normalizeCode(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

function toStableUuid(value: string) {
  const normalized = String(value || '').trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized
  }
  const hex = createHash('sha1').update(normalized || 'empty-line-id').digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function resolveVoucherLineId(rawLineId: unknown, lines: Array<{ lineId: string }>) {
  const normalized = normalizeText(rawLineId)
  if (!normalized) return ''
  const direct = lines.find((line) => line.lineId === normalized)
  if (direct) return direct.lineId
  const byStable = lines.find((line) => toStableUuid(line.lineId) === normalized)
  return byStable?.lineId || normalized
}

function ensureShipmentTable(error: unknown) {
  const rawMessage = String(
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? (error as { message: unknown }).message
        : ''
  )
  const message = rawMessage.toLowerCase()
  if (
    (message.includes('relation') && message.includes('phieu_xuat_ban')) ||
    (message.includes('schema cache') && message.includes('phieu_xuat_ban'))
  ) {
    throw new Error('Cần chạy file sql/phieu_xuat_ban_setup.sql trước khi dùng chức năng phiếu xuất hàng.')
  }
  throw new Error(rawMessage || 'Không lưu được phiếu xuất hàng.')
}

async function loadXuatHangSourceContext(
  supabase: AnySupabase,
  options: {
    includeOrderSources?: boolean
    includeStockSources?: boolean
  } = {}
) {
  const includeOrderSources = options.includeOrderSources ?? true
  const includeStockSources = options.includeStockSources ?? true
  const [{ acceptedRows, orders }, voucherRows, customerMap, projectPoolBySource] = await Promise.all([
    loadQcAcceptedSourceRows(supabase, { includeRetailSources: includeStockSources }),
    loadShipmentVoucherRows(supabase),
    loadCustomerMap(supabase),
    includeOrderSources ? loadFinishedGoodsProjectPoolByBucket(supabase) : Promise.resolve(new Map<string, number>()),
  ])
  const returnRows = await loadReturnedSourceRows(supabase, orders)
  const effectiveAcceptedRows = [...acceptedRows, ...returnRows]

  const shipmentSegments = buildShipmentOrderSegments(orders)
  const usage = aggregateShipmentUsage(voucherRows)
  const quoteOptions = includeOrderSources ? buildQuoteOptions(orders, shipmentSegments) : []
  const quoteUnitPriceByBocId = includeOrderSources
    ? await loadQuoteUnitPriceMapByBocId(supabase, shipmentSegments)
    : new Map<string, number>()
  const orderSources = includeOrderSources
    ? aggregateOrderSources(
        shipmentSegments,
        orders,
        effectiveAcceptedRows,
        usage,
        quoteUnitPriceByBocId,
        projectPoolBySource
      )
    : []
  const accessorySources = includeOrderSources ? await buildQuoteAccessorySources(supabase, quoteOptions, usage) : []
  const stockSources = includeStockSources ? await loadRetailInventorySources(supabase, usage) : []

  return {
    customerMap,
    orders,
    voucherRows,
    confirmedInfo: new Map<string, RawVoucherConfirmedSerial[]>(),
    returnInfo: {
      featureReady: true,
      byVoucher: new Map<string, RawReturnedSerial[]>(),
    },
    shipmentSegments,
    quoteOptions,
    orderSources: [...orderSources, ...accessorySources].sort((a, b) =>
      `${a.maBaoGia || ''} ${a.maOrder || ''} ${a.itemLabel}`.localeCompare(
        `${b.maBaoGia || ''} ${b.maOrder || ''} ${b.itemLabel}`
      )
    ),
    stockSources,
  }
}

export async function loadXuatHangPageData(supabase: AnySupabase, viewerRole: string | null | undefined) {
  if (!canViewShipment(viewerRole)) {
    return {
      customers: [],
      quoteOptions: [],
      orderSources: [],
      stockSources: [],
      vouchers: [],
    } satisfies XuatHangPageData
  }
  const voucherRows = await loadXuatHangVoucherListData(supabase, viewerRole)

  return {
    customers: [],
    quoteOptions: [],
    orderSources: [],
    stockSources: [],
    vouchers: voucherRows,
  } satisfies XuatHangPageData
}

export async function loadXuatHangVoucherListData(
  supabase: AnySupabase,
  viewerRole: string | null | undefined
) {
  if (!canViewShipment(viewerRole)) {
    return [] satisfies XuatHangVoucherListItem[]
  }

  const voucherRows = await loadShipmentVoucherRows(supabase)
  const voucherIds = voucherRows.map((row) => normalizeText(row.voucher_id)).filter(Boolean)
  const returnedVoucherIds = await loadReturnedVoucherIdSet(supabase, voucherIds)
  const vouchers = voucherRows.map((row) => {
    const detail = buildVoucherDetail(row)
    const hasReturnData = Boolean(detail.returnRequest) || returnedVoucherIds.has(detail.voucherId)

    return {
      voucherId: detail.voucherId,
      maPhieu: detail.maPhieu,
      sourceType: detail.sourceType,
      status: detail.status,
      customerName: detail.customerName,
      projectName: detail.projectName,
      orderLabel: detail.orderLabel,
      requestedQtyTotal: detail.requestedQtyTotal,
      actualQtyTotal: detail.actualQtyTotal,
      operationDate: row.ngay_thao_tac ? String(row.ngay_thao_tac) : null,
      createdAt: String(row.created_at || ''),
      hasReturnData,
      detail: null,
    } satisfies XuatHangVoucherListItem
  })

  return vouchers
}

export async function loadXuatHangCreateBootstrap(
  supabase: AnySupabase,
  viewerRole: string | null | undefined,
  mode: XuatHangCreateBootstrapMode = 'ALL'
) {
  if (!canCreateShipment(viewerRole)) {
    return {
      customers: [],
      quoteOptions: [],
      orderSources: [],
      stockSources: [],
    } satisfies XuatHangCreateBootstrap
  }

  const { customerMap, quoteOptions, orderSources, stockSources } = await loadXuatHangSourceContext(supabase, {
    includeOrderSources: mode !== 'TON_KHO',
    includeStockSources: mode !== 'DON_HANG',
  })

  return {
    customers: Array.from(customerMap.entries()).map(([khId, tenKh]) => ({ khId, tenKh })),
    quoteOptions,
    orderSources,
    stockSources,
  } satisfies XuatHangCreateBootstrap
}

export async function deleteXuatHangVouchers(
  supabase: AnySupabase,
  params: {
    voucherIds: string[]
    userId: string
    userRole: string
  }
) {
  if (!canCreateShipment(params.userRole)) {
    throw new Error('Chỉ KTBH hoặc Admin mới được xóa phiếu xuất hàng.')
  }

  const voucherIds = Array.from(new Set(params.voucherIds.map((item) => normalizeText(item)).filter(Boolean)))
  if (!voucherIds.length) {
    throw new Error('Chưa chọn phiếu xuất hàng để xóa.')
  }

  const { data, error } = await supabase
    .from('phieu_xuat_ban')
    .select('voucher_id, trang_thai, is_active')
    .in('voucher_id', voucherIds)
    .eq('is_active', true)

  if (error) ensureShipmentTable(error)

  const rows = safeArray<Record<string, unknown>>(data)
  if (rows.length !== voucherIds.length) {
    throw new Error('Có phiếu xuất hàng không còn tồn tại hoặc đã bị xóa.')
  }

  const invalidRow = rows.find((row) => String(row.trang_thai || '') !== 'CHO_XAC_NHAN')
  if (invalidRow) {
    throw new Error('Chỉ được xóa phiếu đang ở trạng thái Chờ thủ kho xác nhận.')
  }

  const { error: updateError } = await supabase
    .from('phieu_xuat_ban')
    .update({
      is_active: false,
      updated_by: params.userId,
    })
    .in('voucher_id', voucherIds)
    .eq('is_active', true)

  if (updateError) ensureShipmentTable(updateError)

  return {
    deletedCount: voucherIds.length,
  } satisfies DeleteXuatHangVoucherResult
}

export async function loadXuatHangVoucherDetail(
  supabase: AnySupabase,
  voucherId: string,
  viewerRole: string | null | undefined
) {
  if (!canViewShipment(viewerRole)) {
    return null
  }

  const { data, error } = await supabase
    .from('phieu_xuat_ban')
    .select('voucher_id, source_type, trang_thai, kh_id, da_id, order_id, quote_id, ghi_chu, payload_json, is_active, created_at')
    .eq('voucher_id', voucherId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('phieu_xuat_ban')) ||
      (message.includes('schema cache') && message.includes('phieu_xuat_ban'))
    ) {
      return null
    }
    throw error
  }
  if (!data) return null
  const sourceContext = await loadXuatHangSourceContext(supabase)
  const detail = hydrateVoucherLineOrigins(buildVoucherDetail(data as Record<string, unknown>), sourceContext.orderSources)
  const confirmedInfo = await loadConfirmedSerialsByVoucher(supabase, [detail.voucherId])
  const returnInfo = await loadReturnedSerialsByVoucher(supabase, [detail.voucherId])
  const mergedConfirmedSerials =
    detail.confirmedSerials.length > 0 ? detail.confirmedSerials : confirmedInfo.get(detail.voucherId) || []
  const confirmedLineBySerialId = new Map(mergedConfirmedSerials.map((item) => [item.serialId, item.lineId]))
  const mergedDetail = {
    ...detail,
    confirmedSerials: mergedConfirmedSerials,
    returnedSerials: (returnInfo.byVoucher.get(detail.voucherId) || []).map((item) => ({
      ...item,
      lineId: item.lineId || confirmedLineBySerialId.get(item.serialId) || '',
    })),
    returnFeatureReady: returnInfo.featureReady,
  }
  return {
    ...mergedDetail,
    canSoftReopenReturnRequest: Boolean(
      mergedDetail.returnRequest &&
        mergedDetail.returnRequest.status === 'PENDING' &&
        mergedDetail.returnedSerials.length === 0
    ),
    canAdminReopenShipment: Boolean(
      mergedDetail.status !== 'CHO_XAC_NHAN' &&
        mergedDetail.confirmedSerials.length > 0 &&
        !mergedDetail.returnRequest &&
        mergedDetail.returnedSerials.length === 0
    ),
    availableShipmentSerials: await loadAvailableShipmentSerials(supabase, mergedDetail),
  }
}

export async function createXuatHangVoucher(
  supabase: AnySupabase,
  params: {
    userId: string
    userRole: string
    mode: XuatHangSourceMode
    customerId?: string
    quoteId?: string
    note?: string
    lines: Array<{
      sourceKey: string
      requestedQty: number
      unitPrice?: number | null
      actualSourceKey?: string
      substitutionReason?: string
    }>
  }
) {
  if (!canCreateShipment(params.userRole)) {
    throw new Error('Chỉ KTBH hoặc Admin mới được lập phiếu xuất hàng.')
  }

  const sourceContext = await loadXuatHangSourceContext(supabase)
  const sourceMap = new Map(
    (params.mode === 'DON_HANG' ? sourceContext.orderSources : sourceContext.stockSources).map((item) => [item.sourceKey, item])
  )
  const orderActualSourceMap = new Map<string, XuatHangSourceLine>()
  for (const item of sourceContext.orderSources) {
    if (item.loaiCoc === 'PHU_KIEN') continue
    const exactItemKey = buildExactShipmentItemKey(
      {
        templateId: item.templateId,
        maCoc: item.maCoc,
        loaiCoc: item.loaiCoc,
      },
      item.tenDoan,
      item.chieuDaiM
    )
    const current = orderActualSourceMap.get(exactItemKey)
    if (!current || item.availableQty > current.availableQty) {
      orderActualSourceMap.set(exactItemKey, item)
    }
  }

  const selectedLines: Array<{
    source: XuatHangSourceLine
    actualSource: XuatHangSourceLine
    requestedQty: number
    unitPrice: number | null
    substitutionReason: string | null
  }> = []
  for (const item of params.lines) {
    const source = sourceMap.get(String(item.sourceKey || ''))
    if (!source) continue
    const requestedQty =
      params.mode === 'DON_HANG'
        ? Math.max(toNumber(item.requestedQty), 0)
        : Math.min(Math.max(toNumber(item.requestedQty), 0), source.availableQty)
    if (requestedQty <= 0) continue

    let actualSource = source
    let substitutionReason: string | null = null
    if (params.mode === 'DON_HANG' && source.loaiCoc !== 'PHU_KIEN') {
      const actualSourceKey = normalizeText(item.actualSourceKey)
      const sourceExactItemKey = buildExactShipmentItemKey(
        {
          templateId: source.templateId,
          maCoc: source.maCoc,
          loaiCoc: source.loaiCoc,
        },
        source.tenDoan,
        source.chieuDaiM
      )
      if (actualSourceKey && actualSourceKey !== sourceExactItemKey) {
        const matchedActualSource = orderActualSourceMap.get(actualSourceKey)
        if (!matchedActualSource) {
          throw new Error(`Không tìm thấy mặt hàng thực xuất thay thế cho dòng ${source.itemLabel}.`)
        }
        actualSource = matchedActualSource
        substitutionReason = normalizeText(item.substitutionReason) || null
        if (!substitutionReason) {
          throw new Error(`Cần nhập lý do thay thế cho dòng ${source.itemLabel}.`)
        }
      }
    }

    const unitPrice =
      params.mode === 'TON_KHO'
        ? Math.max(toNumber(item.unitPrice, 0), 0)
        : Math.max(toNumber(source.unitPriceRef, 0), 0)
    selectedLines.push({
      source,
      actualSource,
      requestedQty,
      unitPrice: unitPrice > 0 ? unitPrice : null,
      substitutionReason,
    })
  }

  if (!selectedLines.length) {
    throw new Error('Cần chọn ít nhất một dòng hàng để lập phiếu xuất.')
  }

  if (params.mode === 'DON_HANG') {
    const requestedQtyByActualStockSource = new Map<string, number>()
    for (const item of selectedLines) {
      requestedQtyByActualStockSource.set(
        item.actualSource.stockSourceKey,
        round3((requestedQtyByActualStockSource.get(item.actualSource.stockSourceKey) ?? 0) + item.requestedQty)
      )
    }
    for (const item of selectedLines) {
      const requestedByActualStockSource = requestedQtyByActualStockSource.get(item.actualSource.stockSourceKey) ?? 0
      if (requestedByActualStockSource > item.actualSource.availableQty) {
        throw new Error(
          `Mặt hàng thực xuất ${item.actualSource.itemLabel} chỉ còn ${formatNumber(item.actualSource.availableQty)} cây có thể giao.`
        )
      }
    }
  }

  if (params.mode === 'DON_HANG') {
    const quoteId = normalizeText(params.quoteId)
    if (!quoteId) throw new Error('Cần chọn báo giá.')
    if (selectedLines.some((item) => item.source.quoteId !== quoteId)) {
      throw new Error('Có dòng không thuộc báo giá đã chọn.')
    }
  } else if (!normalizeText(params.customerId)) {
    throw new Error('Cần chọn khách hàng cho phiếu bán tồn kho.')
  }

  const first = selectedLines[0].source
  const uniqueOrderIds = Array.from(new Set(selectedLines.map((item) => item.source.orderId).filter(Boolean))) as string[]
  const uniqueOrderLabels = Array.from(new Set(selectedLines.map((item) => item.source.maOrder).filter(Boolean))) as string[]
  const summary = {
    customerId: params.mode === 'TON_KHO' ? normalizeText(params.customerId) : first.customerId,
    customerName:
      params.mode === 'TON_KHO'
        ? sourceContext.customerMap.get(normalizeText(params.customerId)) || null
        : first.customerName,
    projectId: params.mode === 'DON_HANG' ? first.projectId : null,
    projectName: params.mode === 'DON_HANG' ? first.projectName : null,
    orderId: params.mode === 'DON_HANG' ? (uniqueOrderIds.length === 1 ? uniqueOrderIds[0] : null) : null,
    maOrder: params.mode === 'DON_HANG' ? uniqueOrderLabels.join(', ') || null : null,
    quoteId: params.mode === 'DON_HANG' ? first.quoteId : null,
    maBaoGia: params.mode === 'DON_HANG' ? first.maBaoGia : null,
  }

  const payload = {
    note: String(params.note || ''),
    summary,
    lines: selectedLines.map(({ source, actualSource, requestedQty, unitPrice, substitutionReason }) => ({
      lineId: randomUUID(),
      itemLabel: actualSource.itemLabel,
      templateId: actualSource.templateId,
      maCoc: actualSource.maCoc,
      loaiCoc: actualSource.loaiCoc,
      tenDoan: actualSource.tenDoan,
      chieuDaiM: actualSource.chieuDaiM,
      originalItemLabel: source.itemLabel,
      originalLoaiCoc: source.loaiCoc,
      originalTenDoan: source.tenDoan,
      originalChieuDaiM: source.chieuDaiM,
      isSubstituted:
        buildExactShipmentItemKey(
          {
            templateId: actualSource.templateId,
            maCoc: actualSource.maCoc,
            loaiCoc: actualSource.loaiCoc,
          },
          actualSource.tenDoan,
          actualSource.chieuDaiM
        ) !==
        buildExactShipmentItemKey(
          {
            templateId: source.templateId,
            maCoc: source.maCoc,
            loaiCoc: source.loaiCoc,
          },
          source.tenDoan,
          source.chieuDaiM
        ),
      substitutionReason,
      bocId: source.bocId,
      requestedQty,
      actualQty: 0,
      availableQtySnapshot: actualSource.availableQty,
      unitPriceSnapshot: unitPrice,
      lineTotalSnapshot:
        unitPrice != null
          ? round3(
              requestedQty *
                (params.mode === 'DON_HANG' && source.loaiCoc !== 'PHU_KIEN' ? source.chieuDaiM : 1) *
                unitPrice
            )
          : null,
      orderSourceKey: source.orderSourceKey,
      stockSourceKey: actualSource.stockSourceKey,
      orderId: source.orderId,
      maOrder: source.maOrder,
      quoteId: source.quoteId,
      maBaoGia: source.maBaoGia,
      customerId: summary.customerId,
      customerName: summary.customerName,
      projectId: summary.projectId,
      projectName: summary.projectName,
      sourceType: params.mode,
    })),
  }

  const { data, error } = await supabase
    .from('phieu_xuat_ban')
    .insert({
      source_type: params.mode,
      trang_thai: 'CHO_XAC_NHAN',
      kh_id: summary.customerId || null,
      da_id: summary.projectId || null,
      order_id: summary.orderId || null,
      quote_id: summary.quoteId || null,
      ghi_chu: payload.note || null,
      payload_json: payload,
      created_by: params.userId,
      updated_by: params.userId,
      ngay_thao_tac: formatLocalDate(new Date()),
    })
    .select('voucher_id')
    .maybeSingle()

  if (error) ensureShipmentTable(error)
  if (!data) throw new Error('Không tạo được phiếu xuất hàng.')
  return { voucherId: String(data.voucher_id) }
}

export async function confirmXuatHangVoucher(
  supabase: AnySupabase,
  params: {
    voucherId: string
    userId: string
    userRole: string
    note?: string
    lines: Array<{ lineId: string; actualQty: number }>
    serialAssignments?: Array<{ lineId?: string; serialId?: string; serialCode?: string }>
  }
) {
  if (!canConfirmShipment(params.userRole)) {
    throw new Error('Chỉ Thủ kho hoặc Admin mới được xác nhận xuất hàng.')
  }

  const detail = await loadXuatHangVoucherDetail(supabase, params.voucherId, 'admin')
  if (!detail) throw new Error('Không tìm thấy phiếu xuất hàng.')
  if (detail.status !== 'CHO_XAC_NHAN') {
    throw new Error('Phiếu xuất hàng này đã được xác nhận.')
  }

  const scannedAssignments = Array.isArray(params.serialAssignments)
    ? params.serialAssignments
        .map((item) => ({
          lineId: normalizeText(item.lineId),
          serialId: normalizeText(item.serialId),
          serialCode: normalizeCode(item.serialCode),
        }))
        .filter((item) => item.lineId && (item.serialId || item.serialCode))
    : []

  const lineById = new Map(detail.lines.map((line) => [line.lineId, line]))
  const serialCountByLine = new Map<string, number>()
  const serialRowsByLine = new Map<string, Array<{ serialId: string; serialCode: string }>>()

  if (scannedAssignments.length) {
    const serialIds = Array.from(new Set(scannedAssignments.map((item) => item.serialId).filter(Boolean)))
    const serialCodes = Array.from(new Set(scannedAssignments.map((item) => item.serialCode).filter(Boolean)))
    let serialRows: Array<Record<string, unknown>> = []

    if (serialIds.length || serialCodes.length) {
      let query = supabase
        .from('pile_serial')
        .select(
          'serial_id, serial_code, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m, qc_status, disposition_status, lifecycle_status, current_shipment_voucher_id, is_active'
        )
        .eq('is_active', true)

      if (serialIds.length) {
        query = query.in('serial_id', serialIds)
      } else if (serialCodes.length === 1) {
        query = query.eq('serial_code', serialCodes[0])
      } else if (serialCodes.length > 1) {
        query = query.in('serial_code', serialCodes)
      }

      const { data, error } = await query
      if (error) throw error
      serialRows = safeArray<Record<string, unknown>>(data)
    }

    const serialRowMap = new Map<string, Record<string, unknown>>()
    for (const row of serialRows) {
      const idKey = normalizeText(row.serial_id)
      const codeKey = normalizeCode(row.serial_code)
      if (idKey) serialRowMap.set(`id:${idKey}`, row)
      if (codeKey) serialRowMap.set(`code:${codeKey}`, row)
    }

    const usedKeys = new Set<string>()
    for (const assignment of scannedAssignments) {
      const line = lineById.get(assignment.lineId)
      if (!line) {
        throw new Error('Có serial quét không khớp dòng phiếu xuất.')
      }
      const matched =
        (assignment.serialId && serialRowMap.get(`id:${assignment.serialId}`)) ||
        (assignment.serialCode && serialRowMap.get(`code:${assignment.serialCode}`))
      if (!matched) {
        throw new Error(`Không tìm thấy serial ${assignment.serialCode || assignment.serialId}.`)
      }

      const serialId = normalizeText(matched.serial_id)
      const serialCode = normalizeCode(matched.serial_code)
      const uniqueKey = serialId || serialCode
      if (!uniqueKey || usedKeys.has(uniqueKey)) continue
      usedKeys.add(uniqueKey)

      const currentVoucherId = normalizeText(matched.current_shipment_voucher_id)
      if (currentVoucherId && currentVoucherId !== params.voucherId) {
        throw new Error(`Serial ${serialCode} đang thuộc một phiếu xuất khác.`)
      }

      const lifecycleStatus = normalizeText(matched.lifecycle_status)
      if (lifecycleStatus === 'DA_XUAT') {
        throw new Error(`Serial ${serialCode} đã xuất kho rồi.`)
      }

      const serialStockSourceKey = buildStockSourceKey(
        {
          templateId: normalizeText(matched.template_id),
          maCoc: normalizeText(matched.ma_coc),
          loaiCoc: normalizeText(matched.loai_coc),
        },
        normalizeText(matched.ten_doan),
        round3(toNumber(matched.chieu_dai_m))
      )
      const serialLegacyStockSourceKey = buildLegacyShipmentKey(
        normalizeText(matched.loai_coc),
        normalizeText(matched.ten_doan),
        round3(toNumber(matched.chieu_dai_m))
      )
      const lineStockSourceKey = normalizeShipmentStockSourceKey(line)
      if (serialStockSourceKey !== lineStockSourceKey && serialLegacyStockSourceKey !== lineStockSourceKey) {
        throw new Error(`Serial ${serialCode} không đúng mặt hàng của dòng ${line.itemLabel}.`)
      }

      const qcStatus = normalizeText(matched.qc_status)
      const dispositionStatus = normalizeText(matched.disposition_status)
      const canShipForOrder = qcStatus === 'DAT'
      const canShipForRetail = qcStatus === 'DAT' || (qcStatus === 'LOI' && dispositionStatus === 'THANH_LY')
      if (detail.sourceType === 'DON_HANG' ? !canShipForOrder : !canShipForRetail) {
        throw new Error(`Serial ${serialCode} không đủ điều kiện để xuất theo phiếu này.`)
      }

      serialCountByLine.set(assignment.lineId, (serialCountByLine.get(assignment.lineId) ?? 0) + 1)
      const currentRows = serialRowsByLine.get(assignment.lineId) || []
      currentRows.push({ serialId, serialCode })
      serialRowsByLine.set(assignment.lineId, currentRows)
    }
  }

  const lineMap = new Map(params.lines.map((item) => [String(item.lineId || ''), toNumber(item.actualQty)]))
  const nextLines = detail.lines.map((line) => ({
    ...line,
    actualQty: Math.min(
      Math.max(serialCountByLine.get(line.lineId) ?? lineMap.get(line.lineId) ?? 0, 0),
      line.requestedQty
    ),
  }))

  const requestedQtyTotal = round3(nextLines.reduce((sum, line) => sum + line.requestedQty, 0))
  const actualQtyTotal = round3(nextLines.reduce((sum, line) => sum + line.actualQty, 0))
  const status: XuatHangStatus = actualQtyTotal >= requestedQtyTotal ? 'DA_XUAT' : 'XUAT_MOT_PHAN'

  const payload = {
    note: String(params.note || detail.note || ''),
    summary: {
      customerName: detail.customerName,
      projectName: detail.projectName,
      maOrder: detail.orderLabel,
      maBaoGia: detail.quoteLabel,
    },
    lines: nextLines,
    confirmedSerials: Array.from(serialRowsByLine.entries()).flatMap(([lineId, rows]) =>
      rows.map((row) => ({
        lineId,
        serialId: row.serialId,
        serialCode: row.serialCode,
      }))
    ),
  }

  if (serialRowsByLine.size) {
    const serialIds = Array.from(serialRowsByLine.values()).flatMap((rows) => rows.map((row) => row.serialId))
    const historyPayload = await (async () => {
      const { data: currentRows, error } = await supabase
        .from('pile_serial')
        .select('serial_id, lifecycle_status, qc_status, disposition_status, current_location_id')
        .in('serial_id', serialIds)
      if (error) throw error
      return new Map(
        safeArray<Record<string, unknown>>(currentRows).map((row) => [normalizeText(row.serial_id), row])
      )
    })()

    const { error: deleteError } = await supabase
      .from('shipment_voucher_serial')
      .delete()
      .eq('voucher_id', params.voucherId)
    if (deleteError && !String(deleteError.message || '').toLowerCase().includes('shipment_voucher_serial')) {
      throw deleteError
    }

    const shipmentSerialRows = Array.from(serialRowsByLine.entries()).flatMap(([lineId, rows]) =>
      rows.map((row) => ({
        voucher_id: params.voucherId,
        voucher_line_id: toStableUuid(lineId),
        serial_id: row.serialId,
        confirmed_at: new Date().toISOString(),
        created_by: params.userId,
      }))
    )
    if (shipmentSerialRows.length) {
      const { error: insertError } = await supabase.from('shipment_voucher_serial').insert(shipmentSerialRows)
      if (insertError) throw insertError
    }

    const { error: serialUpdateError } = await supabase
      .from('pile_serial')
      .update({
        lifecycle_status: 'DA_XUAT',
        current_shipment_voucher_id: params.voucherId,
        updated_at: new Date().toISOString(),
      })
      .in('serial_id', serialIds)
    if (serialUpdateError) throw serialUpdateError

    const historyRows = serialIds.map((serialId) => {
      const current = historyPayload.get(serialId)
      return {
        serial_id: serialId,
        event_type: 'CONFIRMED_SHIPMENT',
        from_lifecycle_status: current?.lifecycle_status || null,
        to_lifecycle_status: 'DA_XUAT',
        from_qc_status: current?.qc_status || null,
        to_qc_status: current?.qc_status || null,
        from_disposition_status: current?.disposition_status || null,
        to_disposition_status: current?.disposition_status || null,
        from_location_id: current?.current_location_id || null,
        to_location_id: current?.current_location_id || null,
        ref_type: 'PHIEU_XUAT_BAN',
        ref_id: params.voucherId,
        note: 'Thủ kho xác nhận xuất hàng bằng serial',
        changed_by: params.userId,
      }
    })
    if (historyRows.length) {
      const { error: historyError } = await supabase.from('pile_serial_history').insert(historyRows)
      if (historyError) throw historyError
    }
  }

  const { error } = await supabase
    .from('phieu_xuat_ban')
    .update({
      trang_thai: status,
      ghi_chu: payload.note || null,
      payload_json: payload,
      updated_by: params.userId,
      ngay_thao_tac: formatLocalDate(new Date()),
    })
    .eq('voucher_id', params.voucherId)
    .eq('is_active', true)

  if (error) ensureShipmentTable(error)
  return { status }
}

export async function resolveShipmentSerialScan(
  supabase: AnySupabase,
  params: {
    voucherId: string
    userRole: string
    code: string
  }
): Promise<ShipmentSerialScanResult> {
  if (!canConfirmShipment(params.userRole)) {
    throw new Error('Chỉ Thủ kho hoặc Admin mới được quét serial khi xác nhận xuất hàng.')
  }

  const detail = await loadXuatHangVoucherDetail(supabase, params.voucherId, 'admin')
  if (!detail) throw new Error('Không tìm thấy phiếu xuất hàng.')
  if (detail.status !== 'CHO_XAC_NHAN') {
    throw new Error('Phiếu xuất hàng này đã được xác nhận.')
  }

  const code = normalizeCode(params.code)
  if (!code) throw new Error('Cần serial_code để quét.')

  const { data, error } = await supabase
    .from('pile_serial')
    .select(
      'serial_id, serial_code, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m, qc_status, disposition_status, lifecycle_status, current_shipment_voucher_id, is_active'
    )
    .eq('serial_code', code)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error(`Không tìm thấy serial ${code}.`)

  const currentVoucherId = normalizeText(data.current_shipment_voucher_id)
  if (currentVoucherId && currentVoucherId !== params.voucherId) {
    throw new Error(`Serial ${code} đang thuộc một phiếu xuất khác.`)
  }
  if (normalizeText(data.lifecycle_status) === 'DA_XUAT') {
    throw new Error(`Serial ${code} đã xuất kho rồi.`)
  }

  const line = detail.lines.find(
    (item) =>
      normalizeShipmentStockSourceKey(item) ===
        buildStockSourceKey(
          {
            templateId: normalizeText(data.template_id),
            maCoc: normalizeText(data.ma_coc),
            loaiCoc: normalizeText(data.loai_coc),
          },
          normalizeText(data.ten_doan),
          round3(toNumber(data.chieu_dai_m))
        ) ||
      normalizeShipmentStockSourceKey(item) ===
        buildLegacyShipmentKey(
          normalizeText(data.loai_coc),
          normalizeText(data.ten_doan),
          round3(toNumber(data.chieu_dai_m))
        )
  )
  if (!line) {
    throw new Error(`Serial ${code} không thuộc mặt hàng của phiếu xuất này.`)
  }

  const qcStatus = normalizeText(data.qc_status)
  const dispositionStatus = normalizeText(data.disposition_status)
  const canShipForOrder = qcStatus === 'DAT'
  const canShipForRetail = qcStatus === 'DAT' || (qcStatus === 'LOI' && dispositionStatus === 'THANH_LY')
  if (detail.sourceType === 'DON_HANG' ? !canShipForOrder : !canShipForRetail) {
    throw new Error(`Serial ${code} không đủ điều kiện để xuất theo phiếu này.`)
  }

  return {
    serialId: String(data.serial_id || ''),
    serialCode: String(data.serial_code || ''),
    lineId: line.lineId,
    itemLabel: line.itemLabel,
    stockSourceKey: normalizeShipmentStockSourceKey(line),
  }
}

export async function returnShipmentVoucherSerials(
  supabase: AnySupabase,
  params: {
    voucherId: string
    userId: string
    userRole: string
    note?: string
    items: Array<{
      serialId?: string
      resolutionStatus?: 'NHAP_DU_AN' | 'NHAP_KHACH_LE' | 'HUY'
      note?: string
    }>
  }
): Promise<ShipmentReturnResult> {
  if (!canConfirmShipment(params.userRole)) {
    throw new Error('Chỉ Thủ kho hoặc Admin mới được xác nhận hàng trả lại sau giao.')
  }

  const detail = await loadXuatHangVoucherDetail(supabase, params.voucherId, 'admin')
  if (!detail) throw new Error('Không tìm thấy phiếu xuất hàng.')
  if (!detail.locked) {
    throw new Error('Chỉ xử lý trả lại với phiếu đã xác nhận xuất hàng.')
  }
  if (!detail.returnFeatureReady) {
    throw new Error('Cần chạy lại file sql/pile_serial_setup.sql để bật nghiệp vụ trả lại sau giao.')
  }
  if (!detail.returnRequest || detail.returnRequest.status !== 'PENDING') {
    throw new Error('Phiếu này chưa có đề nghị trả hàng chờ Thủ kho xác nhận.')
  }

  const validItems = params.items
    .map((item) => ({
      serialId: normalizeText(item.serialId),
      resolutionStatus:
        item.resolutionStatus === 'NHAP_KHACH_LE'
          ? 'NHAP_KHACH_LE'
          : item.resolutionStatus === 'HUY'
            ? 'HUY'
            : 'NHAP_DU_AN',
      note: String(item.note || ''),
    }))
    .filter((item) => item.serialId)

  if (!validItems.length) {
    throw new Error('Cần chọn ít nhất một serial để xử lý trả lại.')
  }

  const shippedSerialIds = new Set(detail.confirmedSerials.map((item) => item.serialId))
  const returnedSerialIds = new Set(detail.returnedSerials.map((item) => item.serialId))
  const requestedQtyTotal = round3(
    detail.returnRequest.requestedLines.reduce((sum, item) => sum + Math.max(0, toNumber(item.requestedQty)), 0)
  )
  for (const item of validItems) {
    if (!shippedSerialIds.has(item.serialId)) {
      throw new Error('Có serial không thuộc danh sách đã xuất của phiếu này.')
    }
    if (returnedSerialIds.has(item.serialId)) {
      throw new Error('Có serial đã được xử lý trả lại trước đó.')
    }
  }
  if (validItems.length > requestedQtyTotal) {
    throw new Error('Số serial Thủ kho xác nhận vượt quá số lượng KTBH đã đề nghị trả lại.')
  }

  const { data: returnVoucherRow, error: returnVoucherError } = await supabase
    .from('return_voucher')
    .insert({
      shipment_voucher_id: params.voucherId,
      kh_id: detail.lines[0]?.customerId || null,
      da_id: detail.lines[0]?.projectId || null,
      order_id: detail.lines[0]?.orderId || null,
      ghi_chu: String(params.note || '') || null,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('return_voucher_id')
    .maybeSingle()

  if (returnVoucherError) throw returnVoucherError
  if (!returnVoucherRow?.return_voucher_id) {
    throw new Error('Không tạo được phiếu trả lại sau giao.')
  }

  const returnVoucherId = String(returnVoucherRow.return_voucher_id)
  const currentRows = await (async () => {
    const { data, error } = await supabase
      .from('pile_serial')
      .select('serial_id, lifecycle_status, qc_status, disposition_status, current_location_id')
      .in('serial_id', validItems.map((item) => item.serialId))
    if (error) throw error
    return new Map(safeArray<Record<string, unknown>>(data).map((row) => [String(row.serial_id || ''), row]))
  })()

  const returnRows = validItems.map((item) => ({
    return_voucher_id: returnVoucherId,
    shipment_voucher_id: params.voucherId,
    serial_id: item.serialId,
    resolution_status: item.resolutionStatus,
    visible_in_project: item.resolutionStatus === 'NHAP_DU_AN',
    visible_in_retail: item.resolutionStatus === 'NHAP_DU_AN' || item.resolutionStatus === 'NHAP_KHACH_LE',
    note: item.note || null,
    created_by: params.userId,
  }))

  const { error: insertReturnError } = await supabase.from('return_voucher_serial').insert(returnRows)
  if (insertReturnError) throw insertReturnError

  for (const item of validItems) {
    const lifecycleStatus = item.resolutionStatus === 'HUY' ? 'HUY_BO' : 'TRONG_KHO'
    const current = currentRows.get(item.serialId)
    const { error: updateError } = await supabase
      .from('pile_serial')
      .update({
        lifecycle_status: lifecycleStatus,
        current_shipment_voucher_id: null,
        last_return_voucher_id: returnVoucherId,
        visible_in_project: item.resolutionStatus === 'NHAP_DU_AN',
        visible_in_retail: item.resolutionStatus === 'NHAP_DU_AN' || item.resolutionStatus === 'NHAP_KHACH_LE',
        updated_at: new Date().toISOString(),
      })
      .eq('serial_id', item.serialId)
      .eq('is_active', true)
    if (updateError) throw updateError

    const { error: historyError } = await supabase.from('pile_serial_history').insert({
      serial_id: item.serialId,
      event_type: 'RETURNED_AFTER_SHIPMENT',
      from_lifecycle_status: current?.lifecycle_status || null,
      to_lifecycle_status: lifecycleStatus,
      from_qc_status: current?.qc_status || null,
      to_qc_status: current?.qc_status || null,
      from_disposition_status: current?.disposition_status || null,
      to_disposition_status: current?.disposition_status || null,
      from_location_id: current?.current_location_id || null,
      to_location_id: current?.current_location_id || null,
      ref_type: 'RETURN_VOUCHER',
      ref_id: returnVoucherId,
      note: item.note || null,
      changed_by: params.userId,
    })
    if (historyError) throw historyError
  }

  const confirmedLineBySerialId = new Map(detail.confirmedSerials.map((item) => [item.serialId, item.lineId]))
  const payload = {
    note: detail.note,
    summary: {
      customerName: detail.customerName,
      projectName: detail.projectName,
      maOrder: detail.orderLabel,
      maBaoGia: detail.quoteLabel,
    },
    lines: detail.lines,
    confirmedSerials: detail.confirmedSerials,
    returnFeatureReady: true,
    returnRequest: {
      ...detail.returnRequest,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      completedBy: params.userId,
    },
    returnedSerials: [
      ...detail.returnedSerials,
      ...validItems.map((item) => {
        const confirmed = detail.confirmedSerials.find((serial) => serial.serialId === item.serialId)
        return {
          returnSerialId: `${returnVoucherId}:${item.serialId}`,
          serialId: item.serialId,
          serialCode: confirmed?.serialCode || '',
          lineId: confirmedLineBySerialId.get(item.serialId) || '',
          resolutionStatus: item.resolutionStatus,
          note: item.note || '',
        }
      }),
    ],
  }

  const { error: updateVoucherError } = await supabase
    .from('phieu_xuat_ban')
    .update({
      payload_json: payload,
      updated_by: params.userId,
      ngay_thao_tac: formatLocalDate(new Date()),
    })
    .eq('voucher_id', params.voucherId)
    .eq('is_active', true)
  if (updateVoucherError) throw updateVoucherError

  return {
    returnVoucherId,
    processedCount: validItems.length,
  }
}

export async function saveShipmentReturnRequest(
  supabase: AnySupabase,
  params: {
    voucherId: string
    userId: string
    userRole: string
    note?: string
    totalRequestedQty?: number
    lines: Array<{
      lineId?: string
      requestedQty?: number
    }>
  }
): Promise<ShipmentReturnRequestResult> {
  if (!canCreateShipment(params.userRole)) {
    throw new Error('Chỉ KTBH hoặc Admin mới được tạo đề nghị trả hàng.')
  }

  const detail = await loadXuatHangVoucherDetail(supabase, params.voucherId, 'admin')
  if (!detail) throw new Error('Không tìm thấy phiếu xuất hàng.')
  if (!detail.locked) {
    throw new Error('Chỉ tạo đề nghị trả hàng cho phiếu đã xác nhận xuất.')
  }

  const returnedCountByLine = new Map<string, number>()
  for (const item of detail.returnedSerials) {
    returnedCountByLine.set(item.lineId, (returnedCountByLine.get(item.lineId) ?? 0) + 1)
  }
  const confirmedCountByLine = new Map<string, number>()
  for (const item of detail.confirmedSerials) {
    confirmedCountByLine.set(item.lineId, (confirmedCountByLine.get(item.lineId) ?? 0) + 1)
  }

  const requestedTotalQty = Math.max(0, Math.floor(toNumber(params.totalRequestedQty)))
  const totalReturnableQty = detail.lines.reduce((sum, line) => {
    const confirmedCount = confirmedCountByLine.get(line.lineId) ?? 0
    const returnedCount = returnedCountByLine.get(line.lineId) ?? 0
    return sum + Math.max(0, confirmedCount - returnedCount)
  }, 0)

  const validLines =
    requestedTotalQty > 0
      ? (() => {
          let remainingToAllocate = requestedTotalQty
          const allocated: Array<{ lineId: string; requestedQty: number }> = []
          for (const line of detail.lines) {
            if (remainingToAllocate <= 0) break
            const confirmedCount = confirmedCountByLine.get(line.lineId) ?? 0
            const returnedCount = returnedCountByLine.get(line.lineId) ?? 0
            const remainingReturnable = Math.max(0, confirmedCount - returnedCount)
            if (remainingReturnable <= 0) continue
            const allocatedQty = Math.min(remainingToAllocate, remainingReturnable)
            if (allocatedQty > 0) {
              allocated.push({ lineId: line.lineId, requestedQty: allocatedQty })
              remainingToAllocate -= allocatedQty
            }
          }
          return allocated
        })()
      : params.lines
          .map((item) => ({
            lineId: normalizeText(item.lineId),
            requestedQty: Math.max(0, Math.floor(toNumber(item.requestedQty))),
          }))
          .filter((item) => item.lineId && item.requestedQty > 0)

  if (requestedTotalQty > totalReturnableQty) {
    throw new Error('Số lượng đề nghị trả lại vượt quá số serial đã xuất còn chưa xử lý.')
  }
  if (!validLines.length) {
    throw new Error('Cần nhập ít nhất một số lượng cọc trả lại.')
  }

  const payload = {
    note: detail.note,
    summary: {
      customerName: detail.customerName,
      projectName: detail.projectName,
      maOrder: detail.orderLabel,
      maBaoGia: detail.quoteLabel,
    },
    lines: detail.lines,
    confirmedSerials: detail.confirmedSerials,
    returnedSerials: detail.returnedSerials,
    returnFeatureReady: detail.returnFeatureReady,
    returnRequest: {
      status: 'PENDING',
      note: String(params.note || ''),
      requestedQtyTotal: validLines.reduce((sum, item) => sum + item.requestedQty, 0),
      requestedLines: validLines,
      requestedAt: new Date().toISOString(),
      requestedBy: params.userId,
      completedAt: null,
      completedBy: null,
    },
  }

  const { error } = await supabase
    .from('phieu_xuat_ban')
    .update({
      payload_json: payload,
      updated_by: params.userId,
      ngay_thao_tac: formatLocalDate(new Date()),
    })
    .eq('voucher_id', params.voucherId)
    .eq('is_active', true)
  if (error) throw error

  return {
    requestedCount: validLines.reduce((sum, item) => sum + item.requestedQty, 0),
  }
}

export async function reopenShipmentReturnRequest(
  supabase: AnySupabase,
  params: {
    voucherId: string
    userId: string
    userRole: string
  }
): Promise<ShipmentReturnRequestResult> {
  if (!canCreateShipment(params.userRole)) {
    throw new Error('Chỉ KTBH hoặc Admin mới được mở lại đề nghị trả hàng.')
  }

  const detail = await loadXuatHangVoucherDetail(supabase, params.voucherId, 'admin')
  if (!detail) throw new Error('Không tìm thấy phiếu xuất hàng.')
  if (!detail.returnRequest || detail.returnRequest.status !== 'PENDING') {
    throw new Error('Phiếu này không có đề nghị trả hàng đang chờ xử lý.')
  }
  const { count: returnVoucherCount, error: returnVoucherError } = await supabase
    .from('return_voucher')
    .select('return_voucher_id', { count: 'exact', head: true })
    .eq('shipment_voucher_id', params.voucherId)
    .eq('is_active', true)
  if (returnVoucherError) throw returnVoucherError
  if (Number(returnVoucherCount || 0) > 0) {
    await writeShipmentReopenAudit(supabase, {
      entityType: 'PHIEU_XUAT_BAN_RETURN_REQUEST',
      entityId: params.voucherId,
      actorId: params.userId,
      reopenedFromStatus: detail.returnRequest.status,
      result: 'BLOCKED',
      blockedDownstreamType: 'RETURN_VOUCHER',
      note: 'Đã có phiếu trả hàng downstream. Cần rollback bước sau trước khi mở lại đề nghị trả hàng.',
    })
    throw new Error('Đã có phiếu trả hàng downstream. Cần rollback bước sau trước khi mở lại đề nghị trả hàng.')
  }
  if (detail.returnedSerials.length > 0) {
    await writeShipmentReopenAudit(supabase, {
      entityType: 'PHIEU_XUAT_BAN_RETURN_REQUEST',
      entityId: params.voucherId,
      actorId: params.userId,
      reopenedFromStatus: detail.returnRequest.status,
      result: 'BLOCKED',
      blockedDownstreamType: 'RETURNED_SERIAL',
      note: 'Đã có serial trả lại được xử lý. Cần rollback bước sau trước khi mở lại đề nghị trả hàng.',
    })
    throw new Error('Đã có serial trả lại được xử lý. Cần rollback bước sau trước khi mở lại đề nghị trả hàng.')
  }

  const payload = {
    note: detail.note,
    summary: {
      customerName: detail.customerName,
      projectName: detail.projectName,
      maOrder: detail.orderLabel,
      maBaoGia: detail.quoteLabel,
    },
    lines: detail.lines,
    confirmedSerials: detail.confirmedSerials,
    returnedSerials: detail.returnedSerials,
    returnFeatureReady: detail.returnFeatureReady,
  }

  const { error } = await supabase
    .from('phieu_xuat_ban')
    .update({
      ghi_chu: detail.note || null,
      payload_json: payload,
      updated_by: params.userId,
      ngay_thao_tac: formatLocalDate(new Date()),
    })
    .eq('voucher_id', params.voucherId)
    .eq('is_active', true)
  if (error) throw error

  await writeShipmentReopenAudit(supabase, {
    entityType: 'PHIEU_XUAT_BAN_RETURN_REQUEST',
    entityId: params.voucherId,
    actorId: params.userId,
    reopenedFromStatus: detail.returnRequest.status,
    reopenedToStatus: 'NO_RETURN_REQUEST',
    result: 'REOPENED',
    note: 'Mở lại đề nghị trả hàng để KTBH chỉnh sửa lại từ đầu.',
  })

  return {
    requestedCount: 0,
  }
}

export async function reopenConfirmedShipmentVoucher(
  supabase: AnySupabase,
  params: {
    voucherId: string
    userId: string
    userRole: string
  }
): Promise<ShipmentReopenResult> {
  if (!isAdminRole(params.userRole)) {
    throw new Error('Chỉ Admin mới được mở lại phiếu xuất hàng đã xác nhận.')
  }

  const detail = await loadXuatHangVoucherDetail(supabase, params.voucherId, 'admin')
  if (!detail) throw new Error('Không tìm thấy phiếu xuất hàng.')
  if (detail.status === 'CHO_XAC_NHAN') {
    throw new Error('Phiếu này đang ở trạng thái chờ xác nhận, không cần mở lại.')
  }
  if (!detail.confirmedSerials.length) {
    throw new Error('Phiếu này chưa có serial đã xác nhận để mở lại.')
  }
  if (detail.returnRequest || detail.returnedSerials.length > 0) {
    await writeShipmentReopenAudit(supabase, {
      entityType: 'PHIEU_XUAT_BAN',
      entityId: params.voucherId,
      actorId: params.userId,
      reopenedFromStatus: detail.status,
      result: 'BLOCKED',
      blockedDownstreamType: detail.returnRequest ? 'RETURN_REQUEST' : 'RETURNED_SERIAL',
      note: 'Phiếu này đã phát sinh bước trả hàng. Cần rollback bước sau trước khi mở lại phiếu xuất.',
    })
    throw new Error('Phiếu này đã phát sinh bước trả hàng. Cần rollback bước sau trước khi mở lại phiếu xuất.')
  }
  const { count: returnVoucherCount, error: returnVoucherError } = await supabase
    .from('return_voucher')
    .select('return_voucher_id', { count: 'exact', head: true })
    .eq('shipment_voucher_id', params.voucherId)
    .eq('is_active', true)
  if (returnVoucherError) throw returnVoucherError
  if (Number(returnVoucherCount || 0) > 0) {
    await writeShipmentReopenAudit(supabase, {
      entityType: 'PHIEU_XUAT_BAN',
      entityId: params.voucherId,
      actorId: params.userId,
      reopenedFromStatus: detail.status,
      result: 'BLOCKED',
      blockedDownstreamType: 'RETURN_VOUCHER',
      note: 'Phiếu này đã phát sinh phiếu trả hàng downstream. Cần rollback bước sau trước khi mở lại phiếu xuất.',
    })
    throw new Error('Phiếu này đã phát sinh phiếu trả hàng downstream. Cần rollback bước sau trước khi mở lại phiếu xuất.')
  }

  const payload = {
    note: detail.note,
    summary: {
      customerName: detail.customerName,
      projectName: detail.projectName,
      maOrder: detail.orderLabel,
      maBaoGia: detail.quoteLabel,
    },
    lines: detail.lines.map((line) => ({
      ...line,
      actualQty: 0,
    })),
    confirmedSerials: [],
    returnedSerials: [],
    returnFeatureReady: detail.returnFeatureReady,
  }

  const { data: rpcResult, error } = await supabase.rpc('reopen_shipment_voucher_atomic', {
    p_voucher_id: params.voucherId,
    p_user_id: params.userId,
    p_payload_json: payload,
    p_note: detail.note || null,
    p_ngay_thao_tac: formatLocalDate(new Date()),
  })
  if (error) {
    const message = String(error.message || '')
    if (/reopen_shipment_voucher_atomic/i.test(message) || /function .* does not exist/i.test(message)) {
      throw new Error('Thiếu SQL patch reopen phiếu xuất hàng. Cần chạy file sql/reopen_shipment_voucher_atomic.sql trước.')
    }
    throw error
  }

  return {
    status: 'CHO_XAC_NHAN',
    revertedCount: Number(rpcResult || detail.confirmedSerials.length),
  }
}

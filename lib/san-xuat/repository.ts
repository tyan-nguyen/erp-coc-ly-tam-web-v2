import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canViewProductionPlan,
  isAdminRole,
  isQcRole,
  isQlsxRole,
  isSalesAccountingRole,
  isWarehouseRole,
} from '@/lib/auth/roles'
import { writeAuditLog } from '@/lib/audit-log/write'
import { computeBocTachPreview } from '@/lib/boc-tach/calc'
import { loadBocTachReferenceData, loadBocTachDetail } from '@/lib/boc-tach/repository'
import { mapStoredBocTachToPayload } from '@/lib/boc-tach/stored-payload'
import { loadDonHangList } from '@/lib/don-hang/repository'
import { deriveCanonicalMaterialCode } from '@/lib/master-data/nvl'
import { generateLotsAndSerialsFromWarehouseIssue, loadProductionLotsByPlan, type ProductionLotSummary } from '@/lib/pile-serial/repository'
import { buildStockIdentityKey } from '@/lib/ton-kho-thanh-pham/internal'
import { loadNetDeliveredTotalsByOrderSegment } from '@/lib/xuat-hang/repository'

type AnySupabase = SupabaseClient
const BOC_HEADER_ID_CANDIDATES = ['boc_id', 'boc_tach_id', 'id'] as const

function canonicalMaterialKey(materialGroup: string, fallbackKey: string, label: string) {
  return deriveCanonicalMaterialCode({
    materialCode: fallbackKey,
    materialName: label,
    materialGroup,
  })
}

export type KeHoachNgayRow = {
  plan_id: string
  ngay_ke_hoach: string
  trang_thai: 'NHAP' | 'DA_CHOT'
  ghi_chu: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type KeHoachLineRow = {
  line_id: string
  plan_id: string
  order_id: string
  boc_id: string | null
  ma_boc_tach_hien_thi?: string | null
  quote_id: string | null
  ma_order: string | null
  ma_bao_gia: string | null
  khach_hang: string | null
  du_an: string | null
  template_id?: string | null
  ma_coc?: string | null
  loai_coc: string | null
  doan_key: string
  ten_doan: string
  chieu_dai_m: number
  so_luong_dat: number
  so_luong_da_san_xuat: number
  so_luong_da_len_ke_hoach: number
  so_luong_con_lai_tam: number
  so_luong_ke_hoach: number
  thu_tu: number
  ghi_chu: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type KeHoachNgayListItem = {
  plan: KeHoachNgayRow
  lineCount: number
  orderCount: number
  totalPlannedQty: number
}

export type AvailableSegmentOption = {
  orderId: string
  bocId: string | null
  maBocTachHienThi?: string | null
  quoteId: string | null
  maOrder: string
  maBaoGia: string | null
  khachHang: string
  duAn: string
  templateId?: string | null
  maCoc?: string | null
  loaiCoc: string
  doanKey: string
  tenDoan: string
  chieuDaiM: number
  soLuongDat: number
  soLuongDaSanXuat: number
  soLuongDaLenKeHoach: number
  soLuongDaQc: number
  tonKho: number
  soLuongConLaiTam: number
}

export type KeHoachNgayDetail = {
  plan: KeHoachNgayRow
  lines: KeHoachLineRow[]
  availableSegments: AvailableSegmentOption[]
  warehouseIssue: WarehouseIssueDraft | null
  generatedLots: ProductionLotSummary[]
}

export type KeHoachScheduleCell = {
  ngay: string
  qty: number
  md: number
}

export type KeHoachScheduleRow = {
  rowKey: string
  khachHang: string
  duAn: string
  loaiCoc: string
  tenDoan: string
  chieuDaiM: number
  cells: KeHoachScheduleCell[]
}

export type KeHoachScheduleSummary = {
  fromDate: string
  toDate: string
  dates: string[]
  rows: KeHoachScheduleRow[]
  totalQtyByDate: number[]
  totalMdByDate: number[]
}

export type WarehouseIssueMaterialDraft = {
  key: string
  nhom: 'THEP' | 'PHU_KIEN' | 'PHU_GIA' | 'BETONG'
  label: string
  dvt: string
  ratePerUnit: number
  estimateQty: number
  actualQty: number
}

export type WarehouseConcreteRecipeMaterialDraft = {
  key: string
  label: string
  dvt: string
  ratePerM3: number
}

export type WarehouseConcreteVariantOption = {
  value: string
  label: string
}

export type WarehouseConcreteVariantRecipe = {
  variant: string
  label: string
  materials: WarehouseConcreteRecipeMaterialDraft[]
}

export type WarehouseConcreteGradeSummary = {
  concreteGrade: string
  requiredM3: number
  variantOptions: WarehouseConcreteVariantOption[]
  variantRecipes: WarehouseConcreteVariantRecipe[]
  allocations: WarehouseConcreteAllocationDraft[]
}

export type WarehouseIssueMaterialSummary = {
  key: string
  nhom: 'THEP' | 'PHU_KIEN' | 'PHU_GIA' | 'BETONG'
  label: string
  dvt: string
  estimateQty: number
  actualQty: number
}

export type WarehouseConcreteAllocationDraft = {
  variant: string
  volumeM3: number
}

export type WarehouseIssueLineDraft = {
  lineId: string
  actualProductionQty: number
  concreteGrade: string
  concreteRequiredM3: number
  concreteRequiredM3PerUnit: number
  variantOptions: WarehouseConcreteVariantOption[]
  variantRecipes: WarehouseConcreteVariantRecipe[]
  allocations: WarehouseConcreteAllocationDraft[]
  materials: WarehouseIssueMaterialDraft[]
}

export type WarehouseIssueDraft = {
  voucherId: string | null
  locked: boolean
  operationDate: string
  note: string
  lineDrafts: WarehouseIssueLineDraft[]
  concreteSummaries: WarehouseConcreteGradeSummary[]
  materialSummaries: WarehouseIssueMaterialSummary[]
}

export type QcIssueLineResult = {
  lineId: string
  actualQty: number
  acceptedQty: number
  rejectedQty: number
  note: string
}

export type QcSerialResult = {
  serialId: string
  lineId: string
  serialCode: string
  qcStatus: 'CHUA_QC' | 'DAT' | 'LOI'
  dispositionStatus: 'BINH_THUONG' | 'THANH_LY' | 'HUY'
  note: string
}

export type QcIssueDraft = {
  voucherId: string | null
  locked: boolean
  operationDate: string
  note: string
  lineResults: QcIssueLineResult[]
  serialResults: QcSerialResult[]
}

export type QcPlanListItem = KeHoachNgayListItem & {
  qcConfirmed: boolean
}

export type QcNghiemThuDetail = {
  plan: KeHoachNgayRow
  lines: KeHoachLineRow[]
  qcIssue: QcIssueDraft | null
}

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function toRow<T>(row: Record<string, unknown>) {
  return row as unknown as T
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function sortByDateDesc<T extends { ngay_ke_hoach: string }>(rows: T[]) {
  return [...rows].sort((a, b) => String(b.ngay_ke_hoach).localeCompare(String(a.ngay_ke_hoach)))
}

function extractProjectCode(projectCode: string, projectName?: string | null) {
  const normalizedProjectCode = normalizeText(projectCode)
  if (/^DA-[A-Z0-9-]+$/i.test(normalizedProjectCode)) {
    return normalizedProjectCode.toUpperCase()
  }

  const normalizedProjectName = normalizeText(projectName)
  const matchedCode = normalizedProjectName.match(/DA-[A-Z0-9-]+/i)
  if (matchedCode?.[0]) {
    return matchedCode[0].toUpperCase()
  }

  return 'BT'
}

function buildDisplayId(id: string, projectCode: string, loaiCoc: string, projectName?: string | null) {
  const shortId = String(id || '').slice(-6).toUpperCase()
  const projectPart = extractProjectCode(projectCode, projectName)
  return `${projectPart} · ${loaiCoc} · ${shortId}`
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ensureOperationalActionAllowed(planDate: string, actionLabel: string) {
  const normalizedPlanDate = normalizeText(planDate)
  if (!normalizedPlanDate) {
    throw new Error('Kế hoạch ngày chưa có ngày kế hoạch hợp lệ.')
  }

  const today = formatLocalDate(new Date())
  if (normalizedPlanDate > today) {
    throw new Error(`${actionLabel} cho kế hoạch tương lai. Hãy thao tác khi tới ngày ${normalizedPlanDate}.`)
  }

  return today
}

function round3(value: number) {
  const rounded = Math.round(Number(value || 0) * 1000) / 1000
  return Number.isFinite(rounded) ? rounded : 0
}

function summarizeMaterialTotals(materials: Array<{ estimateQty?: number; actualQty?: number }>) {
  const estimatedQty = round3(materials.reduce((sum, item) => sum + toNumber(item.estimateQty), 0))
  const actualQty = round3(materials.reduce((sum, item) => sum + toNumber(item.actualQty), 0))
  return {
    estimatedQty,
    actualQty,
    varianceQty: round3(actualQty - estimatedQty),
  }
}

function isMissingRelationError(error: unknown, relationName: string) {
  const message = String(
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? (error as { message: unknown }).message
        : ''
  ).toLowerCase()

  return (
    (message.includes('relation') && message.includes(relationName.toLowerCase())) ||
    (message.includes('schema cache') && message.includes(relationName.toLowerCase()))
  )
}

async function loadQcSerialRowsByPlan(supabase: AnySupabase, planId: string) {
  const { data, error } = await supabase
    .from('pile_serial')
    .select('serial_id, serial_code, qc_status, disposition_status, notes, lot_id, production_lot!inner(plan_line_id, plan_id)')
    .eq('production_lot.plan_id', planId)
    .eq('is_active', true)
    .order('serial_code', { ascending: true })

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('pile_serial')) ||
      (message.includes('schema cache') && message.includes('pile_serial')) ||
      (message.includes('relation') && message.includes('production_lot')) ||
      (message.includes('schema cache') && message.includes('production_lot'))
    ) {
      return [] as Array<Record<string, unknown>>
    }
    throw error
  }

  return (data ?? []) as Array<Record<string, unknown>>
}

function normalizeConcreteGrade(value: string | null | undefined) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/^M/i, '')
    .toUpperCase()
}

function matchesConcreteGrade(left: string, right: string) {
  const normalizedLeft = normalizeConcreteGrade(left)
  const normalizedRight = normalizeConcreteGrade(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function normalizeConcreteVariant(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
}

function concreteVariantLabel(value: string | null | undefined) {
  const normalized = normalizeConcreteVariant(value) || 'FULL_TRO_XI_XI'
  return normalized.toLowerCase().replace(/_/g, ' ')
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function buildDateRange(fromDate: string, toDate: string) {
  const dates: string[] = []
  const start = new Date(`${fromDate}T00:00:00`)
  const end = new Date(`${toDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return dates
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(formatLocalDate(cursor))
  }
  return dates
}

function materialKindFromName(value: string | null | undefined) {
  const normalized = normalizeText(value)
  if (normalized.includes('THEP') || normalized.includes('PC') || normalized.includes('DAI') || normalized.includes('BUOC')) {
    return 'THEP' as const
  }
  if (
    normalized.includes('MAT BICH') ||
    normalized.includes('MANG XONG') ||
    normalized.includes('MUI COC') ||
    normalized.includes('TAM VUONG') ||
    normalized.includes('TAP')
  ) {
    return 'PHU_KIEN' as const
  }
  return 'PHU_GIA' as const
}

function buildVoucherMaterialRowsByConcrete(
  variants: WarehouseConcreteVariantRecipe[],
  allocations: WarehouseConcreteAllocationDraft[]
) {
  const bucket = new Map<string, WarehouseIssueMaterialDraft>()

  for (const allocation of allocations) {
    const recipe = variants.find((item) => item.variant === allocation.variant)
    if (!recipe) continue
    for (const material of recipe.materials) {
      const key = `BETONG::${material.key}`
      const estimateQty = round3(material.ratePerM3 * Number(allocation.volumeM3 || 0))
      const current = bucket.get(key)
      if (current) {
        current.estimateQty = round3(current.estimateQty + estimateQty)
        current.actualQty = round3(current.actualQty + estimateQty)
        continue
      }
      bucket.set(key, {
        key,
        nhom: 'BETONG',
        label: material.label,
        dvt: material.dvt,
        ratePerUnit: 0,
        estimateQty,
        actualQty: estimateQty,
      })
    }
  }

  return Array.from(bucket.values()).sort((a, b) => a.label.localeCompare(b.label))
}

function buildWarehouseIssueSummary(
  lineDrafts: WarehouseIssueLineDraft[],
  existingVoucherPayload?: Record<string, unknown> | null
) {
  const storedConcreteAllocationRows = safeArray<Record<string, unknown>>(existingVoucherPayload?.concreteAllocationRows)
  const storedConcreteSummaryMap = new Map(
    safeArray<Record<string, unknown>>(existingVoucherPayload?.concreteSummaries).map((item) => [
      normalizeConcreteGrade(String(item.concreteGrade || '')),
      item,
    ])
  )
  const storedMaterialSummaryMap = new Map(
    safeArray<Record<string, unknown>>(existingVoucherPayload?.materialSummaries).map((item) => [
      String(item.key || ''),
      item,
    ])
  )

  const concreteBucket = new Map<string, WarehouseConcreteGradeSummary>()
  for (const lineDraft of lineDrafts) {
    const key = normalizeConcreteGrade(lineDraft.concreteGrade)
    const existing = concreteBucket.get(key) || {
      concreteGrade: lineDraft.concreteGrade,
      requiredM3: 0,
      variantOptions: lineDraft.variantOptions,
      variantRecipes: lineDraft.variantRecipes,
      allocations: [],
    }
    existing.requiredM3 = round3(existing.requiredM3 + lineDraft.concreteRequiredM3)
    if (!existing.variantOptions.length && lineDraft.variantOptions.length) {
      existing.variantOptions = lineDraft.variantOptions
    }
    if (!existing.variantRecipes.length && lineDraft.variantRecipes.length) {
      existing.variantRecipes = lineDraft.variantRecipes
    }
    concreteBucket.set(key, existing)
  }

  for (const [key, summary] of concreteBucket.entries()) {
    const explicitAllocations = storedConcreteAllocationRows
      .filter((item) => normalizeConcreteGrade(String(item.concreteGrade || '')) === key)
      .map((item) => ({
        variant: normalizeConcreteVariant(String(item.variant || 'FULL_TRO_XI_XI')),
        volumeM3: round3(toNumber(item.volumeM3)),
      }))
    const stored = storedConcreteSummaryMap.get(key)
    const allocations = (explicitAllocations.length > 0 ? explicitAllocations : safeArray<Record<string, unknown>>(stored?.allocations)).map((item) => ({
      variant: normalizeConcreteVariant(String(item.variant || 'FULL_TRO_XI_XI')),
      volumeM3: round3(toNumber(item.volumeM3)),
    }))
    summary.allocations =
      allocations.length > 0
        ? allocations
        : summary.requiredM3 > 0
          ? [{ variant: summary.variantOptions[0]?.value || 'FULL_TRO_XI_XI', volumeM3: summary.requiredM3 }]
          : []
  }

  for (const [key, stored] of storedConcreteSummaryMap.entries()) {
    if (concreteBucket.has(key)) continue
    const concreteGrade = String(stored?.concreteGrade || '')
    const explicitAllocations = storedConcreteAllocationRows
      .filter((item) => normalizeConcreteGrade(String(item.concreteGrade || '')) === key)
      .map((item) => ({
        variant: normalizeConcreteVariant(String(item.variant || 'FULL_TRO_XI_XI')),
        volumeM3: round3(toNumber(item.volumeM3)),
      }))
    const allocations = (explicitAllocations.length > 0 ? explicitAllocations : safeArray<Record<string, unknown>>(stored?.allocations)).map((item) => ({
      variant: normalizeConcreteVariant(String(item.variant || 'FULL_TRO_XI_XI')),
      volumeM3: round3(toNumber(item.volumeM3)),
    }))
    concreteBucket.set(key, {
      concreteGrade,
      requiredM3: round3(toNumber(stored?.requiredM3)),
      variantOptions: [],
      variantRecipes: [],
      allocations,
    })
  }

  const materialBucket = new Map<string, WarehouseIssueMaterialSummary>()
  for (const lineDraft of lineDrafts) {
    for (const material of lineDraft.materials.filter((item) => item.nhom !== 'BETONG')) {
      const current = materialBucket.get(material.key)
      const estimateQty = round3(toNumber(material.estimateQty))
      if (current) {
        current.estimateQty = round3(current.estimateQty + estimateQty)
        continue
      }
      materialBucket.set(material.key, {
        key: material.key,
        nhom: material.nhom,
        label: material.label,
        dvt: material.dvt,
        estimateQty,
        actualQty: estimateQty,
      })
    }
  }

  for (const summary of concreteBucket.values()) {
    for (const material of buildVoucherMaterialRowsByConcrete(summary.variantRecipes, summary.allocations)) {
      const current = materialBucket.get(material.key)
      if (current) {
        current.estimateQty = round3(current.estimateQty + material.estimateQty)
        continue
      }
      materialBucket.set(material.key, {
        key: material.key,
        nhom: material.nhom,
        label: material.label,
        dvt: material.dvt,
        estimateQty: material.estimateQty,
        actualQty: material.estimateQty,
      })
    }
  }

  const materialSummaries = Array.from(materialBucket.values())
    .map((item) => ({
      ...item,
      actualQty: round3(toNumber(storedMaterialSummaryMap.get(item.key)?.actualQty, item.estimateQty)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return {
    concreteSummaries: Array.from(concreteBucket.values()).sort((a, b) =>
      a.concreteGrade.localeCompare(b.concreteGrade)
    ),
    materialSummaries,
  }
}

function parseOrderSegments(raw: unknown) {
  if (!Array.isArray(raw)) return [] as Array<{
    templateId?: string | null
    maCoc?: string | null
    doanKey: string
    tenDoan: string
    chieuDaiM: number
    soLuongDat: number
  }>

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

function buildOrderDeliveryKey(
  orderId: string,
  identity: { templateId?: string | null; maCoc?: string | null; loaiCoc: string },
  tenDoan: string,
  chieuDaiM: number
) {
  return `${normalizeText(orderId)}::${buildStockIdentityKey(identity)}::${normalizeText(tenDoan)}::${round3(Number(chieuDaiM || 0))}`
}

async function loadPlannedTotalsBySegment(supabase: AnySupabase) {
  const totals = new Map<string, number>()
  const { data, error } = await supabase
    .from('ke_hoach_sx_line')
    .select('order_id, doan_key, so_luong_ke_hoach')
    .eq('is_active', true)

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('relation') || message.includes('schema cache')) {
      return totals
    }
    throw error
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
    totals.set(key, (totals.get(key) ?? 0) + toNumber(row.so_luong_ke_hoach))
  }

  return totals
}

async function loadProducedTotalsBySegment(supabase: AnySupabase) {
  const totals = new Map<string, number>()
  const { data, error } = await supabase
    .from('ke_hoach_sx_line')
    .select('order_id, doan_key, so_luong_da_san_xuat')
    .eq('is_active', true)

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('relation') || message.includes('schema cache')) {
      return totals
    }
    throw error
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
    totals.set(key, (totals.get(key) ?? 0) + toNumber(row.so_luong_da_san_xuat))
  }

  return totals
}

async function loadLatestStageTotalsBySegment(supabase: AnySupabase) {
  const stageTotals = new Map<string, number>()
  const qcAcceptedTotals = new Map<string, number>()

  const [{ data: lineRows, error: lineError }, { data: qcSerialRows, error: qcSerialError }] = await Promise.all([
    supabase
      .from('ke_hoach_sx_line')
      .select('line_id, order_id, doan_key, so_luong_ke_hoach, so_luong_da_san_xuat')
      .eq('is_active', true),
    supabase
      .from('pile_serial')
      .select('qc_status, production_lot!inner(plan_line_id)')
      .eq('is_active', true)
      .neq('qc_status', 'CHUA_QC'),
  ])

  if (lineError) {
    const message = String(lineError.message || '').toLowerCase()
    if (message.includes('relation') || message.includes('schema cache')) {
      return { stageTotals, qcAcceptedTotals }
    }
    throw lineError
  }

  if (qcSerialError) {
    const message = String(qcSerialError.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('pile_serial')) ||
      (message.includes('schema cache') && message.includes('pile_serial'))
    ) {
      for (const row of (lineRows ?? []) as Array<Record<string, unknown>>) {
        const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
        const plannedQty = toNumber(row.so_luong_ke_hoach)
        const producedQty = toNumber(row.so_luong_da_san_xuat)
        const latestQty = producedQty > 0 ? producedQty : plannedQty
        stageTotals.set(key, round3((stageTotals.get(key) ?? 0) + latestQty))
      }
      return { stageTotals, qcAcceptedTotals }
    }
    throw qcSerialError
  }

  const qcByLine = new Map<string, { hasQcResult: boolean; acceptedQty: number }>()
  for (const row of (qcSerialRows ?? []) as Array<Record<string, unknown>>) {
    const productionLot = (row.production_lot as Record<string, unknown> | null) || {}
    const lineId = String(productionLot.plan_line_id ?? '')
    if (!lineId) continue
    const current = qcByLine.get(lineId) || { hasQcResult: false, acceptedQty: 0 }
    current.hasQcResult = true
    if (String(row.qc_status ?? '') === 'DAT') {
      current.acceptedQty += 1
    }
    qcByLine.set(lineId, current)
  }

  for (const row of (lineRows ?? []) as Array<Record<string, unknown>>) {
    const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
    const lineId = String(row.line_id ?? '')
    const plannedQty = toNumber(row.so_luong_ke_hoach)
    const producedQty = toNumber(row.so_luong_da_san_xuat)
    const qcState = qcByLine.get(lineId)
    const acceptedQty = round3(qcState?.acceptedQty ?? 0)
    const latestQty = qcState?.hasQcResult ? acceptedQty : producedQty > 0 ? producedQty : plannedQty

    stageTotals.set(key, round3((stageTotals.get(key) ?? 0) + latestQty))
    if (acceptedQty > 0) {
      qcAcceptedTotals.set(key, round3((qcAcceptedTotals.get(key) ?? 0) + acceptedQty))
    }
  }

  return { stageTotals, qcAcceptedTotals }
}

async function loadInStockTotalsBySegment(supabase: AnySupabase) {
  const totals = new Map<string, number>()
  const { data, error } = await supabase
    .from('pile_serial')
    .select('serial_id, template_id, ma_coc, loai_coc, ten_doan, chieu_dai_m, lifecycle_status, visible_in_project, visible_in_retail')
    .eq('is_active', true)
    .eq('lifecycle_status', 'TRONG_KHO')

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('pile_serial')) ||
      (message.includes('schema cache') && message.includes('pile_serial'))
    ) {
      return totals
    }
    throw error
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const visibleInProject = Boolean(row.visible_in_project)
    const visibleInRetail = Boolean(row.visible_in_retail)
    if (!visibleInProject && !visibleInRetail) continue

    const key = [
      buildStockIdentityKey({
        templateId: normalizeText(row.template_id),
        maCoc: normalizeText(row.ma_coc),
        loaiCoc: normalizeText(row.loai_coc),
      }),
      normalizeText(row.ten_doan),
      String(round3(toNumber(row.chieu_dai_m))),
    ].join('::')
    totals.set(key, (totals.get(key) ?? 0) + 1)
  }

  return totals
}

async function loadBocProjectCodeMap(supabase: AnySupabase, bocIds: string[]) {
  const map = new Map<string, string>()
  const ids = unique(bocIds)
  if (!ids.length) return map

  const rows: Array<Record<string, unknown>> = []
  for (const idField of BOC_HEADER_ID_CANDIDATES) {
    const { data, error } = await supabase
      .from('boc_tach_nvl')
      .select(`${idField}, da_id`)
      .in(idField, ids)

    if (error) {
      const message = String(error.message || '').toLowerCase()
      if (message.includes('column') || message.includes('schema cache')) {
        continue
      }
      throw error
    }

    rows.push(...(((data ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, __idField: idField }))))
  }

  const projectIds = unique(
    rows.map((row) => String(row.da_id ?? ''))
  )
  const { data: projectRows, error: projectError } = await supabase
    .from('dm_duan')
    .select('da_id, ma_da')
    .in('da_id', projectIds)

  if (projectError) throw projectError

  const projectCodeMap = new Map(
    ((projectRows ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.da_id ?? ''),
      String(row.ma_da ?? ''),
    ])
  )

  for (const row of rows) {
    const idField = String(row.__idField ?? '')
    const bocId = String(row[idField] ?? '')
    const daId = String(row.da_id ?? '')
    if (bocId) {
      map.set(bocId, projectCodeMap.get(daId) || daId)
    }
  }

  return map
}

async function loadWarehouseIssueVoucher(
  supabase: AnySupabase,
  planId: string,
  options?: { activeOnly?: boolean }
) {
  let query = supabase
    .from('sx_xuat_nvl')
    .select('voucher_id, ngay_thao_tac, ghi_chu, payload_json, is_active, updated_at, created_at')
    .eq('plan_id', planId)

  if (options?.activeOnly) {
    query = query.eq('is_active', true)
  } else {
    query = query.order('is_active', { ascending: false }).order('updated_at', { ascending: false }).limit(1)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('sx_xuat_nvl')) ||
      (message.includes('schema cache') && message.includes('sx_xuat_nvl'))
    ) {
      return null
    }
    throw error
  }

  return (data ?? null) as Record<string, unknown> | null
}

async function loadQcIssueVoucher(
  supabase: AnySupabase,
  planId: string,
  options?: { activeOnly?: boolean }
) {
  let query = supabase
    .from('sx_qc_nghiem_thu')
    .select('voucher_id, ngay_thao_tac, ghi_chu, payload_json, is_active, updated_at, created_at')
    .eq('plan_id', planId)

  if (options?.activeOnly) {
    query = query.eq('is_active', true)
  } else {
    query = query.order('is_active', { ascending: false }).order('updated_at', { ascending: false }).limit(1)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (
      (message.includes('relation') && message.includes('sx_qc_nghiem_thu')) ||
      (message.includes('schema cache') && message.includes('sx_qc_nghiem_thu'))
    ) {
      return null
    }
    throw error
  }

  return (data ?? null) as Record<string, unknown> | null
}

export async function hasWarehouseIssueVoucher(supabase: AnySupabase, planId: string) {
  const voucher = await loadWarehouseIssueVoucher(supabase, planId, { activeOnly: true })
  return Boolean(voucher?.voucher_id)
}

export async function hasQcIssueVoucher(supabase: AnySupabase, planId: string) {
  const voucher = await loadQcIssueVoucher(supabase, planId, { activeOnly: true })
  return Boolean(voucher?.voucher_id)
}

export async function moLaiWarehouseIssueVoucher(
  supabase: AnySupabase,
  params: { planId: string; userId: string }
) {
  const existingVoucher = await loadWarehouseIssueVoucher(supabase, params.planId, { activeOnly: true })
  if (!existingVoucher?.voucher_id) {
    throw new Error('Không tìm thấy phiếu thực sản xuất và xuất NVL để mở lại.')
  }

  const voucherId = String(existingVoucher.voucher_id || '')
  const { data: rpcResult, error } = await supabase.rpc('reopen_warehouse_issue_voucher_atomic', {
    p_plan_id: params.planId,
    p_user_id: params.userId,
  })

  if (error) {
    const rawMessage = String(error.message || '')
    if (
      /reopen_warehouse_issue_voucher_atomic/i.test(rawMessage) ||
      /function .* does not exist/i.test(rawMessage)
    ) {
      throw new Error(
        'Thiếu SQL patch reopen phiếu thực sản xuất và xuất NVL. Cần chạy file sql/reopen_warehouse_issue_voucher_atomic.sql trước.'
      )
    }
    throw new Error(rawMessage || 'Không mở lại được phiếu thực sản xuất và xuất NVL.')
  }

  const payload = rpcResult && typeof rpcResult === 'object' ? (rpcResult as Record<string, unknown>) : {}

  return {
    voucherId: String(payload.voucherId || voucherId),
    deletedMovementCount: Number(payload.deletedMovementCount || 0),
  }
}

function findStoredMaterial(
  lineDraft: Record<string, unknown> | null | undefined,
  key: string
) {
  const materials = safeArray<Record<string, unknown>>(lineDraft?.materials)
  return materials.find((item) => String(item.key ?? '') === key) || null
}

function findDisplayMaterialName(
  items: Array<Record<string, unknown>>,
  kind: 'PC' | 'DAI' | 'BUOC' | 'MAT_BICH' | 'MANG_XONG' | 'MUI_COC' | 'TAP'
) {
  const matchers = {
    PC: ['PC'],
    DAI: ['DAI'],
    BUOC: ['BUOC'],
    MAT_BICH: ['MAT BICH'],
    MANG_XONG: ['MANG XONG'],
    MUI_COC: ['MUI COC'],
    TAP: ['TAM VUONG', 'TAP'],
  } satisfies Record<string, string[]>

  const targetTokens = matchers[kind]
  const matched = items.find((item) => {
    const normalized = normalizeText(String(item.ten_nvl ?? ''))
    return targetTokens.some((token) => normalized.includes(token))
  })

  return {
    label: String(matched?.ten_nvl || '').trim() || kind.replace(/_/g, ' '),
    dvt: String(matched?.dvt || '').trim() || (kind === 'PC' || kind === 'DAI' || kind === 'BUOC' ? 'kg' : 'cái'),
  }
}

async function buildWarehouseIssueDraft(
  supabase: AnySupabase,
  planId: string,
  lines: KeHoachLineRow[],
  options?: { quantityMode?: 'ACTUAL' | 'PLANNED' }
) {
  const existingVoucher = await loadWarehouseIssueVoucher(supabase, planId, { activeOnly: true })
  const existingLineDrafts = new Map(
    safeArray<Record<string, unknown>>((existingVoucher?.payload_json as Record<string, unknown> | null)?.lineDrafts).map((item) => [
      String(item.lineId ?? ''),
      item,
    ])
  )
  const refs = await loadBocTachReferenceData(supabase)

  const lineDrafts = await Promise.all(
    lines.map(async (line) => {
      const existingLineDraft = existingLineDrafts.get(String(line.line_id))
      const actualProductionQty = toNumber(
        existingLineDraft?.actualProductionQty,
        options?.quantityMode === 'PLANNED' ? toNumber(line.so_luong_ke_hoach) : toNumber(line.so_luong_da_san_xuat)
      )
      if (!line.boc_id) {
        return {
          lineId: line.line_id,
          actualProductionQty,
          concreteGrade: '',
          concreteRequiredM3: 0,
          concreteRequiredM3PerUnit: 0,
          variantOptions: [],
          variantRecipes: [],
          allocations: [],
          materials: [],
        } satisfies WarehouseIssueLineDraft
      }

      const detail = await loadBocTachDetail(supabase, line.boc_id)
      if (!detail.header) {
        return {
          lineId: line.line_id,
          actualProductionQty,
          concreteGrade: '',
          concreteRequiredM3: 0,
          concreteRequiredM3PerUnit: 0,
          variantOptions: [],
          variantRecipes: [],
          allocations: [],
          materials: [],
        } satisfies WarehouseIssueLineDraft
      }

      const payload = mapStoredBocTachToPayload(line.boc_id, detail.header, detail.items, detail.segments, refs)
      const preview = computeBocTachPreview(payload, refs)
      const segmentSnapshot =
        preview.segment_snapshots.find((snapshot) => normalizeText(snapshot.ten_doan) === normalizeText(line.ten_doan)) ||
        null

      if (!segmentSnapshot) {
        return {
          lineId: line.line_id,
          actualProductionQty,
          concreteGrade: String(payload.header.mac_be_tong || ''),
          concreteRequiredM3: 0,
          concreteRequiredM3PerUnit: 0,
          variantOptions: [],
          variantRecipes: [],
          allocations: [],
          materials: [],
        } satisfies WarehouseIssueLineDraft
      }

      const segmentQtyBase = Math.max(Number(segmentSnapshot.so_luong_doan || 0), 1)
      const concreteRequiredM3PerUnit = round3(Number(segmentSnapshot.concrete_m3 || 0) / segmentQtyBase)
      const concreteRequiredM3 = round3(concreteRequiredM3PerUnit * actualProductionQty)
      const concreteRows = refs.concreteMixes.filter((row) =>
        matchesConcreteGrade(String(row.mac_be_tong || ''), String(payload.header.mac_be_tong || ''))
      )
      const recipeMap = new Map<string, WarehouseConcreteVariantRecipe>()
      for (const concreteRow of concreteRows) {
        const variant = normalizeConcreteVariant(concreteRow.variant || 'FULL_TRO_XI_XI')
        const current = recipeMap.get(variant) || {
          variant,
          label: concreteVariantLabel(variant),
          materials: [],
        }
        current.materials.push({
          key: String(concreteRow.nvl_id || concreteRow.ten_nvl || '').trim(),
          label: String(concreteRow.ten_nvl || '').trim(),
          dvt: String(concreteRow.dvt || '').trim() || 'kg',
          ratePerM3: round3(toNumber(concreteRow.dinh_muc_m3)),
        })
        recipeMap.set(variant, current)
      }

      const variantRecipes = Array.from(recipeMap.values()).sort((a, b) => a.label.localeCompare(b.label))
      const variantOptions = variantRecipes.map((recipe) => ({
        value: recipe.variant,
        label: recipe.label,
      }))
      const defaultVariant =
        variantOptions.find((item) => item.value === 'FULL_TRO_XI_XI')?.value ||
        variantOptions[0]?.value ||
        'FULL_TRO_XI_XI'

      const allocations = (() => {
        const stored = safeArray<Record<string, unknown>>(existingLineDraft?.allocations).map((item) => ({
          variant: normalizeConcreteVariant(String(item.variant || defaultVariant)),
          volumeM3: round3(toNumber(item.volumeM3)),
        }))
        if (stored.length) return stored
        return concreteRequiredM3 > 0 ? [{ variant: defaultVariant, volumeM3: concreteRequiredM3 }] : []
      })()

      const pcMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'PC')
      const daiMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'DAI')
      const buocMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'BUOC')
      const matBichMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'MAT_BICH')
      const mangXongMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'MANG_XONG')
      const muiCocMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'MUI_COC')
      const tapMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'TAP')

      const baseMaterials: WarehouseIssueMaterialDraft[] = [
        segmentSnapshot.pc_kg > 0
          ? {
              key: canonicalMaterialKey('THEP', 'THEP::PC', pcMaterial.label),
              nhom: 'THEP',
              label: pcMaterial.label,
              dvt: pcMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.pc_kg || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        segmentSnapshot.dai_kg > 0
          ? {
              key: canonicalMaterialKey('THEP', 'THEP::DAI', daiMaterial.label),
              nhom: 'THEP',
              label: daiMaterial.label,
              dvt: daiMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.dai_kg || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        segmentSnapshot.thep_buoc_kg > 0
          ? {
              key: canonicalMaterialKey('THEP', 'THEP::BUOC', buocMaterial.label),
              nhom: 'THEP',
              label: buocMaterial.label,
              dvt: buocMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.thep_buoc_kg || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        segmentSnapshot.mat_bich > 0
          ? {
              key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::MAT_BICH', matBichMaterial.label),
              nhom: 'PHU_KIEN',
              label: matBichMaterial.label,
              dvt: matBichMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.mat_bich || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        segmentSnapshot.mang_xong > 0
          ? {
              key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::MANG_XONG', mangXongMaterial.label),
              nhom: 'PHU_KIEN',
              label: mangXongMaterial.label,
              dvt: mangXongMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.mang_xong || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        segmentSnapshot.mui_coc > 0
          ? {
              key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::MUI_COC', muiCocMaterial.label),
              nhom: 'PHU_KIEN',
              label: muiCocMaterial.label,
              dvt: muiCocMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.mui_coc || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        segmentSnapshot.tap > 0
          ? {
              key: 'PHU_KIEN::TAP',
              nhom: 'PHU_KIEN',
              label: tapMaterial.label,
              dvt: tapMaterial.dvt,
              ratePerUnit: round3(Number(segmentSnapshot.tap || 0) / segmentQtyBase),
              estimateQty: 0,
              actualQty: 0,
            }
          : null,
        ...safeArray<Record<string, unknown>>(segmentSnapshot.auxiliary_items).map((item) => ({
          key: `PHU_GIA::${String(item.nvl_id || item.ten_nvl || '')}`,
          nhom: materialKindFromName(String(item.ten_nvl || '')),
          label: String(item.ten_nvl || '').trim(),
          dvt: String(item.dvt || '').trim() || 'kg',
          ratePerUnit: round3(toNumber(item.qty) / segmentQtyBase),
          estimateQty: 0,
          actualQty: 0,
        })),
      ].filter((item): item is WarehouseIssueMaterialDraft => Boolean(item))

      const baseMaterialRows = baseMaterials.map((item) => {
        const estimateQty = round3(item.ratePerUnit * actualProductionQty)
        const storedMaterial = findStoredMaterial(existingLineDraft, item.key)
        return {
          ...item,
          estimateQty,
          actualQty: round3(toNumber(storedMaterial?.actualQty, estimateQty)),
        }
      })

      const concreteMaterialRows = buildVoucherMaterialRowsByConcrete(variantRecipes, allocations).map((item) => {
        const storedMaterial = findStoredMaterial(existingLineDraft, item.key)
        return {
          ...item,
          actualQty: round3(toNumber(storedMaterial?.actualQty, item.estimateQty)),
        }
      })

      return {
        lineId: line.line_id,
        actualProductionQty,
        concreteGrade: String(payload.header.mac_be_tong || ''),
        concreteRequiredM3,
        concreteRequiredM3PerUnit,
        variantOptions,
        variantRecipes,
        allocations,
        materials: [...baseMaterialRows, ...concreteMaterialRows],
      } satisfies WarehouseIssueLineDraft
    })
  )

  const existingPayload = (existingVoucher?.payload_json as Record<string, unknown> | null) || null
  const summary = buildWarehouseIssueSummary(lineDrafts, existingPayload)

  return {
    voucherId: existingVoucher?.voucher_id && Boolean(existingVoucher?.is_active) ? String(existingVoucher.voucher_id) : null,
    locked: Boolean(existingVoucher?.voucher_id && existingVoucher?.is_active),
    operationDate:
      String(existingPayload?.operationDate || existingVoucher?.ngay_thao_tac || formatLocalDate(new Date())),
    note: String(existingPayload?.note || existingVoucher?.ghi_chu || ''),
    lineDrafts,
    concreteSummaries: summary.concreteSummaries,
    materialSummaries: summary.materialSummaries,
  } satisfies WarehouseIssueDraft
}

export async function loadKeHoachNgayMaterialDemand(
  supabase: AnySupabase,
  planId: string
) {
  const [{ data: planRow, error: planError }, { data: lineRows, error: lineError }] = await Promise.all([
    supabase
      .from('ke_hoach_sx_ngay')
      .select('plan_id, ngay_ke_hoach, trang_thai')
      .eq('plan_id', planId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('ke_hoach_sx_line')
      .select(
        'line_id, plan_id, order_id, boc_id, quote_id, loai_coc, doan_key, ten_doan, chieu_dai_m, so_luong_dat, so_luong_da_san_xuat, so_luong_da_len_ke_hoach, so_luong_con_lai_tam, so_luong_ke_hoach, thu_tu, ghi_chu, is_active, created_at, updated_at, created_by, updated_by'
      )
      .eq('plan_id', planId)
      .eq('is_active', true)
      .order('thu_tu', { ascending: true }),
  ])

  if (planError) throw planError
  if (lineError) throw lineError
  if (!planRow) return null
  if (String(planRow.trang_thai ?? '') !== 'DA_CHOT') return null

  const mappedLines = ((lineRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...toRow<KeHoachLineRow>(row),
    chieu_dai_m: toNumber(row.chieu_dai_m),
    so_luong_dat: toNumber(row.so_luong_dat),
    so_luong_da_san_xuat: toNumber(row.so_luong_da_san_xuat),
    so_luong_da_len_ke_hoach: toNumber(row.so_luong_da_len_ke_hoach),
    so_luong_con_lai_tam: toNumber(row.so_luong_con_lai_tam),
    so_luong_ke_hoach: toNumber(row.so_luong_ke_hoach),
  }))

  const refs = await loadBocTachReferenceData(supabase)

  const demandBucket = new Map<
    string,
    {
      key: string
      nhom: WarehouseIssueMaterialSummary['nhom']
      label: string
      dvt: string
      estimateQty: number
      actualQty: number
    }
  >()
  const lineDebugs: Array<{
    lineId: string
    tenDoan: string
    plannedQty: number
    segmentQtyBase: number
    positiveMaterialCount: number
    concretePerUnit: number
    pcPerUnit: number
    daiPerUnit: number
    buocPerUnit: number
  }> = []

  function addDemandRow(params: {
    key: string
    nhom: WarehouseIssueMaterialSummary['nhom']
    label: string
    dvt: string
    estimateQty: number
  }) {
    const key = String(params.key || '').trim()
    if (!key) return
    const estimateQty = round3(toNumber(params.estimateQty))
    if (estimateQty <= 0) return
    const current = demandBucket.get(key) || {
      key,
      nhom: params.nhom,
      label: params.label,
      dvt: params.dvt,
      estimateQty: 0,
      actualQty: 0,
    }
    current.estimateQty = round3(current.estimateQty + estimateQty)
    current.actualQty = current.estimateQty
    demandBucket.set(key, current)
  }

  await Promise.all(
    mappedLines.map(async (line) => {
      const plannedQty = round3(toNumber(line.so_luong_ke_hoach))
      if (!line.boc_id || plannedQty <= 0) {
        lineDebugs.push({
          lineId: String(line.line_id || ''),
          tenDoan: String(line.ten_doan || ''),
          plannedQty,
          segmentQtyBase: 0,
          positiveMaterialCount: 0,
          concretePerUnit: 0,
          pcPerUnit: 0,
          daiPerUnit: 0,
          buocPerUnit: 0,
        })
        return
      }

      const detail = await loadBocTachDetail(supabase, line.boc_id)
      if (!detail.header) {
        lineDebugs.push({
          lineId: String(line.line_id || ''),
          tenDoan: String(line.ten_doan || ''),
          plannedQty,
          segmentQtyBase: 0,
          positiveMaterialCount: 0,
          concretePerUnit: 0,
          pcPerUnit: 0,
          daiPerUnit: 0,
          buocPerUnit: 0,
        })
        return
      }

      const payload = mapStoredBocTachToPayload(line.boc_id, detail.header, detail.items, detail.segments, refs)
      const preview = computeBocTachPreview(payload, refs)
      const segmentSnapshot =
        preview.segment_snapshots.find((snapshot) => normalizeText(snapshot.ten_doan) === normalizeText(line.ten_doan)) ||
        null

      if (!segmentSnapshot) {
        lineDebugs.push({
          lineId: String(line.line_id || ''),
          tenDoan: String(line.ten_doan || ''),
          plannedQty,
          segmentQtyBase: 0,
          positiveMaterialCount: 0,
          concretePerUnit: 0,
          pcPerUnit: 0,
          daiPerUnit: 0,
          buocPerUnit: 0,
        })
        return
      }

      const segmentQtyBase = Math.max(Number(segmentSnapshot.so_luong_doan || 0), 1)
      let positiveMaterialCount = 0
      const pcMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'PC')
      const daiMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'DAI')
      const buocMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'BUOC')
      const matBichMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'MAT_BICH')
      const mangXongMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'MANG_XONG')
      const muiCocMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'MUI_COC')
      const tapMaterial = findDisplayMaterialName(payload.items as Array<Record<string, unknown>>, 'TAP')

      addDemandRow({
        key: canonicalMaterialKey('THEP', 'THEP::PC', pcMaterial.label),
        nhom: 'THEP',
        label: pcMaterial.label,
        dvt: pcMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.pc_kg || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.pc_kg || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1
      addDemandRow({
        key: canonicalMaterialKey('THEP', 'THEP::DAI', daiMaterial.label),
        nhom: 'THEP',
        label: daiMaterial.label,
        dvt: daiMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.dai_kg || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.dai_kg || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1
      addDemandRow({
        key: canonicalMaterialKey('THEP', 'THEP::BUOC', buocMaterial.label),
        nhom: 'THEP',
        label: buocMaterial.label,
        dvt: buocMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.thep_buoc_kg || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.thep_buoc_kg || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1
      addDemandRow({
        key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::MAT_BICH', matBichMaterial.label),
        nhom: 'PHU_KIEN',
        label: matBichMaterial.label,
        dvt: matBichMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.mat_bich || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.mat_bich || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1
      addDemandRow({
        key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::MANG_XONG', mangXongMaterial.label),
        nhom: 'PHU_KIEN',
        label: mangXongMaterial.label,
        dvt: mangXongMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.mang_xong || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.mang_xong || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1
      addDemandRow({
        key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::MUI_COC', muiCocMaterial.label),
        nhom: 'PHU_KIEN',
        label: muiCocMaterial.label,
        dvt: muiCocMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.mui_coc || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.mui_coc || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1
      addDemandRow({
        key: canonicalMaterialKey('PHU_KIEN', 'PHU_KIEN::TAP', tapMaterial.label),
        nhom: 'PHU_KIEN',
        label: tapMaterial.label,
        dvt: tapMaterial.dvt,
        estimateQty: round3((Number(segmentSnapshot.tap || 0) / segmentQtyBase) * plannedQty),
      })
      if (round3((Number(segmentSnapshot.tap || 0) / segmentQtyBase) * plannedQty) > 0) positiveMaterialCount += 1

      for (const item of safeArray<Record<string, unknown>>(segmentSnapshot.auxiliary_items)) {
        const itemKey = String(item.nvl_id || item.ten_nvl || '').trim()
        const estimateQty = round3((toNumber(item.qty) / segmentQtyBase) * plannedQty)
        addDemandRow({
          key: `PHU_GIA::${itemKey}`,
          nhom: materialKindFromName(String(item.ten_nvl || '')),
          label: String(item.ten_nvl || '').trim(),
          dvt: String(item.dvt || '').trim() || 'kg',
          estimateQty,
        })
        if (estimateQty > 0) positiveMaterialCount += 1
      }

      for (const item of safeArray<Record<string, unknown>>(segmentSnapshot.cap_phoi_items)) {
        const itemKey = String(item.nvl_id || item.ten_nvl || '').trim()
        const estimateQty = round3((toNumber(item.qty) / segmentQtyBase) * plannedQty)
        addDemandRow({
          key: `BETONG::${itemKey}`,
          nhom: 'BETONG',
          label: String(item.ten_nvl || '').trim(),
          dvt: String(item.dvt || '').trim() || 'kg',
          estimateQty,
        })
        if (estimateQty > 0) positiveMaterialCount += 1
      }

      lineDebugs.push({
        lineId: String(line.line_id || ''),
        tenDoan: String(line.ten_doan || ''),
        plannedQty,
        segmentQtyBase,
        positiveMaterialCount,
        concretePerUnit: round3(Number(segmentSnapshot.concrete_m3 || 0) / segmentQtyBase),
        pcPerUnit: round3(Number(segmentSnapshot.pc_kg || 0) / segmentQtyBase),
        daiPerUnit: round3(Number(segmentSnapshot.dai_kg || 0) / segmentQtyBase),
        buocPerUnit: round3(Number(segmentSnapshot.thep_buoc_kg || 0) / segmentQtyBase),
      })
    })
  )

  const materialSummaries = Array.from(demandBucket.values()).sort((a, b) => a.label.localeCompare(b.label))
  const overrunLineCount = mappedLines.filter((line) => toNumber(line.so_luong_da_len_ke_hoach) - toNumber(line.so_luong_dat) > 0.0001).length

  return {
    planId: String(planRow.plan_id || ''),
    ngayKeHoach: String(planRow.ngay_ke_hoach || ''),
    plannedQtyTotal: round3(mappedLines.reduce((sum, line) => sum + toNumber(line.so_luong_ke_hoach), 0)),
    lineCount: mappedLines.length,
    hasOverrunRisk: overrunLineCount > 0,
    overrunLineCount,
    lineDebugs: lineDebugs.sort((a, b) => a.tenDoan.localeCompare(b.tenDoan)),
    materialSummaries,
  }
}

async function buildAvailableSegments(supabase: AnySupabase) {
  const [approvedOrders, latestStageSummary, inStockTotals, netDeliveredTotals] = await Promise.all([
    loadDonHangList(supabase, {
      viewerRole: 'qlsx',
    }),
    loadLatestStageTotalsBySegment(supabase),
    loadInStockTotalsBySegment(supabase),
    loadNetDeliveredTotalsByOrderSegment(supabase),
  ])
  const bocProjectCodeMap = await loadBocProjectCodeMap(
    supabase,
    approvedOrders.map((item) => String(item.order.boc_id || '')).filter(Boolean)
  )

  return approvedOrders.flatMap((item) => {
    const segments = parseOrderSegments(item.order.to_hop_doan)
    return segments
      .map((segment) => {
      const key = `${item.order.order_id}::${segment.doanKey}`
      const soLuongDaLenKeHoach = latestStageSummary.stageTotals.get(key) ?? 0
      const soLuongDaSanXuat = 0
      const soLuongDaQc = latestStageSummary.qcAcceptedTotals.get(key) ?? 0
      const tonKhoKey = [
        buildStockIdentityKey({
          templateId: segment.templateId || null,
          maCoc: segment.maCoc || null,
          loaiCoc: item.order.loai_coc,
        }),
        normalizeText(segment.tenDoan),
        String(round3(Number(segment.chieuDaiM || 0))),
      ].join('::')
      const tonKho = inStockTotals.get(tonKhoKey) ?? 0
      const deliveredKey = buildOrderDeliveryKey(
        item.order.order_id,
        {
          templateId: segment.templateId || null,
          maCoc: segment.maCoc || null,
          loaiCoc: item.order.loai_coc,
        },
        segment.tenDoan,
        Number(segment.chieuDaiM || 0)
      )
      const soLuongDaGiaoRong = netDeliveredTotals.get(deliveredKey) ?? 0
      const soLuongConLaiTam = Math.max(Number(segment.soLuongDat || 0) - soLuongDaGiaoRong, 0)

      return {
        orderId: item.order.order_id,
        bocId: item.order.boc_id || null,
        maBocTachHienThi: item.order.boc_id
          ? buildDisplayId(
              String(item.order.boc_id),
              bocProjectCodeMap.get(String(item.order.boc_id)) || String(item.order.da_id || ''),
              item.order.loai_coc,
              item.duAnName
            )
          : null,
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
        soLuongDaSanXuat,
        soLuongDaLenKeHoach,
        soLuongDaQc,
        tonKho,
        soLuongConLaiTam,
      } satisfies AvailableSegmentOption
      })
      .filter((row) => Number(row.soLuongConLaiTam || 0) > 0)
  })
}

export async function loadKeHoachNgayDraftSegments(
  supabase: AnySupabase,
  viewerRole: string | null | undefined
) {
  if (!isQlsxRole(viewerRole) && !isAdminRole(viewerRole)) {
    return [] as AvailableSegmentOption[]
  }

  return buildAvailableSegments(supabase)
}

export async function loadApprovedAvailableSegments(supabase: AnySupabase) {
  return buildAvailableSegments(supabase)
}

export async function loadKeHoachNgayList(
  supabase: AnySupabase,
  viewerRole: string | null | undefined
) {
  if (!canViewProductionPlan(viewerRole)) {
    return [] as KeHoachNgayListItem[]
  }

  const { data: planRows, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('*')
    .eq('is_active', true)
    .order('ngay_ke_hoach', { ascending: false })

  if (planError) throw planError

  const planIds = ((planRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => String(row.plan_id ?? ''))
    .filter(Boolean)

  if (planIds.length === 0) {
    return [] as KeHoachNgayListItem[]
  }

  const { data: lineRows, error: lineError } = await supabase
    .from('ke_hoach_sx_line')
    .select('plan_id, order_id, so_luong_ke_hoach')
    .eq('is_active', true)
    .in('plan_id', planIds)

  if (lineError) throw lineError

  const orderCountMap = new Map<string, Set<string>>()
  const lineCountMap = new Map<string, number>()
  const totalQtyMap = new Map<string, number>()

  for (const row of (lineRows ?? []) as Array<Record<string, unknown>>) {
    const planId = String(row.plan_id ?? '')
    lineCountMap.set(planId, (lineCountMap.get(planId) ?? 0) + 1)
    totalQtyMap.set(planId, (totalQtyMap.get(planId) ?? 0) + toNumber(row.so_luong_ke_hoach))
    const current = orderCountMap.get(planId) || new Set<string>()
    current.add(String(row.order_id ?? ''))
    orderCountMap.set(planId, current)
  }

  const list = sortByDateDesc((planRows ?? []) as KeHoachNgayRow[]).map((plan) => ({
    plan,
    lineCount: lineCountMap.get(plan.plan_id) ?? 0,
    orderCount: orderCountMap.get(plan.plan_id)?.size ?? 0,
    totalPlannedQty: totalQtyMap.get(plan.plan_id) ?? 0,
  }))

  return list.filter((item) => (isWarehouseRole(viewerRole) ? item.plan.trang_thai === 'DA_CHOT' : true))
}

export async function loadQcPlanList(
  supabase: AnySupabase,
  viewerRole: string | null | undefined
) {
  if (!isQcRole(viewerRole) && !isAdminRole(viewerRole)) {
    return [] as QcPlanListItem[]
  }

  const [baseList, warehouseVouchers, qcVouchers] = await Promise.all([
    loadKeHoachNgayList(supabase, 'qlsx'),
    supabase.from('sx_xuat_nvl').select('plan_id').eq('is_active', true),
    supabase.from('sx_qc_nghiem_thu').select('plan_id').eq('is_active', true),
  ])

  if (warehouseVouchers.error) throw warehouseVouchers.error
  if (qcVouchers.error) {
    const message = String(qcVouchers.error.message || '').toLowerCase()
    if (
      !(message.includes('relation') && message.includes('sx_qc_nghiem_thu')) &&
      !(message.includes('schema cache') && message.includes('sx_qc_nghiem_thu'))
    ) {
      throw qcVouchers.error
    }
  }

  const warehousePlanIds = new Set(
    ((warehouseVouchers.data ?? []) as Array<Record<string, unknown>>).map((row) => String(row.plan_id ?? '')).filter(Boolean)
  )
  const qcPlanIds = new Set(
    ((qcVouchers.data ?? []) as Array<Record<string, unknown>>).map((row) => String(row.plan_id ?? '')).filter(Boolean)
  )

  return baseList
    .filter((item) => item.plan.trang_thai === 'DA_CHOT' && warehousePlanIds.has(item.plan.plan_id))
    .map((item) => ({
      ...item,
      qcConfirmed: qcPlanIds.has(item.plan.plan_id),
    }))
}

export async function loadKeHoachScheduleSummary(
  supabase: AnySupabase,
  viewerRole: string | null | undefined,
  fromDate: string,
  toDate: string
) {
  if (!canViewProductionPlan(viewerRole)) {
    return {
      fromDate,
      toDate,
      dates: [],
      rows: [],
      totalQtyByDate: [],
      totalMdByDate: [],
    } satisfies KeHoachScheduleSummary
  }

  const dates = buildDateRange(fromDate, toDate)
  if (!dates.length) {
    return {
      fromDate,
      toDate,
      dates: [],
      rows: [],
      totalQtyByDate: [],
      totalMdByDate: [],
    } satisfies KeHoachScheduleSummary
  }

  const { data: plans, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('plan_id, ngay_ke_hoach')
    .eq('is_active', true)
    .gte('ngay_ke_hoach', fromDate)
    .lte('ngay_ke_hoach', toDate)

  if (planError) throw planError

  const planDateMap = new Map<string, string>()
  for (const row of (plans ?? []) as Array<Record<string, unknown>>) {
    planDateMap.set(String(row.plan_id ?? ''), String(row.ngay_ke_hoach ?? ''))
  }

  const planIds = Array.from(planDateMap.keys()).filter(Boolean)
  if (planIds.length === 0) {
    return {
      fromDate,
      toDate,
      dates,
      rows: [],
      totalQtyByDate: dates.map(() => 0),
      totalMdByDate: dates.map(() => 0),
    } satisfies KeHoachScheduleSummary
  }

  const { data: lines, error: lineError } = await supabase
    .from('ke_hoach_sx_line')
    .select('plan_id, khach_hang, du_an, loai_coc, ten_doan, chieu_dai_m, so_luong_ke_hoach')
    .eq('is_active', true)
    .in('plan_id', planIds)

  if (lineError) throw lineError

  const rowMap = new Map<string, KeHoachScheduleRow>()
  const totalQtyByDate = dates.map(() => 0)
  const totalMdByDate = dates.map(() => 0)

  for (const row of (lines ?? []) as Array<Record<string, unknown>>) {
    const planId = String(row.plan_id ?? '')
    const ngay = planDateMap.get(planId)
    if (!ngay) continue
    const dateIndex = dates.indexOf(ngay)
    if (dateIndex < 0) continue

    const khachHang = String(row.khach_hang ?? '-')
    const duAn = String(row.du_an ?? '-')
    const loaiCoc = String(row.loai_coc ?? '-')
    const tenDoan = String(row.ten_doan ?? '-')
    const chieuDaiM = toNumber(row.chieu_dai_m)
    const qty = toNumber(row.so_luong_ke_hoach)
    const rowKey = `${khachHang}::${duAn}::${loaiCoc}::${tenDoan}::${chieuDaiM}`

    let scheduleRow = rowMap.get(rowKey)
    if (!scheduleRow) {
      scheduleRow = {
        rowKey,
        khachHang,
        duAn,
        loaiCoc,
        tenDoan,
        chieuDaiM,
        cells: dates.map((date) => ({ ngay: date, qty: 0, md: 0 })),
      }
      rowMap.set(rowKey, scheduleRow)
    }

    scheduleRow.cells[dateIndex].qty += qty
    scheduleRow.cells[dateIndex].md += qty * chieuDaiM
    totalQtyByDate[dateIndex] += qty
    totalMdByDate[dateIndex] += qty * chieuDaiM
  }

  return {
    fromDate,
    toDate,
    dates,
    rows: Array.from(rowMap.values()),
    totalQtyByDate,
    totalMdByDate,
  } satisfies KeHoachScheduleSummary
}

export async function createKeHoachNgay(
  supabase: AnySupabase,
  params: { userId: string; ngayKeHoach: string; note?: string }
) {
  const dateValue = normalizeText(params.ngayKeHoach)
  if (!dateValue) throw new Error('Cần chọn ngày kế hoạch.')

  const { data: existing, error: existingError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('plan_id')
    .eq('ngay_ke_hoach', dateValue)
    .eq('is_active', true)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.plan_id) {
    return { planId: String(existing.plan_id), existed: true }
  }

  const { data, error } = await supabase
    .from('ke_hoach_sx_ngay')
    .insert({
      ngay_ke_hoach: dateValue,
      ghi_chu: params.note || null,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('plan_id')
    .single()

  if (error) throw error
  const planId = String(data.plan_id)
  await writeAuditLog(supabase, {
    action: 'CREATE',
    entityType: 'KE_HOACH_SX_NGAY',
    entityId: planId,
    entityCode: dateValue,
    actorId: params.userId,
    afterJson: { status: 'NHAP' },
    summaryJson: {
      ngayKeHoach: dateValue,
      note: normalizeText(params.note),
    },
  })
  return { planId, existed: false }
}

export async function loadKeHoachNgayDetail(
  supabase: AnySupabase,
  planId: string,
  viewerRole: string | null | undefined
) {
  if (!canViewProductionPlan(viewerRole)) {
    return null
  }

  const warehouseViewer = isWarehouseRole(viewerRole)
  const salesAccountingViewer = isSalesAccountingRole(viewerRole)
  const shouldLoadAvailableSegments = !warehouseViewer && !salesAccountingViewer
  const [{ data: planRow, error: planError }, { data: lineRows, error: lineError }, availableSegments, approvedOrders, latestStageSummary, producedTotals, netDeliveredTotals] =
    await Promise.all([
      supabase
        .from('ke_hoach_sx_ngay')
        .select('*')
        .eq('plan_id', planId)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('ke_hoach_sx_line')
        .select('*')
        .eq('plan_id', planId)
        .eq('is_active', true)
        .order('thu_tu', { ascending: true }),
      shouldLoadAvailableSegments ? buildAvailableSegments(supabase) : Promise.resolve([]),
      loadDonHangList(supabase, { viewerRole: 'qlsx' }),
      loadLatestStageTotalsBySegment(supabase),
      loadProducedTotalsBySegment(supabase),
      loadNetDeliveredTotalsByOrderSegment(supabase),
    ])

  if (planError) throw planError
  if (lineError) throw lineError
  if (!planRow) return null
  if (warehouseViewer && String(planRow.trang_thai ?? '') !== 'DA_CHOT') return null

  const orderMap = new Map(approvedOrders.map((item) => [item.order.order_id, item]))
  const bocProjectCodeMap = await loadBocProjectCodeMap(
    supabase,
    ((lineRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.boc_id ?? ''))
      .filter(Boolean)
      .concat(
        approvedOrders.map((item) => String(item.order.boc_id || '')).filter(Boolean)
      )
  )

  const mappedLines = ((lineRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...toRow<KeHoachLineRow>(row),
    ma_boc_tach_hien_thi: (() => {
      const order = orderMap.get(String(row.order_id ?? ''))
      const bocId = String(row.boc_id ?? order?.order.boc_id ?? '')
      if (!bocId) return null
      return buildDisplayId(
        bocId,
        bocProjectCodeMap.get(bocId) || String(order?.order.da_id ?? ''),
        String(row.loai_coc ?? order?.order.loai_coc ?? ''),
        order?.duAnName ?? null
      )
    })(),
    chieu_dai_m: toNumber(row.chieu_dai_m),
    so_luong_dat: toNumber(row.so_luong_dat),
    so_luong_da_san_xuat: (() => {
      const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
      return producedTotals.get(key) ?? toNumber(row.so_luong_da_san_xuat)
    })(),
    so_luong_da_len_ke_hoach: (() => {
      const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
      return latestStageSummary.stageTotals.get(key) ?? toNumber(row.so_luong_da_len_ke_hoach)
    })(),
    so_luong_con_lai_tam: (() => {
      const deliveredKey = buildOrderDeliveryKey(
        String(row.order_id ?? ''),
        {
          templateId: String(row.template_id ?? ''),
          maCoc: String(row.ma_coc ?? ''),
          loaiCoc: String(row.loai_coc ?? ''),
        },
        String(row.ten_doan ?? ''),
        toNumber(row.chieu_dai_m)
      )
      const deliveredQty = netDeliveredTotals.get(deliveredKey) ?? 0
      return Math.max(toNumber(row.so_luong_dat) - deliveredQty, 0)
    })(),
    so_luong_ke_hoach: toNumber(row.so_luong_ke_hoach),
  }))

  const canUseWarehouseData =
    (warehouseViewer || isAdminRole(viewerRole) || isSalesAccountingRole(viewerRole)) &&
    String(planRow.trang_thai ?? '') === 'DA_CHOT'
  const [warehouseIssue, generatedLots] = canUseWarehouseData
    ? await Promise.all([buildWarehouseIssueDraft(supabase, planId, mappedLines), loadProductionLotsByPlan(supabase, planId)])
    : [null, []]

  return {
    plan: toRow<KeHoachNgayRow>(planRow as Record<string, unknown>),
    lines: mappedLines,
    availableSegments,
    warehouseIssue,
    generatedLots,
  } satisfies KeHoachNgayDetail
}

export async function loadQcNghiemThuDetail(
  supabase: AnySupabase,
  planId: string,
  viewerRole: string | null | undefined
) {
  if (!isQcRole(viewerRole) && !isAdminRole(viewerRole)) {
    return null
  }

  const warehouseVoucher = await loadWarehouseIssueVoucher(supabase, planId, { activeOnly: true })
  if (!warehouseVoucher?.voucher_id) {
    return null
  }

  const [{ data: planRow, error: planError }, { data: lineRows, error: lineError }, approvedOrders, latestStageSummary, qcVoucher, serialRows] =
    await Promise.all([
      supabase
        .from('ke_hoach_sx_ngay')
        .select('*')
        .eq('plan_id', planId)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('ke_hoach_sx_line')
        .select('*')
        .eq('plan_id', planId)
        .eq('is_active', true)
        .order('thu_tu', { ascending: true }),
      loadDonHangList(supabase, { viewerRole: 'qlsx' }),
      loadLatestStageTotalsBySegment(supabase),
      loadQcIssueVoucher(supabase, planId),
      loadQcSerialRowsByPlan(supabase, planId),
    ])

  if (planError) throw planError
  if (lineError) throw lineError
  if (!planRow) return null

  const filteredLineRows = ((lineRows ?? []) as Array<Record<string, unknown>>).filter(
    (row) => toNumber(row.so_luong_da_san_xuat) > 0
  )

  const orderMap = new Map(approvedOrders.map((item) => [item.order.order_id, item]))
  const bocProjectCodeMap = await loadBocProjectCodeMap(
    supabase,
    filteredLineRows
      .map((row) => String(row.boc_id ?? ''))
      .filter(Boolean)
      .concat(approvedOrders.map((item) => String(item.order.boc_id || '')).filter(Boolean))
  )

  const mappedLines = filteredLineRows.map((row) => ({
    ...toRow<KeHoachLineRow>(row),
    ma_boc_tach_hien_thi: (() => {
      const order = orderMap.get(String(row.order_id ?? ''))
      const bocId = String(row.boc_id ?? order?.order.boc_id ?? '')
      if (!bocId) return null
      return buildDisplayId(
        bocId,
        bocProjectCodeMap.get(bocId) || String(order?.order.da_id ?? ''),
        String(row.loai_coc ?? order?.order.loai_coc ?? ''),
        order?.duAnName ?? null
      )
    })(),
    chieu_dai_m: toNumber(row.chieu_dai_m),
    so_luong_dat: toNumber(row.so_luong_dat),
    so_luong_da_san_xuat: toNumber(row.so_luong_da_san_xuat),
    so_luong_da_len_ke_hoach: (() => {
      const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
      return latestStageSummary.stageTotals.get(key) ?? toNumber(row.so_luong_da_len_ke_hoach)
    })(),
    so_luong_con_lai_tam: (() => {
      const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
      const latestQty = latestStageSummary.stageTotals.get(key) ?? toNumber(row.so_luong_da_len_ke_hoach)
      return Math.max(toNumber(row.so_luong_dat) - latestQty, 0)
    })(),
    so_luong_ke_hoach: toNumber(row.so_luong_ke_hoach),
  }))

  const existingPayload = (qcVoucher?.payload_json as Record<string, unknown> | null) || null
  const storedLineResults = new Map(
    safeArray<Record<string, unknown>>(existingPayload?.lineResults).map((item) => [String(item.lineId ?? ''), item])
  )
  const storedSerialResults = new Map(
    safeArray<Record<string, unknown>>(existingPayload?.serialResults).map((item) => [String(item.serialId ?? ''), item])
  )

  const serialResults: QcSerialResult[] = serialRows.map((row) => {
    const productionLot = (row.production_lot as Record<string, unknown> | null) || {}
    const serialId = String(row.serial_id || '')
    const stored = storedSerialResults.get(serialId)
    const qcStatus = String(stored?.qcStatus || row.qc_status || 'CHUA_QC') as QcSerialResult['qcStatus']
    const rawDisposition = String(stored?.dispositionStatus || row.disposition_status || '')
    const dispositionStatus =
      qcStatus === 'LOI'
        ? rawDisposition === 'THANH_LY'
          ? 'THANH_LY'
          : 'HUY'
        : 'BINH_THUONG'
    return {
      serialId,
      lineId: String(productionLot.plan_line_id || ''),
      serialCode: String(row.serial_code || ''),
      qcStatus,
      dispositionStatus,
      note: String(stored?.note || row.notes || ''),
    }
  })

  const serialAcceptedByLine = new Map<string, number>()
  for (const item of serialResults) {
    if (item.qcStatus === 'DAT') {
      serialAcceptedByLine.set(item.lineId, (serialAcceptedByLine.get(item.lineId) ?? 0) + 1)
    }
  }

  const qcIssue: QcIssueDraft = {
    voucherId: qcVoucher?.voucher_id && Boolean(qcVoucher?.is_active) ? String(qcVoucher.voucher_id) : null,
    locked: Boolean(qcVoucher?.voucher_id && qcVoucher?.is_active),
    operationDate: String(existingPayload?.operationDate || qcVoucher?.ngay_thao_tac || formatLocalDate(new Date())),
    note: String(existingPayload?.note || qcVoucher?.ghi_chu || ''),
    lineResults: mappedLines.map((line) => {
      const stored = storedLineResults.get(line.line_id)
      const actualQty = toNumber(line.so_luong_da_san_xuat)
      const acceptedQty = serialAcceptedByLine.has(line.line_id)
        ? serialAcceptedByLine.get(line.line_id) ?? 0
        : toNumber(stored?.acceptedQty, actualQty)
      return {
        lineId: line.line_id,
        actualQty,
        acceptedQty,
        rejectedQty: Math.max(actualQty - acceptedQty, 0),
        note: String(stored?.note || ''),
      } satisfies QcIssueLineResult
    }),
    serialResults,
  }

  return {
    plan: toRow<KeHoachNgayRow>(planRow as Record<string, unknown>),
    lines: mappedLines,
    qcIssue,
  } satisfies QcNghiemThuDetail
}

export async function addKeHoachLine(
  supabase: AnySupabase,
  params: {
    userId: string
    planId: string
    orderId: string
    doanKey: string
    soLuongKeHoach: number
    note?: string
  }
) {
  const { data: planRow, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('trang_thai')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .maybeSingle()

  if (planError) throw planError
  if (!planRow) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planRow.trang_thai ?? '') === 'DA_CHOT') {
    throw new Error('Kế hoạch ngày đã chốt, không thể thêm dòng.')
  }

  const availableSegments = await buildAvailableSegments(supabase)
  const segment = availableSegments.find(
    (item) => item.orderId === params.orderId && item.doanKey === params.doanKey
  )

  if (!segment) {
    throw new Error('Không tìm thấy đoạn phù hợp để lập kế hoạch.')
  }

  const soLuongKeHoach = Number(params.soLuongKeHoach || 0)
  if (soLuongKeHoach <= 0) {
    throw new Error('Số lượng kế hoạch phải lớn hơn 0.')
  }
  if (soLuongKeHoach > Number(segment.soLuongConLaiTam || 0)) {
    throw new Error('Số lượng kế hoạch vượt quá số còn lại tạm tính.')
  }

  const { data: currentLines, error: currentLinesError } = await supabase
    .from('ke_hoach_sx_line')
    .select('thu_tu')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .order('thu_tu', { ascending: false })
    .limit(1)

  if (currentLinesError) throw currentLinesError

  const nextThuTu = ((currentLines ?? []) as Array<Record<string, unknown>>)[0]
    ? Number((currentLines ?? [])[0].thu_tu || 0) + 1
    : 1

  const { data, error } = await supabase
    .from('ke_hoach_sx_line')
    .insert({
      plan_id: params.planId,
      order_id: segment.orderId,
      boc_id: segment.bocId,
      quote_id: segment.quoteId,
      ma_order: segment.maOrder,
      ma_bao_gia: segment.maBaoGia,
      khach_hang: segment.khachHang,
      du_an: segment.duAn,
      template_id: segment.templateId || null,
      ma_coc: segment.maCoc || null,
      loai_coc: segment.loaiCoc,
      doan_key: segment.doanKey,
      ten_doan: segment.tenDoan,
      chieu_dai_m: segment.chieuDaiM,
      so_luong_dat: segment.soLuongDat,
      so_luong_da_san_xuat: segment.soLuongDaSanXuat,
      so_luong_da_len_ke_hoach: segment.soLuongDaLenKeHoach,
      so_luong_con_lai_tam: segment.soLuongConLaiTam,
      so_luong_ke_hoach: soLuongKeHoach,
      thu_tu: nextThuTu,
      ghi_chu: params.note || null,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('*')
    .single()

  if (error) {
    const message = String(error.message || '').toLowerCase()
    if (message.includes('template_id') || message.includes('ma_coc')) {
      throw new Error('Thiếu cột identity cho kế hoạch sản xuất. Cần chạy SQL bổ sung template_id/ma_coc trước khi lập kế hoạch mới.')
    }
    throw error
  }
  const createdLine = toRow<KeHoachLineRow>(data as Record<string, unknown>)
  await writeAuditLog(supabase, {
    action: 'CREATE',
    entityType: 'KE_HOACH_SX_LINE',
    entityId: String(createdLine.line_id),
    entityCode: String(createdLine.ma_order || createdLine.loai_coc || createdLine.line_id),
    actorId: params.userId,
    summaryJson: {
      planId: params.planId,
      orderId: segment.orderId,
      templateId: segment.templateId || null,
      maCoc: segment.maCoc || null,
      loaiCoc: segment.loaiCoc,
      tenDoan: segment.tenDoan,
      chieuDaiM: segment.chieuDaiM,
      soLuongKeHoach,
    },
  })
  return createdLine
}

export async function deleteKeHoachLine(
  supabase: AnySupabase,
  params: { planId: string; lineId: string; userId: string }
) {
  const { data: planRow, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('trang_thai')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .maybeSingle()

  if (planError) throw planError
  if (!planRow) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planRow.trang_thai ?? '') === 'DA_CHOT') {
    throw new Error('Kế hoạch ngày đã chốt, không thể xóa dòng.')
  }

  const { data, error } = await supabase
    .from('ke_hoach_sx_line')
    .update({
      is_active: false,
      updated_by: params.userId,
    })
    .eq('plan_id', params.planId)
    .eq('line_id', params.lineId)
    .select('line_id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Không xóa được dòng kế hoạch.')
  await writeAuditLog(supabase, {
    action: 'DELETE',
    entityType: 'KE_HOACH_SX_LINE',
    entityId: params.lineId,
    entityCode: params.planId,
    actorId: params.userId,
    beforeJson: { isActive: true },
    afterJson: { isActive: false },
    summaryJson: {
      planId: params.planId,
      lineId: params.lineId,
    },
  })
  return { lineId: String(data.line_id) }
}

export async function chotKeHoachNgay(
  supabase: AnySupabase,
  params: { planId: string; userId: string }
) {
  const { data: planRow, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('plan_id, trang_thai')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .maybeSingle()

  if (planError) throw planError
  if (!planRow) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planRow.trang_thai ?? '') === 'DA_CHOT') {
    return { planId: String(planRow.plan_id), status: 'DA_CHOT' as const }
  }

  const { count, error: countError } = await supabase
    .from('ke_hoach_sx_line')
    .select('line_id', { count: 'exact', head: true })
    .eq('plan_id', params.planId)
    .eq('is_active', true)

  if (countError) throw countError
  if (!Number(count || 0)) {
    throw new Error('Cần có ít nhất 1 dòng kế hoạch trước khi chốt.')
  }

  const [plannedTotals, { data: lineRows, error: lineError }] = await Promise.all([
    loadPlannedTotalsBySegment(supabase),
    supabase
      .from('ke_hoach_sx_line')
      .select('order_id, doan_key, ten_doan, so_luong_dat, so_luong_ke_hoach')
      .eq('plan_id', params.planId)
      .eq('is_active', true),
  ])

  if (lineError) throw lineError

  const overPlannedRows = ((lineRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const key = `${String(row.order_id ?? '')}::${String(row.doan_key ?? '')}`
      const totalPlanned = plannedTotals.get(key) ?? 0
      const orderedQty = toNumber(row.so_luong_dat)
      const overQty = round3(totalPlanned - orderedQty)
      return {
        tenDoan: String(row.ten_doan || String(row.doan_key || '-')),
        orderedQty,
        totalPlanned,
        overQty,
      }
    })
    .filter((row) => row.overQty > 0.0001)

  if (overPlannedRows.length > 0) {
    const preview = overPlannedRows
      .slice(0, 3)
      .map((row) => `${row.tenDoan}: đặt ${row.orderedQty}, tổng KH ${row.totalPlanned}, vượt ${row.overQty}`)
      .join(' | ')
    throw new Error(`Kế hoạch đang vượt số lượng đơn hàng. ${preview}`)
  }

  const { data, error } = await supabase
    .from('ke_hoach_sx_ngay')
    .update({
      trang_thai: 'DA_CHOT',
      updated_by: params.userId,
    })
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .select('plan_id, trang_thai')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Không chốt được kế hoạch ngày.')
  await writeAuditLog(supabase, {
    action: 'CONFIRM',
    entityType: 'KE_HOACH_SX_NGAY',
    entityId: params.planId,
    entityCode: params.planId,
    actorId: params.userId,
    beforeJson: { status: 'NHAP' },
    afterJson: { status: 'DA_CHOT' },
    summaryJson: {
      planId: params.planId,
      lineCount: Number(count || 0),
      status: 'DA_CHOT',
    },
  })
  return { planId: String(data.plan_id), status: 'DA_CHOT' as const }
}

export async function moLaiKeHoachNgay(
  supabase: AnySupabase,
  params: { planId: string; userId: string }
) {
  const { data: planRow, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('plan_id, trang_thai')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .maybeSingle()

  if (planError) throw planError
  if (!planRow) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planRow.trang_thai ?? '') !== 'DA_CHOT') {
    return { planId: String(planRow.plan_id), status: 'NHAP' as const }
  }

  const lockedByWarehouse = await hasWarehouseIssueVoucher(supabase, params.planId)
  if (lockedByWarehouse) {
    throw new Error('Kế hoạch này đã được Thủ kho xác nhận thực sản xuất & xuất NVL nên không được mở chốt để chỉnh sửa.')
  }

  const { data, error } = await supabase
    .from('ke_hoach_sx_ngay')
    .update({
      trang_thai: 'NHAP',
      updated_by: params.userId,
    })
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .select('plan_id, trang_thai')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Không mở chốt được kế hoạch ngày.')
  await writeAuditLog(supabase, {
    action: 'REOPEN',
    entityType: 'KE_HOACH_SX_NGAY',
    entityId: params.planId,
    entityCode: params.planId,
    actorId: params.userId,
    beforeJson: { status: 'DA_CHOT' },
    afterJson: { status: 'NHAP' },
    summaryJson: {
      planId: params.planId,
      status: 'NHAP',
    },
  })
  return { planId: String(data.plan_id), status: 'NHAP' as const }
}

export async function xacNhanThucSanXuatLine(
  supabase: AnySupabase,
  params: { planId: string; lineId: string; userId: string; soLuongThucTe: number }
) {
  const { data: planRow, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('plan_id, trang_thai, ngay_ke_hoach')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .maybeSingle()

  if (planError) throw planError
  if (!planRow) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planRow.trang_thai ?? '') !== 'DA_CHOT') {
    throw new Error('Chỉ được xác nhận thực sản xuất cho kế hoạch đã chốt.')
  }
  ensureOperationalActionAllowed(String(planRow.ngay_ke_hoach || ''), 'Không được xác nhận thực sản xuất')

  const { data: lineRow, error: lineError } = await supabase
    .from('ke_hoach_sx_line')
    .select('line_id, so_luong_ke_hoach')
    .eq('plan_id', params.planId)
    .eq('line_id', params.lineId)
    .eq('is_active', true)
    .maybeSingle()

  if (lineError) throw lineError
  if (!lineRow) throw new Error('Không tìm thấy dòng kế hoạch.')

  const soLuongThucTe = Number(params.soLuongThucTe || 0)
  if (soLuongThucTe < 0) {
    throw new Error('Số lượng thực tế không được nhỏ hơn 0.')
  }
  if (soLuongThucTe > toNumber(lineRow.so_luong_ke_hoach)) {
    throw new Error('Số lượng thực tế không được vượt quá số kế hoạch của dòng.')
  }

  const { data, error } = await supabase
    .from('ke_hoach_sx_line')
    .update({
      so_luong_da_san_xuat: soLuongThucTe,
      updated_by: params.userId,
    })
    .eq('plan_id', params.planId)
    .eq('line_id', params.lineId)
    .eq('is_active', true)
    .select('line_id, so_luong_da_san_xuat')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Không xác nhận được số lượng thực sản xuất.')
  return {
    lineId: String(data.line_id),
    soLuongDaSanXuat: toNumber(data.so_luong_da_san_xuat),
  }
}

export async function xacNhanThucSanXuatNhieuLine(
  supabase: AnySupabase,
  params: { planId: string; userId: string; items: Array<{ lineId: string; soLuongThucTe: number }> }
) {
  const items = params.items.filter((item) => String(item.lineId || '').trim())
  if (!items.length) {
    throw new Error('Chưa có dòng nào để lưu sản lượng.')
  }

  for (const item of items) {
    await xacNhanThucSanXuatLine(supabase, {
      planId: params.planId,
      lineId: item.lineId,
      userId: params.userId,
      soLuongThucTe: item.soLuongThucTe,
    })
  }

  return { count: items.length }
}

export async function saveWarehouseIssueVoucher(
  supabase: AnySupabase,
  params: {
    planId: string
    userId: string
    note?: string
    lineDrafts: WarehouseIssueLineDraft[]
    concreteSummaries: WarehouseConcreteGradeSummary[]
    materialSummaries: WarehouseIssueMaterialSummary[]
  }
) {
  const ensureVoucherTable = (error: unknown) => {
    const rawMessage = String(
      error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
          ? (error as { message: unknown }).message
          : ''
    )
    const message = rawMessage.toLowerCase()
    if (
      (message.includes('relation') && message.includes('sx_xuat_nvl')) ||
      (message.includes('schema cache') && message.includes('sx_xuat_nvl'))
    ) {
      throw new Error('Cần chạy file sql/sx_xuat_nvl_setup.sql trước khi dùng chức năng xuất NVL sản xuất.')
    }
    throw new Error(rawMessage || 'Không lưu được phiếu xuất NVL sản xuất.')
  }

  const { data: planRow, error: planError } = await supabase
    .from('ke_hoach_sx_ngay')
    .select('plan_id, trang_thai, ngay_ke_hoach')
    .eq('plan_id', params.planId)
    .eq('is_active', true)
    .maybeSingle()

  if (planError) throw planError
  if (!planRow) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planRow.trang_thai ?? '') !== 'DA_CHOT') {
    throw new Error('Chỉ được xuất NVL cho kế hoạch đã chốt.')
  }
  const operationDate = ensureOperationalActionAllowed(
    String(planRow.ngay_ke_hoach || ''),
    'Không được xác nhận thực sản xuất và xuất NVL'
  )

  const payloadJson = {
    operationDate,
    note: String(params.note || ''),
    lineDrafts: params.lineDrafts.map((line) => ({
      lineId: line.lineId,
      actualProductionQty: toNumber(line.actualProductionQty),
      concreteGrade: line.concreteGrade,
      concreteRequiredM3: round3(toNumber(line.concreteRequiredM3)),
      concreteRequiredM3PerUnit: round3(toNumber(line.concreteRequiredM3PerUnit)),
      allocations: line.allocations.map((allocation) => ({
        variant: normalizeConcreteVariant(allocation.variant),
        volumeM3: round3(toNumber(allocation.volumeM3)),
      })),
      materials: line.materials.map((material) => ({
        key: material.key,
        nhom: material.nhom,
        label: material.label,
        dvt: material.dvt,
        ratePerUnit: round3(toNumber(material.ratePerUnit)),
        estimateQty: round3(toNumber(material.estimateQty)),
        actualQty: round3(toNumber(material.actualQty)),
      })),
    })),
    concreteSummaries: params.concreteSummaries.map((summary) => ({
      concreteGrade: summary.concreteGrade,
      requiredM3: round3(toNumber(summary.requiredM3)),
      allocations: summary.allocations.map((allocation) => ({
        variant: normalizeConcreteVariant(allocation.variant),
        volumeM3: round3(toNumber(allocation.volumeM3)),
      })),
    })),
    concreteAllocationRows: params.concreteSummaries.flatMap((summary) =>
      summary.allocations.map((allocation) => ({
        concreteGrade: summary.concreteGrade,
        variant: normalizeConcreteVariant(allocation.variant),
        volumeM3: round3(toNumber(allocation.volumeM3)),
      }))
    ),
    materialSummaries: params.materialSummaries.map((material) => ({
      key: material.key,
      nhom: material.nhom,
      label: material.label,
      dvt: material.dvt,
      estimateQty: round3(toNumber(material.estimateQty)),
      actualQty: round3(toNumber(material.actualQty)),
    })),
  }

  const existingVoucher = await loadWarehouseIssueVoucher(supabase, params.planId, { activeOnly: true })
  if (existingVoucher?.voucher_id) {
    throw new Error('Phiếu thực sản xuất và xuất NVL đã được xác nhận. Muốn chỉnh sửa cần mở lại bằng chức năng riêng.')
  }

  const { data, error } = await supabase
    .from('sx_xuat_nvl')
    .insert({
      plan_id: params.planId,
      ngay_thao_tac: payloadJson.operationDate,
      ghi_chu: payloadJson.note || null,
      payload_json: payloadJson,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('voucher_id')
    .maybeSingle()

  if (error) {
    ensureVoucherTable(error)
  }
  if (!data) throw new Error('Không lưu được phiếu xuất NVL sản xuất.')
  const voucherId = String(data.voucher_id)

  let stockMovement = {
    schemaReady: false,
    createdMovementCount: 0,
    totalIssuedQty: 0,
  }
  let stockMovementError: string | null = null

  try {
    const { error: movementSchemaError } = await supabase.from('material_stock_movement').select('movement_id').limit(1)
    if (movementSchemaError) {
      if (isMissingRelationError(movementSchemaError, 'material_stock_movement')) {
        stockMovementError =
          'Schema stock movement NVL chưa sẵn sàng. Cần tạo bảng material_stock_movement trước.'
      } else {
        throw movementSchemaError
      }
    } else {
      stockMovement.schemaReady = true

      const { data: existingMovements, error: existingMovementError } = await supabase
        .from('material_stock_movement')
        .select('movement_id')
        .eq('source_type', 'PRODUCTION_ISSUE_VOUCHER')
        .eq('source_id', voucherId)
        .limit(1)

      if (existingMovementError) throw existingMovementError
      if ((existingMovements ?? []).length > 0) {
        throw new Error('Phiếu xuất NVL sản xuất này đã ghi stock movement rồi, không thể ghi lặp lại.')
      }

      const movements = params.materialSummaries
        .map((material, index) => ({
          key: String(material.key || '').trim(),
          nhom: String(material.nhom || '').trim(),
          label: String(material.label || '').trim(),
          dvt: String(material.dvt || '').trim(),
          estimateQty: round3(toNumber(material.estimateQty)),
          actualQty: round3(toNumber(material.actualQty)),
          movementLineRef: `${voucherId}:${String(material.key || '').trim()}:${index + 1}`,
        }))
        .filter((material) => material.key && material.actualQty > 0)
        .map((material) => ({
          movement_type: 'ISSUE_TO_PRODUCTION',
          material_code: material.key,
          material_name: material.label || material.key,
          unit: material.dvt,
          quantity: material.actualQty,
          physical_effect: 'OUT',
          available_effect: 'DISABLE',
          blocked_effect: 'DISABLE',
          quality_effect: 'NONE',
          source_type: 'PRODUCTION_ISSUE_VOUCHER',
          source_id: voucherId,
          // source_line_id in material_stock_movement is a UUID column.
          // Production issue rows do not have a real line UUID, so keep it null
          // and store the stable per-line reference inside payload_json instead.
          source_line_id: null,
          movement_date: payloadJson.operationDate,
          warehouse_code: 'MAIN',
          warehouse_label: 'Kho NVL',
          note: `Xuất NVL cho kế hoạch ${params.planId}`,
          payload_json: {
            planId: params.planId,
            voucherId,
            operationDate: payloadJson.operationDate,
            issueNote: payloadJson.note,
            materialKey: material.key,
            materialGroup: material.nhom,
            movementLineRef: material.movementLineRef,
            estimateQty: material.estimateQty,
            actualQty: material.actualQty,
          },
          created_by: params.userId,
        }))

      if (movements.length > 0) {
        const { error: insertMovementError } = await supabase.from('material_stock_movement').insert(movements)
        if (insertMovementError) throw insertMovementError
      }

      stockMovement = {
        schemaReady: true,
        createdMovementCount: movements.length,
        totalIssuedQty: round3(movements.reduce((sum, movement) => sum + toNumber(movement.quantity), 0)),
      }
    }
  } catch (error) {
    stockMovementError =
      error instanceof Error ? error.message : 'Không ghi được stock movement NVL sau khi xác nhận xuất.'
    stockMovement = {
      schemaReady: false,
      createdMovementCount: 0,
      totalIssuedQty: 0,
    }
  }

  let serialGeneration = {
    generatedLotCount: 0,
    generatedSerialCount: 0,
    schemaReady: false,
  }
  let serialGenerationError: string | null = null

  try {
    const lineIds = params.lineDrafts.map((line) => String(line.lineId || '')).filter(Boolean)
    if (lineIds.length) {
      const { data: lineRows, error: lineRowsError } = await supabase
        .from('ke_hoach_sx_line')
        .select('*')
        .eq('plan_id', params.planId)
        .eq('is_active', true)
        .in('line_id', lineIds)

      if (lineRowsError) throw lineRowsError

      const lineMap = new Map(
        ((lineRows ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.line_id || ''), row])
      )

      serialGeneration = await generateLotsAndSerialsFromWarehouseIssue(
        supabase,
        params.lineDrafts
          .map((line) => {
            const lineRow = lineMap.get(String(line.lineId || ''))
            if (!lineRow) return null
            const actualQty = Math.max(Math.trunc(toNumber(line.actualProductionQty)), 0)
            if (!(actualQty > 0)) return null
            return {
              warehouseIssueVoucherId: voucherId,
              planId: params.planId,
              lineId: String(line.lineId || ''),
              orderId: normalizeText(lineRow.order_id) || null,
              bocId: normalizeText(lineRow.boc_id) || null,
              quoteId: normalizeText(lineRow.quote_id) || null,
              templateId: normalizeText(lineRow.template_id) || null,
              maCoc: normalizeText(lineRow.ma_coc) || null,
              loaiCoc: normalizeText(lineRow.loai_coc),
              tenDoan: normalizeText(lineRow.ten_doan),
              chieuDaiM: toNumber(lineRow.chieu_dai_m),
              productionDate: payloadJson.operationDate,
              actualQty,
              createdBy: params.userId,
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      )
    }
  } catch (error) {
    serialGenerationError =
      error instanceof Error ? error.message : 'Không sinh được lô/serial sau khi xác nhận thực sản xuất.'
    serialGeneration = {
      generatedLotCount: 0,
      generatedSerialCount: 0,
      schemaReady: false,
    }
  }

  const materialTotals = summarizeMaterialTotals(params.materialSummaries)
  await writeAuditLog(supabase, {
    action: 'CONFIRM',
    entityType: 'SX_XUAT_NVL',
    entityId: voucherId,
    entityCode: `KHSX ${params.planId}`,
    actorId: params.userId,
    afterJson: { status: 'DA_XAC_NHAN' },
    summaryJson: {
      planId: params.planId,
      operationDate: payloadJson.operationDate,
      lineCount: params.lineDrafts.length,
      actualProductionQty: round3(params.lineDrafts.reduce((sum, line) => sum + toNumber(line.actualProductionQty), 0)),
      materialCount: params.materialSummaries.length,
      materialEstimatedQty: materialTotals.estimatedQty,
      materialActualQty: materialTotals.actualQty,
      materialVarianceQty: materialTotals.varianceQty,
      stockMovementCreatedCount: stockMovement.createdMovementCount,
      serialGeneratedCount: serialGeneration.generatedSerialCount,
    },
    note: payloadJson.note,
  })

  return {
    voucherId,
    updated: false as const,
    stockMovement,
    stockMovementError,
    serialGeneration,
    serialGenerationError,
  }
}

export async function saveQcIssueVoucher(
  supabase: AnySupabase,
  params: {
    planId: string
    userId: string
    note?: string
    lineResults: QcIssueLineResult[]
    serialResults?: QcSerialResult[]
  }
) {
  const ensureQcTable = (error: unknown) => {
    const rawMessage = String(
      error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
          ? (error as { message: unknown }).message
          : ''
    )
    const message = rawMessage.toLowerCase()
    if (
      (message.includes('relation') && message.includes('sx_qc_nghiem_thu')) ||
      (message.includes('schema cache') && message.includes('sx_qc_nghiem_thu'))
    ) {
      throw new Error('Cần chạy file sql/sx_qc_nghiem_thu_setup.sql trước khi dùng chức năng nghiệm thu QC.')
    }
    throw new Error(rawMessage || 'Không lưu được phiếu nghiệm thu QC.')
  }

  const [planResult, warehouseLocked, existingQcVoucher] = await Promise.all([
    supabase
      .from('ke_hoach_sx_ngay')
      .select('plan_id, trang_thai, ngay_ke_hoach')
      .eq('plan_id', params.planId)
      .eq('is_active', true)
      .maybeSingle(),
    hasWarehouseIssueVoucher(supabase, params.planId),
    loadQcIssueVoucher(supabase, params.planId, { activeOnly: true }),
  ])

  if (planResult.error) throw planResult.error
  if (!planResult.data) throw new Error('Không tìm thấy kế hoạch ngày.')
  if (String(planResult.data.trang_thai ?? '') !== 'DA_CHOT') {
    throw new Error('Chỉ được nghiệm thu QC cho kế hoạch đã chốt.')
  }
  if (!warehouseLocked) {
    throw new Error('Chỉ nghiệm thu QC sau khi Thủ kho đã xác nhận thực sản xuất và xuất NVL.')
  }
  if (existingQcVoucher?.voucher_id) {
    throw new Error('Phiếu nghiệm thu QC đã được xác nhận.')
  }
  const operationDate = ensureOperationalActionAllowed(
    String(planResult.data.ngay_ke_hoach || ''),
    'Không được nghiệm thu QC'
  )

  const payloadJson = {
    operationDate,
    note: String(params.note || ''),
    lineResults: params.lineResults.map((line) => {
      const actualQty = toNumber(line.actualQty)
      const acceptedQty = Math.min(Math.max(toNumber(line.acceptedQty), 0), actualQty)
      return {
        lineId: line.lineId,
        actualQty,
        acceptedQty,
        rejectedQty: Math.max(actualQty - acceptedQty, 0),
        note: String(line.note || ''),
      }
    }),
    serialResults: (Array.isArray(params.serialResults) ? params.serialResults : []).map((item) => ({
      serialId: String(item.serialId || ''),
      lineId: String(item.lineId || ''),
      serialCode: String(item.serialCode || ''),
      qcStatus: String(item.qcStatus || 'CHUA_QC'),
      dispositionStatus: String(item.dispositionStatus || 'BINH_THUONG'),
      note: String(item.note || ''),
    })),
  }

  const { data, error } = await supabase
    .from('sx_qc_nghiem_thu')
    .insert({
      plan_id: params.planId,
      ngay_thao_tac: payloadJson.operationDate,
      ghi_chu: payloadJson.note || null,
      payload_json: payloadJson,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select('voucher_id')
    .maybeSingle()

  if (error) {
    ensureQcTable(error)
  }
  if (!data) throw new Error('Không lưu được phiếu nghiệm thu QC.')

  const savedQcIssue = {
    voucherId: String(data.voucher_id || ''),
    locked: true,
    operationDate: payloadJson.operationDate,
    note: payloadJson.note,
    lineResults: payloadJson.lineResults,
    serialResults: payloadJson.serialResults,
  }

  const serialResults = (Array.isArray(params.serialResults) ? params.serialResults : []).filter((item) =>
    String(item.serialId || '')
  )
  if (serialResults.length > 0) {
    const { data: locationRows, error: locationError } = await supabase
      .from('warehouse_location')
      .select('location_id, location_code')
      .in('location_code', ['KHO_THANH_PHAM', 'KHU_LOI'])
      .eq('is_active', true)

    if (locationError) {
      const message = String(locationError.message || '').toLowerCase()
      if (!(message.includes('relation') && message.includes('warehouse_location'))) {
        throw locationError
      }
    }

    const locationMap = new Map(
      safeArray<Record<string, unknown>>(locationRows).map((row) => [
        String(row.location_code || ''),
        String(row.location_id || ''),
      ])
    )

    const historyRows: Array<Record<string, unknown>> = []
    for (const item of serialResults) {
      const qcStatus = item.qcStatus === 'LOI' ? 'LOI' : item.qcStatus === 'DAT' ? 'DAT' : 'CHUA_QC'
      const dispositionStatus =
        qcStatus === 'LOI'
          ? item.dispositionStatus === 'THANH_LY' || item.dispositionStatus === 'HUY'
            ? item.dispositionStatus
            : 'HUY'
          : 'BINH_THUONG'
      const lifecycleStatus = qcStatus === 'DAT' ? 'TRONG_KHO' : qcStatus === 'LOI' ? 'TRONG_KHU_CHO_QC' : 'TRONG_KHU_CHO_QC'
      const visibleInProject =
        qcStatus === 'DAT' ? true : qcStatus === 'LOI' ? dispositionStatus !== 'THANH_LY' && dispositionStatus !== 'HUY' : true
      const visibleInRetail = qcStatus === 'DAT' ? true : qcStatus === 'LOI' ? dispositionStatus === 'THANH_LY' : true
      const currentLocationId =
        qcStatus === 'DAT'
          ? locationMap.get('KHO_THANH_PHAM') || null
          : qcStatus === 'LOI'
            ? locationMap.get('KHU_LOI') || null
            : null

      const { data: currentSerial, error: currentSerialError } = await supabase
        .from('pile_serial')
        .select('serial_id, lifecycle_status, qc_status, disposition_status, current_location_id')
        .eq('serial_id', item.serialId)
        .eq('is_active', true)
        .maybeSingle()

      if (currentSerialError) {
        const message = String(currentSerialError.message || '').toLowerCase()
        if (message.includes('relation') && message.includes('pile_serial')) {
          continue
        }
        throw currentSerialError
      }
      if (!currentSerial) continue

      const { error: updateSerialError } = await supabase
        .from('pile_serial')
        .update({
          qc_status: qcStatus,
          lifecycle_status: lifecycleStatus,
          disposition_status: dispositionStatus,
          visible_in_project: visibleInProject,
          visible_in_retail: visibleInRetail,
          current_location_id: currentLocationId,
          notes: String(item.note || '') || null,
          updated_at: new Date().toISOString(),
        })
        .eq('serial_id', item.serialId)
        .eq('is_active', true)

      if (updateSerialError) throw updateSerialError

      historyRows.push({
        serial_id: item.serialId,
        event_type: qcStatus === 'DAT' ? 'QC_DAT' : qcStatus === 'LOI' ? 'QC_LOI' : 'QC_CAP_NHAT',
        from_lifecycle_status: currentSerial.lifecycle_status || null,
        to_lifecycle_status: lifecycleStatus,
        from_qc_status: currentSerial.qc_status || null,
        to_qc_status: qcStatus,
        from_disposition_status: currentSerial.disposition_status || null,
        to_disposition_status: dispositionStatus,
        from_location_id: currentSerial.current_location_id || null,
        to_location_id: currentLocationId,
        ref_type: 'SX_QC_NGHIEM_THU',
        ref_id: data.voucher_id,
        note: String(item.note || '') || null,
        changed_by: params.userId,
      })
    }

    if (historyRows.length > 0) {
      const { error: historyError } = await supabase.from('pile_serial_history').insert(historyRows)
      if (historyError) {
        const message = String(historyError.message || '').toLowerCase()
        if (!(message.includes('relation') && message.includes('pile_serial_history'))) {
          throw historyError
        }
      }
    }
  }

  const qcActualQty = round3(payloadJson.lineResults.reduce((sum, line) => sum + toNumber(line.actualQty), 0))
  const qcAcceptedQty = round3(payloadJson.lineResults.reduce((sum, line) => sum + toNumber(line.acceptedQty), 0))
  await writeAuditLog(supabase, {
    action: 'CONFIRM',
    entityType: 'SX_QC_NGHIEM_THU',
    entityId: savedQcIssue.voucherId,
    entityCode: `KHSX ${params.planId}`,
    actorId: params.userId,
    afterJson: { status: 'DA_QC' },
    summaryJson: {
      planId: params.planId,
      operationDate: payloadJson.operationDate,
      lineCount: payloadJson.lineResults.length,
      serialCount: payloadJson.serialResults.length,
      actualQty: qcActualQty,
      acceptedQty: qcAcceptedQty,
      rejectedQty: round3(Math.max(qcActualQty - qcAcceptedQty, 0)),
    },
    note: payloadJson.note,
  })

  return savedQcIssue
}

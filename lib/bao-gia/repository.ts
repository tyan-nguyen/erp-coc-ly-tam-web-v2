import type { SupabaseClient } from '@supabase/supabase-js'

type AnySupabase = SupabaseClient
const BAO_GIA_META_PREFIX = 'ERP_BAO_GIA_META::'

function parseUnknownColumn(message: string) {
  const relationMatch = message.match(/column ["']?([a-zA-Z0-9_]+)["']? of relation .* does not exist/i)
  if (relationMatch?.[1]) return relationMatch[1]
  const schemaCacheMatch = message.match(
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column of ['"][a-zA-Z0-9_]+['"] in the schema cache/i
  )
  return schemaCacheMatch?.[1] ?? ''
}

function stripColumn<T extends Record<string, unknown>>(payload: T, column: string) {
  const next = { ...payload }
  delete next[column]
  return next
}

function isMissingRelationError(message?: string) {
  return /relation .* does not exist/i.test(String(message ?? '')) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(String(message ?? ''))
}

async function insertBaoGiaWithFallback(
  supabase: AnySupabase,
  payload: Record<string, unknown>
) {
  let currentPayload = { ...payload }
  for (;;) {
    const { data, error } = await supabase
      .from('bao_gia')
      .insert(currentPayload)
      .select('*')
      .single()
    if (!error) return data
    const unknownColumn = parseUnknownColumn(error.message || '')
    if (!unknownColumn) throw error
    currentPayload = stripColumn(currentPayload, unknownColumn)
  }
}

async function updateBaoGiaWithFallback(
  supabase: AnySupabase,
  quoteId: string,
  payload: Record<string, unknown>
) {
  let currentPayload = { ...payload }
  for (;;) {
    const { data, error } = await supabase
      .from('bao_gia')
      .update(currentPayload)
      .eq('quote_id', quoteId)
      .select('*')
      .maybeSingle()
    if (!error) return data
    const unknownColumn = parseUnknownColumn(error.message || '')
    if (!unknownColumn) throw error
    currentPayload = stripColumn(currentPayload, unknownColumn)
  }
}

export type BaoGiaStatus =
  | 'NHAP'
  | 'DA_XUAT_PDF'
  | 'DA_GUI_KHACH'
  | 'KH_YEU_CAU_CHINH_SUA'
  | 'DA_CHOT'
  | 'THAT_BAI'

export type BaoGiaSnapshotRow = {
  kind: 'pile' | 'accessory'
  key: string
  index: number
  rowId?: string
  nvlId?: string
  specText?: string
  label?: string
  dvt: string
  qty: number
  unitPrice: number
  unitPriceVat: number
  amount: number
  profitPct: number
  vatPct: number
}

export type BaoGiaSnapshot = {
  customerName: string
  projectName: string
  transportMode: string
  sourceEstimateIds: string[]
  notes: {
    opening: string
    vatNote: string
    transportNote: string
    otherNote: string
    validityNote: string
    closing: string
  }
  productRows: BaoGiaSnapshotRow[]
  totalAmount: number
}

export type BaoGiaListItem = {
  quoteId: string
  maBaoGia: string
  daId: string
  khId: string
  duAn: string
  khachHang: string
  status: BaoGiaStatus
  statusLabel: string
  currentVersionNo: number
  totalAmount: number
  exportCount: number
  sourceEstimateCount: number
  createdAt: string
  exportedAt: string | null
  productionApproved: boolean
  productionApprovedAt: string | null
  productionApprovedBy: string | null
  productionApprovalLabel: string | null
}

export type BaoGiaVersionRow = {
  version_id: string
  quote_id: string
  version_no: number
  action_type: 'SAVE' | 'EXPORT'
  snapshot_json: BaoGiaSnapshot
  print_html: string | null
  tong_tien: number | null
  ghi_chu: string | null
  exported_at: string | null
  created_at: string
  created_by: string | null
}

type BaoGiaVersionAction = BaoGiaVersionRow['action_type']

export type BaoGiaDetail = {
  quote: {
    quote_id: string
    ma_bao_gia: string
    da_id: string
    kh_id: string
    phuong_thuc_van_chuyen: string
    trang_thai: BaoGiaStatus
    current_version_no: number
    tong_tien: number
    created_at: string
    updated_at: string
    ngay_xuat_cuoi: string | null
    status_label?: string
    production_approved: boolean
    production_approved_at: string | null
    production_approved_by: string | null
    production_approval_label: string | null
  }
  latestVersion: BaoGiaVersionRow
  versions: BaoGiaVersionRow[]
  estimateIds: string[]
  duAn: string | null
  khachHang: string | null
}

function buildEmptySnapshot(): BaoGiaSnapshot {
  return {
    customerName: '',
    projectName: '',
    transportMode: '',
    sourceEstimateIds: [],
    notes: {
      opening: '',
      vatNote: '',
      transportNote: '',
      otherNote: '',
      validityNote: '',
      closing: '',
    },
    productRows: [],
    totalAmount: 0,
  }
}

function parseBaoGiaMeta(row: Record<string, unknown>) {
  const raw = String(row.ghi_chu || '').trim()
  if (!raw) return {} as Record<string, unknown>
  if (!raw.startsWith(BAO_GIA_META_PREFIX)) {
    return {
      note: raw,
    } as Record<string, unknown>
  }
  try {
    return JSON.parse(raw.slice(BAO_GIA_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

function buildStoredBaoGiaNote(note: string | null, meta: Record<string, unknown>) {
  return `${BAO_GIA_META_PREFIX}${JSON.stringify({
    ...meta,
    note: note ?? '',
  })}`
}

function formatProductionApprovalLabel(approved: boolean, approvedAt?: string | null) {
  if (!approved) return 'Chờ duyệt sản xuất'
  if (!approvedAt) return 'Đã duyệt sản xuất'
  const date = new Date(approvedAt)
  if (Number.isNaN(date.getTime())) return 'Đã duyệt sản xuất'
  return `Đã duyệt sản xuất · ${new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)}`
}

export function formatBaoGiaStatusLabel(
  status: string,
  options?: { currentVersionNo?: number; latestActionType?: BaoGiaVersionAction | null }
): string {
  const currentVersionNo = Number(options?.currentVersionNo || 0)
  const latestActionType = options?.latestActionType || null
  switch (status) {
    case 'DA_XUAT_PDF':
      return 'Đã xuất PDF'
    case 'DA_GUI_KHACH':
      return 'Đã gửi khách'
    case 'KH_YEU_CAU_CHINH_SUA':
      return 'Đã gửi khách'
    case 'DA_CHOT':
      return 'Thành công'
    case 'THAT_BAI':
      return 'Thất bại'
    case 'NHAP':
      if (latestActionType === 'EXPORT') return 'Đã xuất PDF'
      if (latestActionType === 'SAVE' || currentVersionNo > 0) return 'Đã lưu báo giá'
      return 'Nháp'
    default:
      return 'Nháp'
  }
}

export function formatBaoGiaStatusDisplay(
  status: string,
  options?: {
    currentVersionNo?: number
    latestActionType?: BaoGiaVersionAction | null
    productionApproved?: boolean
    productionApprovedAt?: string | null
  }
) {
  const base = formatBaoGiaStatusLabel(status, options)
  if (status !== 'DA_CHOT') return base
  if (options?.productionApproved) {
    return formatProductionApprovalLabel(true, options.productionApprovedAt)
  }
  return 'Thành công - chờ duyệt sản xuất'
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

async function buildBaoGiaCode(supabase: AnySupabase) {
  const date = new Date()
  const y = String(date.getFullYear()).slice(-2)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const prefix = `BG-${y}${m}${d}`

  const { data, error } = await supabase
    .from('bao_gia')
    .select('ma_bao_gia')
    .ilike('ma_bao_gia', `${prefix}-%`)
    .limit(500)

  if (error) throw error

  let nextSeq = 1
  for (const row of (data ?? []) as Array<{ ma_bao_gia: string | null }>) {
    const code = String(row.ma_bao_gia || '').trim()
    if (!code.startsWith(`${prefix}-`)) continue
    const suffix = code.slice(prefix.length + 1)
    const sequence = Number.parseInt(suffix, 10)
    if (Number.isFinite(sequence) && sequence >= nextSeq) nextSeq = sequence + 1
  }

  return `${prefix}-${String(nextSeq).padStart(3, '0')}`
}

async function loadProjectMap(supabase: AnySupabase, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>()
  const { data, error } = await supabase.from('dm_duan').select('da_id, ten_da').in('da_id', ids)
  if (error) throw error
  return new Map((data ?? []).map((row) => [String(row.da_id), String(row.ten_da || row.da_id)]))
}

async function loadCustomerMap(supabase: AnySupabase, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>()
  const { data, error } = await supabase.from('dm_kh').select('kh_id, ten_kh').in('kh_id', ids)
  if (error) throw error
  return new Map((data ?? []).map((row) => [String(row.kh_id), String(row.ten_kh || row.kh_id)]))
}

export async function loadBaoGiaList(supabase: AnySupabase) {
  const [{ data: quoteRows, error: quoteError }, { data: linkRows, error: linkError }, { data: versionRows, error: versionError }] = await Promise.all([
    supabase.from('bao_gia').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(300),
    supabase.from('bao_gia_boc_tach').select('quote_id, boc_id').limit(1000),
    supabase.from('bao_gia_version').select('quote_id, version_no, action_type').limit(1000),
  ])

  if (quoteError && !isMissingRelationError(quoteError.message)) throw quoteError
  if (linkError && !isMissingRelationError(linkError.message)) throw linkError
  if (versionError && !isMissingRelationError(versionError.message)) throw versionError
  if (
    (quoteError && isMissingRelationError(quoteError.message)) ||
    (linkError && isMissingRelationError(linkError.message)) ||
    (versionError && isMissingRelationError(versionError.message))
  ) {
    return []
  }

  const quotes = (quoteRows ?? []) as Array<Record<string, unknown>>
  const projectMap = await loadProjectMap(supabase, unique(quotes.map((row) => String(row.da_id ?? ''))).filter(Boolean))
  const customerMap = await loadCustomerMap(supabase, unique(quotes.map((row) => String(row.kh_id ?? ''))).filter(Boolean))

  const sourceCountMap = new Map<string, number>()
  for (const row of (linkRows ?? []) as Array<Record<string, unknown>>) {
    const quoteId = String(row.quote_id ?? '')
    sourceCountMap.set(quoteId, (sourceCountMap.get(quoteId) ?? 0) + 1)
  }

  const exportCountMap = new Map<string, number>()
  const latestVersionMap = new Map<
    string,
    {
      versionNo: number
      actionType: BaoGiaVersionAction | null
    }
  >()
  for (const row of (versionRows ?? []) as Array<Record<string, unknown>>) {
    const quoteId = String(row.quote_id ?? '')
    const actionType = String(row.action_type ?? '') as BaoGiaVersionAction
    if (actionType === 'EXPORT') {
      exportCountMap.set(quoteId, (exportCountMap.get(quoteId) ?? 0) + 1)
    }
    const versionNo = Number(row.version_no ?? 0)
    const current = latestVersionMap.get(quoteId)
    if (!current || versionNo > current.versionNo) {
      latestVersionMap.set(quoteId, { versionNo, actionType })
    }
  }

  return quotes.map((row) => {
    const quoteId = String(row.quote_id ?? '')
    const currentVersionNo = Number(row.current_version_no ?? 0)
    const latestVersion = latestVersionMap.get(quoteId)
    const status = String(row.trang_thai ?? 'NHAP') as BaoGiaStatus
    const meta = parseBaoGiaMeta(row)
    const productionApproved = Boolean(meta.production_approved_at || meta.production_approved)
    const productionApprovedAt = meta.production_approved_at ? String(meta.production_approved_at) : null
    const productionApprovedBy = meta.production_approved_by ? String(meta.production_approved_by) : null
    const statusLabel = formatBaoGiaStatusDisplay(status, {
      currentVersionNo,
      latestActionType: latestVersion?.actionType ?? null,
      productionApproved,
      productionApprovedAt,
    })
    return {
      quoteId,
    maBaoGia: String(row.ma_bao_gia ?? ''),
    daId: String(row.da_id ?? ''),
    khId: String(row.kh_id ?? ''),
    duAn: projectMap.get(String(row.da_id ?? '')) ?? 'Chưa có dự án',
    khachHang: customerMap.get(String(row.kh_id ?? '')) ?? 'Chưa có khách hàng',
      status,
      statusLabel,
      currentVersionNo,
    totalAmount: Number(row.tong_tien ?? 0),
      exportCount: exportCountMap.get(quoteId) ?? 0,
      sourceEstimateCount: sourceCountMap.get(quoteId) ?? 0,
    createdAt: String(row.created_at ?? ''),
    exportedAt: row.ngay_xuat_cuoi ? String(row.ngay_xuat_cuoi) : null,
      productionApproved,
      productionApprovedAt,
      productionApprovedBy,
      productionApprovalLabel:
        status === 'DA_CHOT' || productionApproved
          ? formatProductionApprovalLabel(productionApproved, productionApprovedAt)
          : null,
    }
  }) satisfies BaoGiaListItem[]
}

export async function loadBaoGiaDetail(supabase: AnySupabase, quoteId: string) {
  const [{ data: quoteRow, error: quoteError }, { data: versionRows, error: versionError }, { data: linkRows, error: linkError }] = await Promise.all([
    supabase
      .from('bao_gia')
      .select('*')
      .eq('quote_id', quoteId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('bao_gia_version')
      .select('version_id, quote_id, version_no, action_type, snapshot_json, print_html, tong_tien, ghi_chu, exported_at, created_at, created_by')
      .eq('quote_id', quoteId)
      .order('version_no', { ascending: false }),
    supabase.from('bao_gia_boc_tach').select('boc_id').eq('quote_id', quoteId),
  ])

  if (quoteError) throw quoteError
  if (versionError) throw versionError
  if (linkError) throw linkError
  if (!quoteRow) return null

  const versions = (versionRows ?? []) as BaoGiaVersionRow[]
  const latestVersion =
    versions[0] ??
    ({
      version_id: '',
      quote_id: String(quoteRow.quote_id),
      version_no: 0,
      action_type: 'SAVE',
      snapshot_json: buildEmptySnapshot(),
      print_html: null,
      tong_tien: Number(quoteRow.tong_tien ?? 0),
      ghi_chu: null,
      exported_at: quoteRow.ngay_xuat_cuoi ? String(quoteRow.ngay_xuat_cuoi) : null,
      created_at: String(quoteRow.created_at ?? ''),
      created_by: null,
    } satisfies BaoGiaVersionRow)

  const quoteMeta = parseBaoGiaMeta(quoteRow as Record<string, unknown>)
  const productionApproved = Boolean(quoteMeta.production_approved_at || quoteMeta.production_approved)
  const productionApprovedAt = quoteMeta.production_approved_at
    ? String(quoteMeta.production_approved_at)
    : null
  const productionApprovedBy = quoteMeta.production_approved_by
    ? String(quoteMeta.production_approved_by)
    : null
  const effectiveStatusLabel = formatBaoGiaStatusDisplay(String(quoteRow.trang_thai ?? 'NHAP'), {
    currentVersionNo: Number(quoteRow.current_version_no ?? 0),
    latestActionType: latestVersion.action_type,
    productionApproved,
    productionApprovedAt,
  })

  const [projectMap, customerMap] = await Promise.all([
    loadProjectMap(supabase, [String(quoteRow.da_id)]),
    loadCustomerMap(supabase, [String(quoteRow.kh_id)]),
  ])

  return {
    quote: {
      quote_id: String(quoteRow.quote_id),
      ma_bao_gia: String(quoteRow.ma_bao_gia),
      da_id: String(quoteRow.da_id),
      kh_id: String(quoteRow.kh_id),
      phuong_thuc_van_chuyen: String(quoteRow.phuong_thuc_van_chuyen),
      trang_thai: String(quoteRow.trang_thai) as BaoGiaStatus,
      current_version_no: Number(quoteRow.current_version_no ?? 0),
      tong_tien: Number(quoteRow.tong_tien ?? 0),
      created_at: String(quoteRow.created_at ?? ''),
      updated_at: String(quoteRow.updated_at ?? ''),
      ngay_xuat_cuoi: quoteRow.ngay_xuat_cuoi ? String(quoteRow.ngay_xuat_cuoi) : null,
      status_label: effectiveStatusLabel,
      production_approved: productionApproved,
      production_approved_at: productionApprovedAt,
      production_approved_by: productionApprovedBy,
      production_approval_label:
        String(quoteRow.trang_thai ?? 'NHAP') === 'DA_CHOT' || productionApproved
          ? formatProductionApprovalLabel(productionApproved, productionApprovedAt)
          : null,
    },
    latestVersion,
    versions,
    estimateIds: ((linkRows ?? []) as Array<Record<string, unknown>>).map((row) => String(row.boc_id ?? '')).filter(Boolean),
    duAn: projectMap.get(String(quoteRow.da_id)) ?? null,
    khachHang: customerMap.get(String(quoteRow.kh_id)) ?? null,
  } satisfies BaoGiaDetail
}

export async function saveBaoGia(
  supabase: AnySupabase,
  params: {
    userId: string
    quoteId?: string
    action: 'SAVE' | 'EXPORT'
    snapshot: BaoGiaSnapshot
    printHtml?: string
    note?: string
  }
) {
  const status: BaoGiaStatus = params.action === 'EXPORT' ? 'DA_XUAT_PDF' : 'NHAP'
  const nowIso = new Date().toISOString()

  let quoteId = String(params.quoteId || '').trim()
  let currentVersionNo = 0
  let quoteCode = ''

  if (quoteId) {
    const { data: existing, error } = await supabase
      .from('bao_gia')
      .select('quote_id, current_version_no, ma_bao_gia')
      .eq('quote_id', quoteId)
      .maybeSingle()
    if (error) throw error
    if (!existing) throw new Error('Không tìm thấy báo giá để cập nhật.')
    currentVersionNo = Number(existing.current_version_no ?? 0)
    quoteCode = String(existing.ma_bao_gia ?? '')
  } else {
    quoteCode = await buildBaoGiaCode(supabase)
    const firstEstimateId = String(params.snapshot.sourceEstimateIds[0] || '').trim()
    if (!firstEstimateId) throw new Error('Thiếu dự toán nguồn để tạo báo giá.')

    const { data: sourceHeader, error: sourceError } = await supabase
      .from('boc_tach_nvl')
      .select('da_id, kh_id, phuong_thuc_van_chuyen')
      .eq('boc_id', firstEstimateId)
      .maybeSingle()

    if (sourceError) throw sourceError
    if (!sourceHeader) throw new Error('Không tìm thấy dự toán nguồn để tạo báo giá.')

    const created = await insertBaoGiaWithFallback(supabase, {
      ma_bao_gia: quoteCode,
      da_id: sourceHeader.da_id,
      kh_id: sourceHeader.kh_id,
      phuong_thuc_van_chuyen: sourceHeader.phuong_thuc_van_chuyen,
      trang_thai: status,
      tong_tien: Number(params.snapshot.totalAmount || 0),
      ngay_xuat_cuoi: params.action === 'EXPORT' ? nowIso : null,
      created_by: params.userId,
      updated_by: params.userId,
    })
    quoteId = String(created.quote_id)
  }

  let nextVersionNo = currentVersionNo

  if (params.action === 'SAVE') {
    nextVersionNo = currentVersionNo + 1
    const { data: versionRow, error: versionError } = await supabase
      .from('bao_gia_version')
      .insert({
        quote_id: quoteId,
        version_no: nextVersionNo,
        action_type: 'SAVE',
        snapshot_json: params.snapshot,
        print_html: params.printHtml || null,
        tong_tien: Number(params.snapshot.totalAmount || 0),
        ghi_chu: params.note || null,
        exported_at: null,
        created_by: params.userId,
      })
      .select('version_id')
      .single()

    if (versionError) throw versionError

    const { error: linkDeleteError } = await supabase
      .from('bao_gia_boc_tach')
      .delete()
      .eq('quote_id', quoteId)
    if (linkDeleteError) throw linkDeleteError

    if (params.snapshot.sourceEstimateIds.length > 0) {
      const { error: linkInsertError } = await supabase.from('bao_gia_boc_tach').insert(
        params.snapshot.sourceEstimateIds.map((bocId) => ({
          quote_id: quoteId,
          boc_id: bocId,
          created_by: params.userId,
        }))
      )
      if (linkInsertError) throw linkInsertError
    }

    await updateBaoGiaWithFallback(supabase, quoteId, {
      current_version_no: nextVersionNo,
      current_version_id: versionRow.version_id,
      tong_tien: Number(params.snapshot.totalAmount || 0),
      trang_thai: status,
      updated_by: params.userId,
    })
  } else {
    await updateBaoGiaWithFallback(supabase, quoteId, {
      tong_tien: Number(params.snapshot.totalAmount || 0),
      trang_thai: status,
      ngay_xuat_cuoi: nowIso,
      updated_by: params.userId,
    })
  }

  return {
    quoteId,
    maBaoGia: quoteCode,
    versionNo: nextVersionNo,
    status,
  }
}

export async function transitionBaoGiaStatus(
  supabase: AnySupabase,
  params: {
    quoteId: string
    userId: string
    status: BaoGiaStatus
    note?: string
  }
) {
  const { data: currentRow, error: currentError } = await supabase
    .from('bao_gia')
    .select('*')
    .eq('quote_id', params.quoteId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!currentRow) throw new Error('Không tìm thấy báo giá')

  const currentMeta = parseBaoGiaMeta(currentRow as Record<string, unknown>)
  const productionApproved = Boolean(currentMeta.production_approved || currentMeta.production_approved_at)
  if (productionApproved && params.status !== 'DA_CHOT') {
    throw new Error('Báo giá đã duyệt sản xuất, không được chuyển sang trạng thái khác.')
  }
  const shouldClearProductionApproval = params.status !== 'DA_CHOT'
  const nextMeta = {
    ...currentMeta,
    ...(shouldClearProductionApproval
      ? {
          production_approved: false,
          production_approved_at: '',
          production_approved_by: '',
          production_approval_note: '',
        }
      : {}),
  }
  const patch: Record<string, unknown> = {
    trang_thai: params.status,
    updated_by: params.userId,
    ghi_chu: buildStoredBaoGiaNote(params.note || String(currentMeta.note || ''), nextMeta),
  }
  const nowIso = new Date().toISOString()
  if (params.status === 'DA_GUI_KHACH') patch.ngay_gui_khach = nowIso
  if (params.status === 'DA_CHOT') patch.ngay_chot = nowIso
  if (params.status === 'KH_YEU_CAU_CHINH_SUA') patch.ly_do_chinh_sua = params.note || null

  const data = await updateBaoGiaWithFallback(supabase, params.quoteId, patch)
  if (!data) throw new Error('Không cập nhật được trạng thái báo giá')
  return {
    quoteId: String(data.quote_id),
    status: String(data.trang_thai) as BaoGiaStatus,
    statusLabel: formatBaoGiaStatusLabel(String(data.trang_thai), {
      currentVersionNo: Number(data.current_version_no ?? 0),
      latestActionType: null,
    }),
  }
}

export async function approveBaoGiaProduction(
  supabase: AnySupabase,
  params: {
    quoteId: string
    userId: string
    note?: string
  }
) {
  const { data: currentRow, error: currentError } = await supabase
    .from('bao_gia')
    .select('*')
    .eq('quote_id', params.quoteId)
    .eq('is_active', true)
    .maybeSingle()

  if (currentError) throw currentError
  if (!currentRow) throw new Error('Không tìm thấy báo giá')
  if (String(currentRow.trang_thai ?? '') !== 'DA_CHOT') {
    throw new Error('Chỉ duyệt sản xuất cho báo giá đã thành công.')
  }

  const currentMeta = parseBaoGiaMeta(currentRow as Record<string, unknown>)
  const nowIso = new Date().toISOString()
  const nextMeta = {
    ...currentMeta,
    production_approved: true,
    production_approved_at: nowIso,
    production_approved_by: params.userId,
    production_approval_note: params.note || String(currentMeta.production_approval_note || ''),
  }

  const data = await updateBaoGiaWithFallback(supabase, params.quoteId, {
    updated_by: params.userId,
    ghi_chu: buildStoredBaoGiaNote(String(currentMeta.note || ''), nextMeta),
  })

  if (!data) throw new Error('Không cập nhật được duyệt sản xuất')

  return {
    quoteId: String(data.quote_id),
    productionApproved: true,
    productionApprovedAt: nowIso,
    productionApprovalLabel: formatProductionApprovalLabel(true, nowIso),
  }
}

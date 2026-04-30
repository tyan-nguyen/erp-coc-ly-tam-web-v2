import type { SupabaseClient } from '@supabase/supabase-js'
import { formatBaoGiaStatusLabel } from '@/lib/bao-gia/repository'
import { isQlsxRole } from '@/lib/auth/roles'

type AnySupabase = SupabaseClient
const BAO_GIA_META_PREFIX = 'ERP_BAO_GIA_META::'

export type DonHangRow = {
  order_id: string
  ma_order: string | null
  boc_id: string | null
  da_id: string
  kh_id: string
  loai_coc: string
  do_ngoai: number
  mac_be_tong: string
  to_hop_doan: unknown
  trang_thai: string
  trang_thai_label: string | null
  gia_ban_goc: number | null
  ty_le_giam_gia: number | null
  ly_do_giam_gia: string | null
  gia_ban_sau_giam: number | null
  giam_gia_yeu_cau_at: string | null
  giam_gia_yeu_cau_by: string | null
  giam_gia_duyet_at: string | null
  giam_gia_duyet_by: string | null
  ngay_yeu_cau_giao: string | null
  ngay_du_kien_hoan: string | null
  ghi_chu: string | null
  is_active: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type DonHangTimelineRow = {
  log_id: number
  order_id: string
  from_state: string | null
  to_state: string | null
  changed_by: string | null
  changed_by_role: string | null
  changed_at: string
  ghi_chu: string | null
}

export type DonHangStateTransitionRow = {
  from_state: string
  to_state: string
  actor_roles: string[] | null
  mo_ta: string | null
}

export type DonHangListItem = {
  order: DonHangRow
  duAnName: string | null
  khachHangName: string | null
  timelineCount: number
  linkedQuote: {
    quoteId: string | null
    maBaoGia: string | null
    status: string | null
    statusLabel: string | null
    totalAmount: number | null
    productionApproved: boolean
    productionApprovedAt: string | null
    productionApprovalLabel: string | null
  }
}

export type DonHangDetail = {
  order: DonHangRow
  duAnName: string | null
  khachHangName: string | null
  timeline: DonHangTimelineRow[]
  transitions: DonHangStateTransitionRow[]
  linkedQuote: {
    quoteId: string | null
    maBaoGia: string | null
    status: string | null
    statusLabel: string | null
    totalAmount: number | null
    productionApproved: boolean
    productionApprovedAt: string | null
    productionApprovalLabel: string | null
  }
}

type UserProfileLookup = {
  user_id: string
  ho_ten: string | null
  email: string | null
}

function normalizeRole(role: string | null | undefined) {
  return String(role ?? '').trim().toLowerCase()
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function isMissingRelationError(message?: string) {
  return /relation .* does not exist/i.test(String(message ?? '')) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(String(message ?? ''))
}

function toOrderRow(row: Record<string, unknown>): DonHangRow {
  return row as unknown as DonHangRow
}

function parseBaoGiaMeta(row: Record<string, unknown>) {
  const raw = String(row.ghi_chu || '').trim()
  if (!raw) return {} as Record<string, unknown>
  if (!raw.startsWith(BAO_GIA_META_PREFIX)) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw.slice(BAO_GIA_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
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

async function loadLinkedQuoteMap(supabase: AnySupabase, bocIds: string[]) {
  const empty = new Map<
    string,
    {
      quoteId: string | null
      maBaoGia: string | null
        status: string | null
        statusLabel: string | null
        totalAmount: number | null
        productionApproved: boolean
        productionApprovedAt: string | null
        productionApprovalLabel: string | null
      updatedAtMs: number
    }
  >()
  if (!bocIds.length) return empty

  const { data: linkRows, error: linkError } = await supabase
    .from('bao_gia_boc_tach')
    .select('quote_id, boc_id')
    .in('boc_id', bocIds)

  if (linkError && !isMissingRelationError(linkError.message)) throw linkError
  if (linkError && isMissingRelationError(linkError.message)) return empty

  const quoteIds = unique((linkRows ?? []).map((row) => String(row.quote_id ?? '')))
  if (!quoteIds.length) return empty

  const { data: quoteRows, error: quoteError } = await supabase
    .from('bao_gia')
    .select('quote_id, ma_bao_gia, trang_thai, current_version_no, updated_at, ghi_chu, tong_tien')
    .in('quote_id', quoteIds)
    .eq('is_active', true)

  if (quoteError && !isMissingRelationError(quoteError.message)) throw quoteError
  if (quoteError && isMissingRelationError(quoteError.message)) return empty

  const quoteMap = new Map(
    ((quoteRows ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.quote_id ?? ''), row])
  )

  for (const linkRow of (linkRows ?? []) as Array<Record<string, unknown>>) {
    const bocId = String(linkRow.boc_id ?? '')
    const quoteId = String(linkRow.quote_id ?? '')
    const quoteRow = quoteMap.get(quoteId)
    if (!bocId || !quoteRow) continue

    const meta = parseBaoGiaMeta(quoteRow)
    const productionApproved = Boolean(meta.production_approved_at || meta.production_approved)
    const productionApprovedAt = meta.production_approved_at ? String(meta.production_approved_at) : null
    const status = String(quoteRow.trang_thai ?? '')
    const candidate = {
      quoteId,
      maBaoGia: String(quoteRow.ma_bao_gia ?? ''),
      status,
      statusLabel: formatBaoGiaStatusLabel(status, {
        currentVersionNo: Number(quoteRow.current_version_no ?? 0),
        latestActionType: null,
      }),
      totalAmount: quoteRow.tong_tien == null ? null : Number(quoteRow.tong_tien ?? 0),
      productionApproved,
      productionApprovedAt,
      productionApprovalLabel:
        status === 'DA_CHOT' || productionApproved
          ? formatProductionApprovalLabel(productionApproved, productionApprovedAt)
          : null,
      updatedAtMs: new Date(String(quoteRow.updated_at ?? '')).getTime() || 0,
    }

    const current = empty.get(bocId)
    if (!current || candidate.updatedAtMs > current.updatedAtMs) {
      empty.set(bocId, candidate)
    }
  }

  return empty
}

async function loadProjectMap(supabase: AnySupabase, projectIds: string[]) {
  if (!projectIds.length) return new Map<string, string>()

  const { data, error } = await supabase
    .from('dm_duan')
    .select('da_id, ten_da')
    .in('da_id', projectIds)

  if (error && !isMissingRelationError(error.message)) throw error
  if (error && isMissingRelationError(error.message)) return new Map<string, string>()

  return new Map(
    (data ?? []).map((row) => [String(row.da_id), String(row.ten_da || row.da_id)])
  )
}

async function loadCustomerMap(supabase: AnySupabase, customerIds: string[]) {
  if (!customerIds.length) return new Map<string, string>()

  const { data, error } = await supabase
    .from('dm_kh')
    .select('kh_id, ten_kh')
    .in('kh_id', customerIds)

  if (error && !isMissingRelationError(error.message)) throw error
  if (error && isMissingRelationError(error.message)) return new Map<string, string>()

  return new Map(
    (data ?? []).map((row) => [String(row.kh_id), String(row.ten_kh || row.kh_id)])
  )
}

async function loadTimelineCounts(supabase: AnySupabase, orderIds: string[]) {
  const counts = new Map<string, number>()
  if (!orderIds.length) return counts

  const { data, error } = await supabase
    .from('don_hang_trang_thai_log')
    .select('order_id')
    .in('order_id', orderIds)

  if (error && !isMissingRelationError(error.message)) throw error
  if (error && isMissingRelationError(error.message)) return counts

  for (const row of data ?? []) {
    const orderId = String(row.order_id)
    counts.set(orderId, (counts.get(orderId) ?? 0) + 1)
  }

  return counts
}

export async function loadDonHangList(
  supabase: AnySupabase,
  options?: { query?: string; trangThai?: string; viewerRole?: string | null }
) {
  const { data, error } = await supabase
    .from('don_hang')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error && !isMissingRelationError(error.message)) throw error
  if (error && isMissingRelationError(error.message)) return []

  const orders = ((data ?? []) as Record<string, unknown>[]).map(toOrderRow)
  const projectMap = await loadProjectMap(supabase, unique(orders.map((row) => row.da_id)))
  const customerMap = await loadCustomerMap(supabase, unique(orders.map((row) => row.kh_id)))
  const timelineCountMap = await loadTimelineCounts(
    supabase,
    unique(orders.map((row) => row.order_id))
  )
  const linkedQuoteMap = await loadLinkedQuoteMap(
    supabase,
    unique(orders.map((row) => row.boc_id)).filter(Boolean)
  )

  const list = orders.map((order) => ({
    order,
    duAnName: projectMap.get(order.da_id) ?? null,
    khachHangName: customerMap.get(order.kh_id) ?? null,
    timelineCount: timelineCountMap.get(order.order_id) ?? 0,
    linkedQuote:
      linkedQuoteMap.get(String(order.boc_id ?? '')) ?? {
        quoteId: null,
        maBaoGia: null,
        status: null,
        statusLabel: null,
        totalAmount: null,
        productionApproved: false,
        productionApprovedAt: null,
        productionApprovalLabel: null,
        updatedAtMs: 0,
      },
  }))

  const q = String(options?.query ?? '').trim().toLowerCase()
  const trangThai = String(options?.trangThai ?? '').trim()

  return list.filter((item) => {
    if (isQlsxRole(options?.viewerRole) && !item.linkedQuote.productionApproved) {
      return false
    }
    const matchStatus = !trangThai || item.order.trang_thai === trangThai
    if (!matchStatus) return false
    if (!q) return true

    const haystack = [
      item.order.ma_order,
      item.order.trang_thai,
      item.order.trang_thai_label,
      item.order.loai_coc,
      item.order.mac_be_tong,
      item.duAnName,
      item.khachHangName,
      item.order.ghi_chu,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(q)
  })
}

export async function loadDonHangDetail(supabase: AnySupabase, orderId: string) {
  const { data: orderData, error: orderError } = await supabase
    .from('don_hang')
    .select('*')
    .eq('order_id', orderId)
    .eq('is_active', true)
    .maybeSingle()

  if (orderError && !isMissingRelationError(orderError.message)) throw orderError
  if (orderError && isMissingRelationError(orderError.message)) return null
  if (!orderData) return null

  const order = toOrderRow(orderData as Record<string, unknown>)

  const [
    { data: projectData, error: projectError },
    { data: customerData, error: customerError },
    { data: timelineData, error: timelineError },
    { data: transitionData, error: transitionError },
  ] = await Promise.all([
    supabase.from('dm_duan').select('ten_da').eq('da_id', order.da_id).maybeSingle(),
    supabase.from('dm_kh').select('ten_kh').eq('kh_id', order.kh_id).maybeSingle(),
    supabase
      .from('don_hang_trang_thai_log')
      .select('*')
      .eq('order_id', orderId)
      .order('changed_at', { ascending: false }),
    supabase
      .from('don_hang_state_machine')
      .select('*')
      .eq('from_state', order.trang_thai)
      .order('to_state'),
  ])

  if (projectError && !isMissingRelationError(projectError.message)) throw projectError
  if (customerError && !isMissingRelationError(customerError.message)) throw customerError
  if (timelineError && !isMissingRelationError(timelineError.message)) throw timelineError
  if (transitionError && !isMissingRelationError(transitionError.message)) throw transitionError

  const linkedQuoteMap = await loadLinkedQuoteMap(
    supabase,
    order.boc_id ? [String(order.boc_id)] : []
  )
  const linkedQuote =
    linkedQuoteMap.get(String(order.boc_id ?? '')) ?? {
      quoteId: null,
      maBaoGia: null,
      status: null,
      statusLabel: null,
      totalAmount: null,
      productionApproved: false,
      productionApprovedAt: null,
      productionApprovalLabel: null,
      updatedAtMs: 0,
    }

  return {
    order,
    duAnName: projectData?.ten_da ? String(projectData.ten_da) : null,
    khachHangName: customerData?.ten_kh ? String(customerData.ten_kh) : null,
    timeline: ((timelineData ?? []) as Record<string, unknown>[]) as DonHangTimelineRow[],
    transitions: ((transitionData ?? []) as Record<string, unknown>[]) as DonHangStateTransitionRow[],
    linkedQuote: {
      quoteId: linkedQuote.quoteId,
      maBaoGia: linkedQuote.maBaoGia,
      status: linkedQuote.status,
      statusLabel: linkedQuote.statusLabel,
      totalAmount: linkedQuote.totalAmount,
      productionApproved: linkedQuote.productionApproved,
      productionApprovedAt: linkedQuote.productionApprovedAt,
      productionApprovalLabel: linkedQuote.productionApprovalLabel,
    },
  } satisfies DonHangDetail
}

export function filterTransitionsByRole(
  transitions: DonHangStateTransitionRow[],
  role: string | null | undefined
) {
  const normalizedRole = normalizeRole(role)

  return transitions.filter((row) =>
    (row.actor_roles ?? []).some((candidate) => normalizeRole(candidate) === normalizedRole)
  )
}

function normalizeStateKey(value: string | null | undefined) {
  return String(value || '').trim().toUpperCase()
}

function isBackwardOrderTransition(detail: DonHangDetail, toState: string) {
  const target = normalizeStateKey(toState)
  const current = normalizeStateKey(detail.order.trang_thai)
  if (!target || target === current) return false

  const seenStates = new Set<string>()
  for (const row of detail.timeline) {
    if (row.from_state) seenStates.add(normalizeStateKey(row.from_state))
    if (row.to_state) seenStates.add(normalizeStateKey(row.to_state))
  }

  return seenStates.has(target)
}

async function hasOrderDownstreamRecords(supabase: AnySupabase, orderId: string) {
  const [
    { count: planCount, error: planError },
    { count: shipmentCount, error: shipmentError },
  ] = await Promise.all([
    supabase
      .from('ke_hoach_sx_line')
      .select('line_id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('is_active', true),
    supabase
      .from('phieu_xuat_ban')
      .select('voucher_id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('is_active', true),
  ])

  if (planError && !isMissingRelationError(planError.message)) throw planError
  if (shipmentError && !isMissingRelationError(shipmentError.message)) throw shipmentError

  return {
    hasProductionPlan: Number(planCount || 0) > 0,
    hasShipmentVoucher: Number(shipmentCount || 0) > 0,
  }
}

export async function loadActorDisplayMap(
  supabase: AnySupabase,
  timeline: DonHangTimelineRow[]
) {
  const userIds = unique(timeline.map((row) => row.changed_by))
  if (!userIds.length) return new Map<string, string>()

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, ho_ten, email')
    .in('user_id', userIds)

  if (error) throw error

  return new Map(
    ((data ?? []) as UserProfileLookup[]).map((row) => [
      row.user_id,
      row.ho_ten || row.email || row.user_id,
    ])
  )
}

export async function transitionDonHang(
  supabase: AnySupabase,
  params: {
    orderId: string
    userId: string
    userRole: string
    toState: string
    note?: string
  }
) {
  const detail = await loadDonHangDetail(supabase, params.orderId)
  if (!detail) {
    throw new Error('Khong tim thay don_hang')
  }

  const allowedTransitions = filterTransitionsByRole(detail.transitions, params.userRole)
  const matchedTransition = allowedTransitions.find((row) => row.to_state === params.toState)

  if (!matchedTransition) {
    throw new Error('Ban khong co quyen hoac transition khong hop le')
  }

  if (isBackwardOrderTransition(detail, params.toState)) {
    const downstream = await hasOrderDownstreamRecords(supabase, params.orderId)
    if (downstream.hasShipmentVoucher) {
      throw new Error('Đơn hàng đã có phiếu xuất. Cần mở ngược phiếu xuất trước khi chuyển lùi trạng thái.')
    }
    if (downstream.hasProductionPlan) {
      throw new Error('Đơn hàng đã lên kế hoạch sản xuất. Cần mở ngược kế hoạch trước khi chuyển lùi trạng thái.')
    }
  }

  const payload: Record<string, unknown> = {
    trang_thai: params.toState,
    updated_by: params.userId,
  }

  const note = String(params.note ?? '').trim()
  if (note) {
    payload.ghi_chu = note
  }

  const { data, error } = await supabase
    .from('don_hang')
    .update(payload)
    .eq('order_id', params.orderId)
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Khong cap nhat duoc don_hang')

  const { data: timelineData, error: timelineError } = await supabase
    .from('don_hang_trang_thai_log')
    .select('*')
    .eq('order_id', params.orderId)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (timelineError) throw timelineError

  return {
    order: data as Record<string, unknown>,
    latestLog: (timelineData ?? null) as Record<string, unknown> | null,
  }
}

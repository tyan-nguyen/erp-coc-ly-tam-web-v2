import { createClient } from '@/lib/supabase/server'

type RowData = Record<string, unknown>
const BOC_META_PREFIX = 'ERP_BOC_META::'

export type BocTachListRow = {
  id: string
  displayId: string
  daId: string
  khId: string
  maCoc: string
  duAn: string
  khachHang: string
  loaiCoc: string
  soLuongMd: number
  phuongThucVanChuyen: string
  trangThai: string
  trangThaiLabel: string
  canDelete: boolean
  createdAt: string
  linkedQuoteStatus: string | null
}

export type BocTachListPageData = {
  rows: BocTachListRow[]
  error: { message: string } | null
}

function isMissingRelationError(message?: string) {
  return /relation .* does not exist/i.test(String(message ?? '')) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(String(message ?? ''))
}

export async function loadBocTachListPageData(input: {
  qlsxViewer: boolean
}) {
  const supabase = await createClient()
  const [
    { data: headerRows, error },
    { data: projectRows },
    { data: customerRows },
    quoteStatusByBocId,
  ] = await Promise.all([
    loadBocTachHeadersForList(supabase),
    supabase.from('dm_duan').select('da_id, ma_da, ten_da').limit(500),
    supabase.from('dm_kh').select('kh_id, ma_kh, ten_kh').limit(500),
    loadQuoteStatusByBocId(supabase),
  ])

  const rows = (headerRows ?? []) as RowData[]
  const projectMap = new Map(
    ((projectRows ?? []) as RowData[]).map((row) => [
      String(row.da_id ?? ''),
      {
        ma_da: String(row.ma_da ?? ''),
        ten_da: String(row.ten_da ?? ''),
      },
    ])
  )
  const customerMap = new Map(
    ((customerRows ?? []) as RowData[]).map((row) => [
      String(row.kh_id ?? ''),
      {
        ma_kh: String(row.ma_kh ?? ''),
        ten_kh: String(row.ten_kh ?? ''),
      },
    ])
  )
  const rawListRows: Array<BocTachListRow & { _projectCode: string }> = rows.map((row) => {
      const id = resolveHeaderId(row)
      const project = projectMap.get(String(row.da_id ?? ''))
      const customer = customerMap.get(String(row.kh_id ?? ''))
      const projectCode = project?.ma_da || project?.ten_da || 'BT'
      const bocMeta = parseBocMeta(row)
      const firstSegment = readFirstSegment(row)
      const maCoc =
        String(row.ma_coc ?? bocMeta.ma_coc ?? firstSegment?.ma_coc ?? '').trim() || 'Chưa có mã cọc'
      const loaiCoc = String(row.loai_coc ?? '').trim() || 'Chưa có loại cọc'
      const totalMd = deriveTotalMd(row)
      const status = String(row.trang_thai ?? 'NHAP')
      const createdAt = String(row.created_at ?? row.gui_qlsx_at ?? row.updated_at ?? '')

      return {
        id,
        displayId: '',
        daId: String(row.da_id ?? ''),
        khId: String(row.kh_id ?? ''),
        maCoc,
        duAn: [project?.ma_da, project?.ten_da].filter(Boolean).join(' - ') || 'Chưa có dự án',
        khachHang: [customer?.ma_kh, customer?.ten_kh].filter(Boolean).join(' - ') || 'Chưa có khách hàng',
        loaiCoc,
        soLuongMd: totalMd,
        phuongThucVanChuyen: String(row.phuong_thuc_van_chuyen ?? ''),
        trangThai: status,
        trangThaiLabel: formatStatusLabel(status),
        canDelete: status === 'NHAP' || status === 'TRA_LAI',
        createdAt,
        linkedQuoteStatus: quoteStatusByBocId.get(id) ?? null,
        _projectCode: projectCode,
      }
    })

  const listRows = rawListRows
    .filter((row) =>
      input.qlsxViewer ? row.trangThai === 'DA_GUI' || row.trangThai === 'DA_DUYET_QLSX' : true
    )
    .sort((left, right) => compareRowsDesc(left.createdAt, right.createdAt, left.id, right.id))

  const sequenceMap = buildDisplaySequenceMap(listRows)
  const finalRows = listRows.map(({ _projectCode, ...row }) => ({
    ...row,
    displayId: buildDisplayId(_projectCode, row.maCoc, sequenceMap.get(row.id) ?? 1),
  }))

  return {
    rows: finalRows,
    error: error ? { message: error.message } : null,
  } satisfies BocTachListPageData
}

async function loadQuoteStatusByBocId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: linkRows, error: linkError }, { data: quoteRows, error: quoteError }] = await Promise.all([
    supabase.from('bao_gia_boc_tach').select('quote_id, boc_id').limit(1000),
    supabase.from('bao_gia').select('quote_id, trang_thai, updated_at').eq('is_active', true).limit(1000),
  ])

  if (linkError && !isMissingRelationError(linkError.message)) throw linkError
  if (quoteError && !isMissingRelationError(quoteError.message)) throw quoteError
  if ((linkError && isMissingRelationError(linkError.message)) || (quoteError && isMissingRelationError(quoteError.message))) {
    return new Map<string, string>()
  }

  const quoteMap = new Map(
    ((quoteRows ?? []) as RowData[]).map((row) => [
      String(row.quote_id ?? ''),
      {
        status: String(row.trang_thai ?? ''),
        updatedAt: new Date(String(row.updated_at ?? '')).getTime() || 0,
      },
    ])
  )

  const result = new Map<string, string>()
  for (const row of (linkRows ?? []) as RowData[]) {
    const bocId = String(row.boc_id ?? '')
    const quoteId = String(row.quote_id ?? '')
    const quote = quoteMap.get(quoteId)
    if (!bocId || !quote) continue

    const currentStatus = result.get(bocId)
    if (currentStatus === 'THAT_BAI') continue
    result.set(bocId, quote.status)
  }

  return result
}

async function loadBocTachHeadersForList(supabase: Awaited<ReturnType<typeof createClient>>) {
  const optimizedSelect =
    'boc_id,boc_tach_id,id,da_id,kh_id,ma_coc,loai_coc,mac_be_tong,do_ngoai,chieu_day,to_hop_doan,ghi_chu,trang_thai,phuong_thuc_van_chuyen,created_at,updated_at,gui_qlsx_at'

  const optimizedAttempt = await supabase
    .from('boc_tach_nvl')
    .select(optimizedSelect)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (!optimizedAttempt.error) {
    return optimizedAttempt
  }

  if (isMissingRelationError(optimizedAttempt.error.message)) {
    return { data: [], error: null }
  }

  if (!optimizedAttempt.error.message.toLowerCase().includes('column')) {
    return optimizedAttempt
  }

  const fallbackAttempt = await supabase
    .from('boc_tach_nvl')
    .select('*')
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (fallbackAttempt.error && isMissingRelationError(fallbackAttempt.error.message)) {
    return { data: [], error: null }
  }

  return fallbackAttempt
}

function resolveHeaderId(row: RowData) {
  return String(row.boc_id ?? row.boc_tach_id ?? row.id ?? '')
}

function parseBocMeta(row: RowData) {
  const raw = String(row.ghi_chu ?? '').trim()
  if (!raw.startsWith(BOC_META_PREFIX)) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw.slice(BOC_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

function readFirstSegment(row: RowData) {
  const segments = Array.isArray(row.to_hop_doan) ? row.to_hop_doan : []
  const first = segments.find((segment) => segment && typeof segment === 'object')
  return (first as RowData | undefined) ?? null
}

function deriveTotalMd(row: RowData) {
  const segments = Array.isArray(row.to_hop_doan) ? row.to_hop_doan : []
  return segments.reduce((acc, segment) => {
    if (!segment || typeof segment !== 'object') return acc
    const item = segment as Record<string, unknown>
    const len = Number(item.len_m ?? 0)
    const qty = Number(item.so_luong_doan ?? item.cnt ?? 0)
    if (!Number.isFinite(len) || !Number.isFinite(qty)) return acc
    return acc + len * qty
  }, 0)
}

function buildDisplaySequenceMap(rows: Array<BocTachListRow & { _projectCode: string }>) {
  const sorted = [...rows].sort((left, right) => compareRowsAsc(left.createdAt, right.createdAt, left.id, right.id))
  const counters = new Map<string, number>()
  const result = new Map<string, number>()

  for (const row of sorted) {
    const key = `${row._projectCode}__${row.maCoc}`
    const next = (counters.get(key) ?? 0) + 1
    counters.set(key, next)
    result.set(row.id, next)
  }

  return result
}

function buildDisplayId(projectCode: string, maCoc: string, sequence: number) {
  const projectPart = projectCode || 'BT'
  const maCocPart = maCoc || 'Chưa có mã cọc'
  const sequencePart = String(sequence).padStart(2, '0')
  return `${projectPart} · ${maCocPart} · ${sequencePart}`
}

function formatStatusLabel(status: string) {
  switch (status) {
    case 'DA_GUI':
      return 'Đã gửi QLSX'
    case 'TRA_LAI':
      return 'Trả lại chỉnh sửa'
    case 'DA_DUYET_QLSX':
      return 'Đã duyệt QLSX'
    case 'HUY':
      return 'Hủy'
    case 'NHAP':
    default:
      return 'Nháp'
  }
}

function compareRowsDesc(leftDate: string, rightDate: string, leftId: string, rightId: string) {
  const leftTime = leftDate ? new Date(leftDate).getTime() : 0
  const rightTime = rightDate ? new Date(rightDate).getTime() : 0
  if (leftTime !== rightTime) return rightTime - leftTime
  return rightId.localeCompare(leftId)
}

function compareRowsAsc(leftDate: string, rightDate: string, leftId: string, rightId: string) {
  const leftTime = leftDate ? new Date(leftDate).getTime() : 0
  const rightTime = rightDate ? new Date(rightDate).getTime() : 0
  if (leftTime !== rightTime) return leftTime - rightTime
  return leftId.localeCompare(rightId)
}

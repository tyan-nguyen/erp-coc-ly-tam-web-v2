import type { RowData } from '@/lib/master-data/crud-utils'

const TEMPLATE_META_PREFIX = 'ERP_TEMPLATE_META::'
const TEMPLATE_NVL_FIELDS = [
  'pc_nvl_id',
  'thep_pc_nvl_id',
  'dai_nvl_id',
  'thep_dai_nvl_id',
  'buoc_nvl_id',
  'thep_buoc_nvl_id',
  'mat_bich_nvl_id',
  'mang_xong_nvl_id',
  'tap_nvl_id',
  'tap_vuong_nvl_id',
  'mui_coc_nvl_id',
] as const

function safeString(value: unknown) {
  return String(value ?? '').trim()
}

type TemplateUsageShape = {
  template_id?: unknown
  ma_coc?: unknown
  loai_coc?: unknown
  mac_be_tong?: unknown
  do_ngoai?: unknown
  chieu_day?: unknown
}

type SelectResult = Promise<{ data: unknown[] | null; error: { message: string } | null }>

type QuerySupabaseLike = {
  from: (tableName: string) => {
    select: (columns: string) => {
      limit: (count: number) => SelectResult
      eq?: (field: string, value: unknown) => unknown
    }
  }
}

function buildTemplateUsageKey(row: TemplateUsageShape) {
  const templateId = safeString(row.template_id)
  if (templateId) return templateId

  const maCoc = safeString(row.ma_coc)
  if (maCoc) return maCoc

  const loaiCoc = safeString(row.loai_coc)
  const macBeTong = safeString(row.mac_be_tong)
  const doNgoai = safeString(row.do_ngoai)
  const chieuDay = safeString(row.chieu_day)
  if (!loaiCoc && !macBeTong && !doNgoai && !chieuDay) return ''

  return [loaiCoc, macBeTong, doNgoai, chieuDay].join('|')
}

function isMissingColumnError(error: { message: string } | null | undefined, columnName: string) {
  const message = safeString(error?.message).toLowerCase()
  return message.includes('column') && message.includes(columnName.toLowerCase()) && message.includes('does not exist')
}

function isMissingRelationError(error: { message: string } | null | undefined) {
  const message = safeString(error?.message)
  return /relation .* does not exist/i.test(message) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(message)
}

function parseTemplateMeta(row: RowData) {
  const ghiChu = safeString(row.ghi_chu)
  if (!ghiChu.startsWith(TEMPLATE_META_PREFIX)) return {}
  try {
    return JSON.parse(ghiChu.slice(TEMPLATE_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function readTemplateNvlIds(row: RowData) {
  const ids = new Set<string>()
  for (const field of TEMPLATE_NVL_FIELDS) {
    const value = safeString(row[field])
    if (value) ids.add(value)
  }
  const meta = parseTemplateMeta(row)
  for (const field of TEMPLATE_NVL_FIELDS) {
    const value = safeString(meta[field])
    if (value) ids.add(value)
  }
  return ids
}

function buildUsageMessage(reasons: string[], fallback: string) {
  if (reasons.length === 0) return fallback
  return `${fallback} - ${reasons.join(', ')}`
}

export async function buildNvlUsageMap(
  supabase: QuerySupabaseLike,
  ids: string[]
) {
  const targetIds = new Set(ids.filter(Boolean))
  const reasonMap = new Map<string, Set<string>>()

  function addReason(id: string, reason: string) {
    if (!targetIds.has(id)) return
    const current = reasonMap.get(id) ?? new Set<string>()
    current.add(reason)
    reasonMap.set(id, current)
  }

  const [auxRows, mixRows, itemRows, templateRows] = await Promise.all([
    supabase.from('dm_dinh_muc_phu_md').select('nvl_id').limit(2000),
    supabase.from('dm_capphoi_bt').select('nvl_id').limit(2000),
    supabase.from('boc_tach_nvl_items').select('nvl_id').limit(3000),
    supabase.from('dm_coc_template').select('*').limit(500),
  ])

  for (const result of [auxRows, mixRows, itemRows, templateRows]) {
    if (result.error && !isMissingRelationError(result.error)) {
      throw new Error(result.error.message)
    }
  }

  for (const row of isMissingRelationError(auxRows.error) ? [] : ((auxRows.data ?? []) as RowData[])) {
    addReason(safeString(row.nvl_id), 'Định mức vật tư phụ')
  }
  for (const row of isMissingRelationError(mixRows.error) ? [] : ((mixRows.data ?? []) as RowData[])) {
    addReason(safeString(row.nvl_id), 'Cấp phối bê tông')
  }
  for (const row of isMissingRelationError(itemRows.error) ? [] : ((itemRows.data ?? []) as RowData[])) {
    addReason(safeString(row.nvl_id), 'Bóc tách')
  }
  for (const row of isMissingRelationError(templateRows.error) ? [] : ((templateRows.data ?? []) as RowData[])) {
    for (const id of readTemplateNvlIds(row)) {
      addReason(id, 'Loại cọc mẫu')
    }
  }

  const messageMap = new Map<string, string>()
  for (const id of ids) {
    const reasons = [...(reasonMap.get(id) ?? new Set<string>())]
    if (reasons.length > 0) {
      messageMap.set(
        id,
        buildUsageMessage(reasons, 'Đã phát sinh chứng từ')
      )
    }
  }

  return messageMap
}

export async function getNvlUsageMessage(
  supabase: QuerySupabaseLike,
  id: string
) {
  const map = await buildNvlUsageMap(supabase, [id])
  return map.get(id) ?? ''
}

export async function buildTemplateUsageMap(
  supabase: QuerySupabaseLike,
  rows: RowData[]
) {
  const templateKeys = new Set(rows.map((row) => buildTemplateUsageKey(row)).filter(Boolean))
  const selectAttempts = [
    'template_id, ma_coc, loai_coc, mac_be_tong, do_ngoai, chieu_day',
    'ma_coc, loai_coc, mac_be_tong, do_ngoai, chieu_day',
    'loai_coc, mac_be_tong, do_ngoai, chieu_day',
  ]

  let data: unknown[] | null = null
  let error: { message: string } | null = null
  for (const columns of selectAttempts) {
    const result = await supabase
      .from('boc_tach_nvl')
      .select(columns)
      .limit(3000)

    data = result.data
    error = result.error
    if (!error) break

    if (isMissingRelationError(error)) {
      return new Map<string, string>()
    }

    if (
      isMissingColumnError(error, 'template_id') ||
      isMissingColumnError(error, 'ma_coc')
    ) {
      continue
    }

    break
  }

  if (error) throw new Error(error.message)

  const usedKeys = new Set(
    ((data ?? []) as RowData[])
      .map((row) => buildTemplateUsageKey(row))
      .filter((key) => templateKeys.has(key))
  )

  const messageMap = new Map<string, string>()
  for (const row of rows) {
    const key = buildTemplateUsageKey(row)
    if (!key) continue
    if (!usedKeys.has(key)) continue
    messageMap.set(
      key,
      'Đã phát sinh chứng từ - Bóc tách'
    )
  }

  return messageMap
}

export async function getTemplateUsageMessage(
  supabase: {
    from: (tableName: string) => {
      select: (columns: string) => {
        eq: (field: string, value: unknown) => {
          eq: (field: string, value: unknown) => {
            eq: (field: string, value: unknown) => {
              eq: (field: string, value: unknown) => {
                limit: (count: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
              }
            }
          }
        }
      }
    }
  },
  row: TemplateUsageShape
) {
  const templateId = safeString(row.template_id)
  const maCoc = safeString(row.ma_coc)
  const loaiCoc = safeString(row.loai_coc)
  const macBeTong = safeString(row.mac_be_tong)
  const doNgoai = safeString(row.do_ngoai)
  const chieuDay = safeString(row.chieu_day)
  if (!templateId && !maCoc && !loaiCoc && !macBeTong && !doNgoai && !chieuDay) return ''

  let scopedResult =
    templateId
      ? await supabase.from('boc_tach_nvl').select('boc_id').eq('template_id', templateId).limit(1)
      : await Promise.resolve({ data: [], error: null })

  if (isMissingRelationError(scopedResult.error)) {
    return ''
  }

  if (
    (!templateId || isMissingColumnError(scopedResult.error, 'template_id')) &&
    maCoc
  ) {
    scopedResult = await supabase.from('boc_tach_nvl').select('boc_id').eq('ma_coc', maCoc).limit(1)
    if (isMissingRelationError(scopedResult.error)) {
      return ''
    }
  }

  if (
    (templateId || maCoc) &&
    scopedResult.error &&
    (isMissingColumnError(scopedResult.error, 'template_id') || isMissingColumnError(scopedResult.error, 'ma_coc'))
  ) {
    scopedResult = { data: [], error: null }
  }

  if ((scopedResult.data ?? []).length === 0 && loaiCoc) {
    let compositeQuery = supabase.from('boc_tach_nvl').select('boc_id').eq('loai_coc', loaiCoc)
    if (macBeTong) {
      compositeQuery = compositeQuery.eq('mac_be_tong', macBeTong)
    }
    if (doNgoai) {
      compositeQuery = compositeQuery.eq('do_ngoai', doNgoai)
    }
    if (chieuDay) {
      compositeQuery = compositeQuery.eq('chieu_day', chieuDay)
    }
    scopedResult = await compositeQuery.limit(1)
    if (isMissingRelationError(scopedResult.error)) {
      return ''
    }
  }

  if (scopedResult.error) throw new Error(scopedResult.error.message)
  if ((scopedResult.data ?? []).length === 0) return ''

  return 'Đã phát sinh chứng từ - Bóc tách'
}

export function buildTemplateUsageKeyFromRow(row: TemplateUsageShape) {
  return buildTemplateUsageKey(row)
}

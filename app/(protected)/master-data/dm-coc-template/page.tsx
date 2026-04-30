import Link from 'next/link'
import { DmCocTemplateListClient } from '@/components/master-data/master-data-list-extras'
import { DmCocTemplateFields } from '@/components/master-data/dm-coc-template-fields'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import {
  createDmCocTemplateAction,
  updateDmCocTemplateAction,
  updateDmCocTemplateSourceAction,
} from '@/lib/master-data/dm-coc-template-actions'
import { buildTemplateUsageKeyFromRow, buildTemplateUsageMap } from '@/lib/master-data/reference-guards'
import {
  displayCellValue,
  pickKeyField,
  readParam,
  safeStringify,
  type RowData,
} from '@/lib/master-data/crud-utils'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-coc-template'
const PAGE_SIZE = 15
const DEFAULT_MAC_OPTIONS = ['600', '800']
const CUONG_DO_OPTIONS = ['PC', 'PHC']
const MAC_THEP_OPTIONS = ['A', 'B', 'C']
const TEMPLATE_META_PREFIX = 'ERP_TEMPLATE_META::'
const DON_KEP_OPTIONS = [
  { value: '1', label: 'Đơn' },
  { value: '2', label: 'Kép' },
]

export default async function DmCocTemplatePage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_coc_template')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const editKey = readParam(searchParams, 'edit_key')
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const supabase = await createClient()
  const [{ data: templateRows, error }, { data: nvlRows }, { data: concreteMixRows }] = await Promise.all([
    supabase.from('dm_coc_template').select('*').limit(200),
    supabase.from('nvl').select('*').eq('is_active', true).limit(400),
    supabase.from('dm_capphoi_bt').select('*').eq('is_active', true).limit(500),
  ])

  const rows = (templateRows ?? []) as RowData[]
  const nvlItems = (nvlRows ?? []) as RowData[]
  const concreteMixItems = (concreteMixRows ?? []) as RowData[]
  const keyField = pickKeyField('dm_coc_template', rows)
  const codeMap = buildTemplateCodeMap(rows, keyField)
  const usageMessageMap = await buildTemplateUsageMap(supabase as never, rows)
  const nvlMap = new Map(nvlItems.map((row) => [String(row.nvl_id ?? ''), row]))
  const steelOptions = nvlItems
    .filter((row) => String(row.nhom_hang ?? '').trim().toUpperCase() === 'THEP')
    .sort((a, b) => String(a.ten_hang ?? '').localeCompare(String(b.ten_hang ?? '')))
  const accessoryOptions = nvlItems
    .filter((row) => String(row.nhom_hang ?? '').trim().toUpperCase() === 'PHU_KIEN')
    .sort((a, b) => String(a.ten_hang ?? '').localeCompare(String(b.ten_hang ?? '')))
  const macOptions = Array.from(
    new Set([
      ...concreteMixItems
        .filter((row) => parseVariant(row) === 'FULL_XI_TRO_XI')
        .map((row) => normalizeConcreteGradeOption(row.mac_be_tong))
        .filter(Boolean),
      ...DEFAULT_MAC_OPTIONS,
    ])
  ).sort((left, right) => Number(left || 0) - Number(right || 0))
  const sortedRows = [...rows].sort(compareTemplateRows)
  const filteredByActive = sortedRows.filter((row) => row.is_active !== false)
  const listRows = filteredByActive.map((row) => ({
    ...row,
    pc_nos_hien_thi: readTemplateScalar(row, ['pc_nos']),
    don_kep_hien_thi: formatDonKep(readTemplateScalar(row, ['don_kep_factor'])),
    a1_hien_thi: readTemplateScalar(row, ['a1_mm']),
    a2_hien_thi: readTemplateScalar(row, ['a2_mm']),
    a3_hien_thi: readTemplateScalar(row, ['a3_mm']),
    p1_hien_thi: formatPercent(readTemplateScalar(row, ['p1_pct'])),
    p2_hien_thi: formatPercent(readTemplateScalar(row, ['p2_pct'])),
    p3_hien_thi: formatPercent(readTemplateScalar(row, ['p3_pct'])),
    ma_hien_thi: codeMap.get(String(row[keyField ?? 'template_id'] ?? '')) ?? resolveTemplateCode(row),
    nguon_hien_thi: resolveTemplateSourceLabel(row),
    steel_pc_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['pc_nvl_id', 'thep_pc_nvl_id'], ['thep_pc', 'pc_label'], 'pc_dia_mm', 'Thép PC'),
    steel_dai_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['dai_nvl_id', 'thep_dai_nvl_id'], ['thep_dai', 'dai_label'], 'dai_dia_mm', 'Thép đai'),
    steel_buoc_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['buoc_nvl_id', 'thep_buoc_nvl_id'], ['thep_buoc', 'buoc_label'], 'buoc_dia_mm', 'Thép buộc'),
    mat_bich_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['mat_bich_nvl_id'], ['mat_bich', 'mat_bich_label']),
    mang_xong_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['mang_xong_nvl_id'], ['mang_xong', 'mang_xong_label']),
    tap_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['tap_nvl_id', 'tap_vuong_nvl_id'], ['tap_vuong', 'tap_label']),
    mui_coc_hien_thi: resolveTemplateNvlDisplay(row, nvlMap, ['mui_coc_nvl_id'], ['mui_coc', 'mui_coc_label']),
    khoi_luong_kg_md_hien_thi: readWeightKgMd(row),
    search_text: [
      codeMap.get(String(row[keyField ?? 'template_id'] ?? '')) ?? resolveTemplateCode(row),
      row.loai_coc,
      resolveTemplateSourceLabel(row),
      row.do_ngoai,
      row.chieu_day,
      row.mac_be_tong,
      resolveTemplateNvlDisplay(row, nvlMap, ['pc_nvl_id', 'thep_pc_nvl_id'], ['thep_pc', 'pc_label'], 'pc_dia_mm', 'Thép PC'),
      resolveTemplateNvlDisplay(row, nvlMap, ['dai_nvl_id', 'thep_dai_nvl_id'], ['thep_dai', 'dai_label'], 'dai_dia_mm', 'Thép đai'),
      resolveTemplateNvlDisplay(row, nvlMap, ['buoc_nvl_id', 'thep_buoc_nvl_id'], ['thep_buoc', 'buoc_label'], 'buoc_dia_mm', 'Thép buộc'),
      resolveTemplateNvlDisplay(row, nvlMap, ['mat_bich_nvl_id'], ['mat_bich', 'mat_bich_label']),
      resolveTemplateNvlDisplay(row, nvlMap, ['mang_xong_nvl_id'], ['mang_xong', 'mang_xong_label']),
      resolveTemplateNvlDisplay(row, nvlMap, ['tap_nvl_id', 'tap_vuong_nvl_id'], ['tap_vuong', 'tap_label']),
      resolveTemplateNvlDisplay(row, nvlMap, ['mui_coc_nvl_id'], ['mui_coc', 'mui_coc_label']),
    ]
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .join(' '),
  }))
  const editRow = editKey && keyField ? rows.find((row) => String(row[keyField]) === editKey) ?? null : null
  const editLockedMessage = editRow
    ? usageMessageMap.get(buildTemplateUsageKeyFromRow(editRow)) ?? ''
    : ''
  const editCodePreview =
    editRow && keyField
      ? codeMap.get(String(editRow[keyField])) ?? resolveTemplateCode(editRow)
      : ''

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Loại cọc mẫu</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Cài thông số chuẩn của từng loại cọc. Các thép và phụ kiện đều chọn từ danh mục NVL để bóc tách dùng đúng mã hàng.
        </p>
      </section>

      {msg ? (
        <section className="master-data-section master-data-message master-data-message-success">
          {msg}
        </section>
      ) : null}
      {err ? <section className="master-data-section master-data-message master-data-message-error">{err}</section> : null}

      <section className="master-data-section">
        <h2 className="text-lg font-semibold">Tạo mới</h2>
        <form action={createDmCocTemplateAction} className="mt-5 space-y-5">
          <DmCocTemplateFields
            steelOptions={steelOptions}
            accessoryOptions={accessoryOptions}
            macOptions={macOptions}
            cuongDoOptions={CUONG_DO_OPTIONS}
            macThepOptions={MAC_THEP_OPTIONS}
            donKepOptions={DON_KEP_OPTIONS}
          />
          <div className="flex justify-end">
            <FormSubmitButton
              pendingLabel="Đang lưu loại cọc..."
              className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
            >
              Lưu loại cọc
            </FormSubmitButton>
          </div>
        </form>
      </section>

      <section className="master-data-section">
        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto rounded-xl p-4 text-sm">{JSON.stringify(error, null, 2)}</pre>
        ) : (
          <DmCocTemplateListClient
            rows={listRows}
            keyField={keyField ?? 'template_id'}
            basePath={BASE_PATH}
            initialQ={q}
            pageSize={PAGE_SIZE}
          />
        )}
      </section>

      {editRow && keyField ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="app-surface max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[28px] border p-0 shadow-2xl" style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 14%, var(--color-border))' }}>
            <div
              className="rounded-t-[28px] px-6 py-5"
              style={{
                background:
                  'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 14%, white), color-mix(in srgb, var(--color-primary) 6%, white))',
                borderBottom: '1px solid color-mix(in srgb, var(--color-primary) 12%, var(--color-border))',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold tracking-[0.16em] uppercase" style={{ color: 'var(--color-primary)' }}>
                    Xem loại cọc mẫu
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{String(editRow.loai_coc ?? '-')}</h2>
                  <p className="app-muted mt-2 text-sm">Theo dõi thông số chuẩn của loại cọc và điều chỉnh `Nguồn mẫu` để quyết định có hiện trong `Lập dự toán` hay không.</p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <form action={updateDmCocTemplateAction} className="space-y-5">
                {editLockedMessage ? (
                  <div className="app-primary-soft rounded-2xl px-4 py-4 text-sm">
                    {editLockedMessage}
                    <div className="mt-2 text-xs opacity-80">
                      Mẫu này đã phát sinh chứng từ nên không sửa trực tiếp thông số nữa. Nếu cần thay đổi bản vẽ, mình tạo loại cọc mẫu mới để tránh ảnh hưởng dữ liệu cũ.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border px-4 py-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                    Mẫu này đang ở chế độ chỉ xem thông số. Nếu bản vẽ thay đổi, mình tạo loại cọc mẫu mới thay vì sửa đè lên mẫu cũ.
                  </div>
                )}
                  <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">Nguồn mẫu</p>
                        <p className="app-muted mt-1 text-xs">
                          `Nhà máy` sẽ hiện trong dropdown `Lập dự toán`. `Khách phát sinh` sẽ bị ẩn khỏi dropdown này.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <select
                          name="template_scope"
                          defaultValue={resolveTemplateSourceValue(editRow)}
                          className="app-input min-w-[180px] rounded-xl px-3 py-2 text-sm"
                        >
                          <option value="FACTORY">Nhà máy</option>
                          <option value="CUSTOM">Khách phát sinh</option>
                        </select>
                        <button
                          type="submit"
                          formAction={updateDmCocTemplateSourceAction}
                          className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition"
                        >
                          Lưu nguồn mẫu
                        </button>
                      </div>
                    </div>
                  </div>
                  <input type="hidden" name="key_value" value={safeStringify(editRow[keyField])} />
                  <DmCocTemplateFields
                    steelOptions={steelOptions}
                    accessoryOptions={accessoryOptions}
                    macOptions={macOptions}
                    cuongDoOptions={CUONG_DO_OPTIONS}
                    macThepOptions={MAC_THEP_OPTIONS}
                    donKepOptions={DON_KEP_OPTIONS}
                    readOnly
                    showSourceField={false}
                    codePreviewOverride={editCodePreview}
                    initialValues={{
                      loai_coc: String(editRow.loai_coc ?? ''),
                      template_scope: resolveTemplateSourceValue(editRow),
                      cuong_do: normalizeCuongDo(String(editRow.cuong_do ?? editRow.loai_coc ?? '')),
                      mac_thep: extractSteelGrade(String(editRow.mac_thep ?? editRow.loai_coc ?? '')),
                      do_ngoai: String(editRow.do_ngoai ?? ''),
                      chieu_day: String(editRow.chieu_day ?? ''),
                      mac_be_tong: String(editRow.mac_be_tong ?? ''),
                      pc_nos: String(readTemplateScalar(editRow, ['pc_nos']) ?? ''),
                      don_kep_factor: String(readTemplateScalar(editRow, ['don_kep_factor']) ?? ''),
                      a1_mm: String(readTemplateScalar(editRow, ['a1_mm']) ?? ''),
                      a2_mm: String(readTemplateScalar(editRow, ['a2_mm']) ?? '0'),
                      a3_mm: String(readTemplateScalar(editRow, ['a3_mm']) ?? ''),
                      p1_pct: String(readTemplateScalar(editRow, ['p1_pct']) ?? ''),
                      p2_pct: String(readTemplateScalar(editRow, ['p2_pct']) ?? '0'),
                      p3_pct: String(readTemplateScalar(editRow, ['p3_pct']) ?? ''),
                      khoi_luong_kg_md: String(readWeightKgMd(editRow) ?? ''),
                      ghi_chu: readTemplateNote(editRow),
                      pc_nvl_id: readCandidate(editRow, ['pc_nvl_id', 'thep_pc_nvl_id']),
                      dai_nvl_id: readCandidate(editRow, ['dai_nvl_id', 'thep_dai_nvl_id']),
                      buoc_nvl_id: readCandidate(editRow, ['buoc_nvl_id', 'thep_buoc_nvl_id']),
                      mat_bich_nvl_id: readCandidate(editRow, ['mat_bich_nvl_id']),
                      mang_xong_nvl_id: readCandidate(editRow, ['mang_xong_nvl_id']),
                      tap_nvl_id: readCandidate(editRow, ['tap_nvl_id', 'tap_vuong_nvl_id']),
                      mui_coc_nvl_id: readCandidate(editRow, ['mui_coc_nvl_id']),
                    }}
                  />

                  <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                    <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                      Đóng
                    </Link>
                  </div>
                </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


function resolveTemplateNvlDisplay(
  row: RowData,
  nvlMap: Map<string, RowData>,
  idFields: string[],
  labelFields: string[],
  diameterField?: string,
  diameterPrefix?: string
) {
  const idValue = readCandidate(row, idFields)
  if (idValue && nvlMap.has(idValue)) {
    const item = nvlMap.get(idValue)!
    return String(item.ten_hang ?? '')
  }

  const labelValue = readCandidate(row, labelFields)
  if (labelValue) return labelValue

  if (diameterField) {
    const diameter = Number(readTemplateScalar(row, [diameterField]) ?? 0)
    if (Number.isFinite(diameter) && diameter > 0) {
      return `${diameterPrefix ?? 'NVL'} ${diameter}`
    }
  }

  return '-'
}

function readCandidate(row: RowData, fields: string[]) {
  for (const field of fields) {
    const value = String(row[field] ?? '').trim()
    if (value) return value
  }
  const metadata = readTemplateMetadata(row)
  for (const field of fields) {
    const value = String(metadata[field] ?? '').trim()
    if (value) return value
  }
  return ''
}

function readWeightKgMd(row: RowData) {
  for (const field of ['khoi_luong_kg_md', 'kg_md', 'trong_luong_kg_md']) {
    const value = row[field]
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value
    }
  }
  const metadata = readTemplateMetadata(row)
  for (const field of ['khoi_luong_kg_md', 'kg_md', 'trong_luong_kg_md']) {
    const value = metadata[field]
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value
    }
  }
  return null
}

function readTemplateScalar(row: RowData, fields: string[]) {
  for (const field of fields) {
    const value = row[field]
    if (value !== null && value !== undefined && String(value).trim() !== '') return value
  }
  const metadata = readTemplateMetadata(row)
  for (const field of fields) {
    const value = metadata[field]
    if (value !== null && value !== undefined && String(value).trim() !== '') return value
  }
  return null
}

function compareTemplateRows(a: RowData, b: RowData) {
  const diameterDiff = Number(a.do_ngoai ?? 0) - Number(b.do_ngoai ?? 0)
  if (diameterDiff !== 0) return diameterDiff

  const steelDiff = getSteelGradeRank(a) - getSteelGradeRank(b)
  if (steelDiff !== 0) return steelDiff

  const cuongDoDiff = getCuongDoRank(a) - getCuongDoRank(b)
  if (cuongDoDiff !== 0) return cuongDoDiff

  const macDiff = Number(a.mac_be_tong ?? 0) - Number(b.mac_be_tong ?? 0)
  if (macDiff !== 0) return macDiff

  const loaiDiff = String(a.loai_coc ?? '').localeCompare(String(b.loai_coc ?? ''))
  if (loaiDiff !== 0) return loaiDiff

  return compareRowsDesc(a, b)
}

function compareRowsDesc(a: RowData, b: RowData) {
  const aTime = readRowTime(a)
  const bTime = readRowTime(b)
  if (aTime !== bTime) return bTime - aTime
  return String(b.id ?? '').localeCompare(String(a.id ?? ''))
}

function readRowTime(row: RowData) {
  const raw = row.created_at ?? row.updated_at ?? null
  if (!raw) return 0
  const time = new Date(String(raw)).getTime()
  return Number.isNaN(time) ? 0 : time
}

function formatDonKep(value: unknown) {
  const parsed = Number(value ?? 0)
  if (parsed === 2) return 'Kép'
  if (parsed === 1) return 'Đơn'
  return displayCellValue(value)
}

function normalizeCuongDo(value: string | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized.startsWith('PHC')) return 'PHC'
  if (normalized.startsWith('PC')) return 'PC'
  return normalized
}

function extractSteelGrade(value: string) {
  const normalized = String(value ?? '').trim().toUpperCase()
  const direct = normalized.match(/^([ABC])$/)
  if (direct) return direct[1]
  const fromLoai = normalized.match(/-\s*([ABC])\d+/)
  return fromLoai?.[1] ?? ''
}

function getSteelGradeRank(row: RowData) {
  const grade = extractSteelGrade(String(row.mac_thep ?? row.loai_coc ?? ''))
  if (grade === 'A') return 0
  if (grade === 'B') return 1
  if (grade === 'C') return 2
  return 9
}

function getCuongDoRank(row: RowData) {
  const cuongDo = normalizeCuongDo(String(row.cuong_do ?? row.loai_coc ?? ''))
  if (cuongDo === 'PC') return 0
  if (cuongDo === 'PHC') return 1
  return 9
}

function resolveTemplateCode(row: RowData) {
  for (const field of ['ma_coc', 'ma_coc_template']) {
    const value = String(row[field] ?? '').trim()
    if (value) return value
  }
  const mac = String(row.mac_be_tong ?? '').trim()
  const steelGrade = extractSteelGrade(String(row.mac_thep ?? row.loai_coc ?? ''))
  const diameter = String(row.do_ngoai ?? '').trim()
  const thickness = String(row.chieu_day ?? '').trim()
  if (!mac || !steelGrade || !diameter || !thickness) return '-'
  return `M${mac} - ${steelGrade}${diameter} - ${thickness}`
}

function buildTemplateCodeMap(rows: RowData[], keyField: string | null) {
  const sorted = [...rows].sort((a, b) => {
    const aTime = new Date(String(a.created_at ?? a.updated_at ?? '')).getTime() || 0
    const bTime = new Date(String(b.created_at ?? b.updated_at ?? '')).getTime() || 0
    if (aTime !== bTime) return aTime - bTime
    return String(a[keyField ?? 'template_id'] ?? '').localeCompare(String(b[keyField ?? 'template_id'] ?? ''))
  })
  const counts = new Map<string, number>()
  const map = new Map<string, string>()

  for (const row of sorted) {
    const explicit = resolveTemplateCode(row)
    const mac = String(row.mac_be_tong ?? '').trim()
    const steelGrade = extractSteelGrade(String(row.mac_thep ?? row.loai_coc ?? ''))
    const diameter = String(row.do_ngoai ?? '').trim()
    const thickness = String(row.chieu_day ?? '').trim()
    const rowKey = String(row[keyField ?? 'template_id'] ?? '')
    if (!rowKey) continue
    if (!mac || !steelGrade || !diameter || !thickness) {
      map.set(rowKey, explicit)
      continue
    }
    const prefix = `M${mac} - ${steelGrade}${diameter} - ${thickness}`
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    map.set(rowKey, explicit.startsWith(`${prefix} - `) ? explicit : `${prefix} - ${next}`)
  }

  return map
}

function formatPercent(value: unknown) {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed) || parsed <= 0) return parsed === 0 ? '0%' : displayCellValue(value)
  return `${parsed}%`
}

function readTemplateMetadata(row: RowData) {
  const raw = String(row.ghi_chu ?? '').trim()
  if (!raw.startsWith(TEMPLATE_META_PREFIX)) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw.slice(TEMPLATE_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

function readTemplateNote(row: RowData) {
  const metadata = readTemplateMetadata(row)
  const note = String(metadata.note ?? '').trim()
  if (note) return note
  const raw = String(row.ghi_chu ?? '').trim()
  return raw.startsWith(TEMPLATE_META_PREFIX) ? '' : raw
}

function resolveTemplateSourceLabel(row: RowData) {
  const metadata = readTemplateMetadata(row)
  const scope = String(metadata.template_scope ?? row.template_scope ?? '').trim().toUpperCase()
  return scope === 'CUSTOM' ? 'Khách phát sinh' : 'Nhà máy'
}

function resolveTemplateSourceValue(row: RowData) {
  const metadata = readTemplateMetadata(row)
  const scope = String(metadata.template_scope ?? row.template_scope ?? '').trim().toUpperCase()
  return scope === 'CUSTOM' ? 'CUSTOM' : 'FACTORY'
}

function parseVariant(row: RowData) {
  const direct = String(row.variant ?? row.cap_phoi_variant ?? row.loai_cap_phoi ?? '').trim()
  if (direct) return direct
  const ghiChu = String(row.ghi_chu ?? '').trim()
  const match = ghiChu.match(/variant\s*:\s*([A-Z0-9_ -]+)/i)
  return match?.[1]?.trim() || 'FULL_XI_TRO_XI'
}

function normalizeConcreteGradeOption(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const match = raw.match(/\d+(?:[.,]\d+)?/g)
  if (!match || match.length === 0) return ''
  const numeric = Number(match[match.length - 1].replace(',', '.'))
  if (!Number.isFinite(numeric) || numeric < 100 || numeric > 2000) return ''
  return String(Math.round(numeric))
}

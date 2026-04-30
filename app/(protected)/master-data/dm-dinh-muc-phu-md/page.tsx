import type { ReactNode } from 'react'
import Link from 'next/link'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { DmDinhMucPhuGroupListClient } from '@/components/master-data/master-data-list-extras'
import { DmDinhMucPhuForm } from '@/components/master-data/dm-dinh-muc-phu-form'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import {
  createDmDinhMucPhuAction,
  updateDmDinhMucPhuAction,
} from '@/lib/master-data/dm-dinh-muc-phu-actions'
import {
  readParam,
  type RowData,
} from '@/lib/master-data/crud-utils'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-dinh-muc-phu-md'
const PAGE_SIZE = 15

export default async function DmDinhMucPhuMdPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_dinh_muc_phu_md')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const editGroup = readParam(searchParams, 'edit_group')
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const supabase = await createClient()
  const [{ data: rowsData, error }, { data: templateRows }, { data: nvlRows }] = await Promise.all([
    supabase.from('dm_dinh_muc_phu_md').select('*').limit(500),
    supabase.from('dm_coc_template').select('*').eq('is_active', true).limit(400),
    supabase.from('nvl').select('*').eq('is_active', true).limit(1000),
  ])

  const missingSetup = isMissingRelationError(error?.message)
  const rows = (rowsData ?? []) as RowData[]
  const templates = (templateRows ?? []) as RowData[]
  const allNvlItems = (nvlRows ?? []) as RowData[]
  const nvlItems = allNvlItems
    .filter((row) => isValidAuxiliaryNvlName(String(row.ten_hang ?? '')))
    .sort((a, b) => String(a.ten_hang ?? '').localeCompare(String(b.ten_hang ?? '')))
  const nvlMap = new Map(allNvlItems.map((row) => [String(row.nvl_id ?? ''), row]))
  const pileGroups = Array.from(
    new Map(
      templates
        .map((row) => ({
          value: buildPileGroupValue(row),
          label: buildPileGroupLabel(row),
        }))
        .filter((item) => item.value)
        .map((item) => [item.value, item])
    ).values()
  ).sort((a, b) => a.label.localeCompare(b.label))

  const sortedRows = [...rows].sort(compareRows)
  const filteredByActive = sortedRows.filter((row) => row.is_active !== false)
  const groupedRows = buildAuxiliaryGroups(filteredByActive, '', nvlMap)
  const listGroups = groupedRows.map((group) => ({
    group: group.group,
    label: formatPileGroupKey(group.group),
    summary: group.summary,
    itemCount: group.items.length,
    search_text: `${formatPileGroupKey(group.group)} ${group.summary}`,
  }))
  const editGroupRows = editGroup
    ? filteredByActive.filter((row) => String(row.nhom_d ?? '').trim() === editGroup)
    : []
  const editItems = editGroupRows.map((row) => ({
    id: String(row.dm_id ?? row.id ?? ''),
    nvl_id: String(row.nvl_id ?? ''),
    query: String(nvlMap.get(String(row.nvl_id ?? ''))?.ten_hang ?? row.nvl_id ?? ''),
    dvt: String(row.dvt ?? ''),
    dinh_muc: String(row.dinh_muc ?? ''),
  }))

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Định mức vật tư phụ</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Chọn bộ thông số cọc theo ĐK ngoài + Thành cọc trước, sau đó thêm các dòng vật tư phụ đi kèm như than đá, dầu DO, điện, que hàn... Định mức này không bám theo mã cọc.
        </p>
      </section>

      {msg ? (
        <section className="master-data-section master-data-message master-data-message-success">
          {msg}
        </section>
      ) : null}
      {err ? <section className="master-data-section master-data-message master-data-message-error">{err}</section> : null}

      {missingSetup ? (
        <section className="master-data-section master-data-message master-data-message-success">
          Chức năng này cần chạy SQL khởi tạo trước. Bảng <code>dm_dinh_muc_phu_md</code> hiện chưa có trên project này.
        </section>
      ) : (
        <>
          <section className="master-data-section">
            <h2 className="text-lg font-semibold">Tạo mới</h2>
            <form action={createDmDinhMucPhuAction} className="mt-5 space-y-5">
              <DmDinhMucPhuForm
                pileGroups={pileGroups}
                nvlOptions={nvlItems.map((row) => ({
                  nvl_id: String(row.nvl_id ?? ''),
                  ten_hang: String(row.ten_hang ?? ''),
                  dvt: String(row.dvt ?? ''),
                }))}
              />
              <div className="flex justify-end">
                <FormSubmitButton
                  pendingLabel="Đang lưu định mức..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu định mức
                </FormSubmitButton>
              </div>
            </form>
          </section>

          <section className="master-data-section">
            {error ? (
              <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">{JSON.stringify(error, null, 2)}</pre>
            ) : (
              <DmDinhMucPhuGroupListClient
                groups={listGroups}
                basePath={BASE_PATH}
                initialQ={q}
                pageSize={PAGE_SIZE}
              />
            )}
          </section>
        </>
      )}

      {editGroup ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div
            className="app-surface max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[28px] border p-0 shadow-2xl"
            style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 14%, var(--color-border))' }}
          >
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
                    Cập nhật định mức vật tư phụ
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{formatPileGroupKey(editGroup)}</h2>
                  <p className="app-muted mt-2 text-sm">
                    Định mức cập nhật ở đây chỉ áp dụng cho các chứng từ phát sinh sau. Bóc tách/chứng từ cũ giữ nguyên snapshot đã lưu.
                  </p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <form action={updateDmDinhMucPhuAction} className="space-y-5">
                <input type="hidden" name="current_group" value={editGroup} />
                <DmDinhMucPhuForm
                  pileGroups={pileGroups}
                  nvlOptions={nvlItems.map((row) => ({
                    nvl_id: String(row.nvl_id ?? ''),
                    ten_hang: String(row.ten_hang ?? ''),
                    dvt: String(row.dvt ?? ''),
                  }))}
                  initialGroup={editGroup}
                  initialItems={editItems}
                />
                <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                  <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                    Hủy
                  </Link>
                  <FormSubmitButton
                    pendingLabel="Đang cập nhật định mức..."
                    className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                  >
                    Lưu cập nhật
                  </FormSubmitButton>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function isMissingRelationError(message?: string) {
  return /relation .* does not exist/i.test(String(message ?? '')) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(String(message ?? ''))
}

function buildAuxiliaryGroups(rows: RowData[], query: string, nvlMap: Map<string, RowData>) {
  const groups = new Map<
    string,
    { group: string; items: Array<{ ten_hang: string; dvt: string; dinh_muc: string }>; summary: string }
  >()

  for (const row of rows) {
    const groupKey = String(row.nhom_d ?? '').trim()
    if (!groupKey) continue
    const current = groups.get(groupKey) ?? { group: groupKey, items: [], summary: '' }
    current.items.push({
      ten_hang: String(nvlMap.get(String(row.nvl_id ?? ''))?.ten_hang ?? row.nvl_id ?? ''),
      dvt: String(row.dvt ?? ''),
      dinh_muc: String(row.dinh_muc ?? ''),
    })
    groups.set(groupKey, current)
  }

  const keyword = query.trim().toLowerCase()
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.ten_hang.localeCompare(b.ten_hang)),
      summary: group.items
        .sort((a, b) => a.ten_hang.localeCompare(b.ten_hang))
        .map((item) => `${item.ten_hang} (${item.dinh_muc} ${item.dvt}/md)`)
        .join(', '),
    }))
    .filter((group) => {
      if (!keyword) return true
      return `${formatPileGroupKey(group.group)} ${group.summary}`.toLowerCase().includes(keyword)
    })
    .sort((a, b) => a.group.localeCompare(b.group))
}

function buildPileGroupValue(row: RowData) {
  const doNgoai = String(row.do_ngoai ?? '').trim()
  const chieuDay = String(row.chieu_day ?? '').trim()
  if (!doNgoai || !chieuDay) return ''
  return `${doNgoai}|${chieuDay}`
}

function isValidAuxiliaryNvlName(value: string) {
  const normalized = value.trim()
  if (!normalized) return false
  const upper = normalized.toUpperCase()
  if (upper.startsWith('ZZ_')) return false
  return true
}

function buildPileGroupLabel(row: RowData) {
  const value = buildPileGroupValue(row)
  return formatPileGroupKey(value)
}

function formatPileGroupKey(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const pair = raw.match(/^(\d+(?:[.,]\d+)?)\|(\d+(?:[.,]\d+)?)$/)
  if (pair) {
    return `D${pair[1]} - Thành ${pair[2]}`
  }
  const single = raw.match(/^(\d+(?:[.,]\d+)?)$/)
  if (single) {
    return `D${single[1]}`
  }
  return raw
}

function compareRows(a: RowData, b: RowData) {
  const groupDiff = String(a.nhom_d ?? '').localeCompare(String(b.nhom_d ?? ''))
  if (groupDiff !== 0) return groupDiff
  const nvlDiff = String(a.nvl_id ?? '').localeCompare(String(b.nvl_id ?? ''))
  if (nvlDiff !== 0) return nvlDiff
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

function buildPageHref({
  q,
  showInactive,
  editGroup,
  page,
}: {
  q: string
  showInactive: boolean
  editGroup?: string
  page: number
}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (showInactive) params.set('show_inactive', '1')
  if (editGroup) params.set('edit_group', editGroup)
  params.set('page', String(Math.max(page, 1)))
  return `${BASE_PATH}?${params.toString()}`
}

function buildPageNumbers(totalPages: number, currentPage: number) {
  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1])
  return [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b)
}

function PaginationLink({
  href,
  disabled,
  active,
  children,
}: {
  href: string
  disabled?: boolean
  active?: boolean
  children: ReactNode
}) {
  const className = active
    ? 'app-primary inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-semibold'
    : 'app-outline inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-semibold transition'

  if (disabled) {
    return (
      <span className={`${className} opacity-40`} aria-disabled="true">
        {children}
      </span>
    )
  }

  return (
    <a href={href} className={className}>
      {children}
    </a>
  )
}

import type { ReactNode } from 'react'
import Link from 'next/link'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { DmCapphoiBtGroupListClient } from '@/components/master-data/master-data-list-extras'
import { DmCapphoiBtForm } from '@/components/master-data/dm-capphoi-bt-form'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import {
  createDmCapPhoiBtAction,
  updateDmCapPhoiBtAction,
} from '@/lib/master-data/dm-capphoi-bt-actions'
import {
  readParam,
  type RowData,
} from '@/lib/master-data/crud-utils'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-capphoi-bt'
const PAGE_SIZE = 15
const VARIANT_OPTIONS = [
  { value: 'FULL_XI_TRO_XI', label: 'FULL_XI_TRO_XI' },
  { value: 'XI_XI', label: 'XI_XI' },
  { value: 'XI_TRO', label: 'XI_TRO' },
  { value: 'XI', label: 'XI' },
]

export default async function DmCapphoiBtPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_capphoi_bt')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const editVariant = readParam(searchParams, 'edit_variant')
  const editMac = readParam(searchParams, 'edit_mac')
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const supabase = await createClient()
  const [{ data: rowsData, error }, { data: nvlRows }] = await Promise.all([
    supabase.from('dm_capphoi_bt').select('*').limit(500),
    supabase.from('nvl').select('*').eq('is_active', true).eq('nhom_hang', 'NVL').limit(500),
  ])

  const missingSetup = isMissingRelationError(error?.message)
  const rows = (rowsData ?? []) as RowData[]
  const nvlRowsSafe = (nvlRows ?? []) as RowData[]
  const nvlMap = new Map(nvlRowsSafe.map((row) => [String(row.nvl_id ?? ''), row]))

  const sortedRows = [...rows].sort(compareRows)
  const filteredByActive = sortedRows.filter((row) => row.is_active !== false)
  const groupedRows = buildConcreteMixGroups(filteredByActive, '', nvlMap)
  const listGroups = groupedRows.map((group) => ({
    variant: group.variant,
    macBeTong: group.macBeTong,
    summary: group.summary,
    itemCount: group.items.length,
    search_text: `${group.variant} ${group.macBeTong} ${group.summary}`,
  }))
  const editGroupRows =
    editVariant && editMac
      ? filteredByActive.filter(
          (row) => String(row.mac_be_tong ?? '').trim() === editMac && parseVariant(row) === editVariant
        )
      : []
  const editItems = editGroupRows.map((row) => ({
    id: String(row.cp_id ?? row.id ?? ''),
    nvl_id: String(row.nvl_id ?? ''),
    query: String(nvlMap.get(String(row.nvl_id ?? ''))?.ten_hang ?? row.nvl_id ?? ''),
    dvt: String(row.dvt ?? ''),
    dinh_muc_m3: String(row.dinh_muc_m3 ?? ''),
  }))

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Cấp phối bê tông</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Chọn variant cấp phối, nhập mác bê tông, rồi thêm các NVL và định mức trên 1 m3. Màn này đang bám schema hiện tại của DB.
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
          Chức năng này cần chạy SQL khởi tạo trước. Bảng <code>dm_capphoi_bt</code> hiện chưa có trên project này.
        </section>
      ) : (
        <>
          <section className="master-data-section">
            <h2 className="text-lg font-semibold">Tạo mới</h2>
            <form action={createDmCapPhoiBtAction} className="mt-5 space-y-5">
              <DmCapphoiBtForm
                variants={VARIANT_OPTIONS}
                nvlOptions={nvlRowsSafe
                  .map((row) => ({
                    nvl_id: String(row.nvl_id ?? ''),
                    ten_hang: String(row.ten_hang ?? ''),
                    dvt: String(row.dvt ?? ''),
                  }))
                  .sort((a, b) => a.ten_hang.localeCompare(b.ten_hang))}
              />
              <div className="flex justify-end">
                <FormSubmitButton
                  pendingLabel="Đang lưu cấp phối..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu cấp phối
                </FormSubmitButton>
              </div>
            </form>
          </section>

          <section className="master-data-section">
            {error ? (
              <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">{JSON.stringify(error, null, 2)}</pre>
            ) : (
              <DmCapphoiBtGroupListClient
                groups={listGroups}
                basePath={BASE_PATH}
                initialQ={q}
                pageSize={PAGE_SIZE}
              />
            )}
          </section>
        </>
      )}

      {editVariant && editMac ? (
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
                    Cập nhật cấp phối bê tông
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">
                    {editVariant} - M{editMac}
                  </h2>
                  <p className="app-muted mt-2 text-sm">
                    Cập nhật ở đây chỉ áp dụng cho các chứng từ phát sinh sau. Bóc tách/chứng từ cũ giữ nguyên snapshot đã lưu.
                  </p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <form action={updateDmCapPhoiBtAction} className="space-y-5">
                <input type="hidden" name="current_variant" value={editVariant} />
                <input type="hidden" name="current_mac_be_tong" value={editMac} />
                <DmCapphoiBtForm
                  variants={VARIANT_OPTIONS}
                  nvlOptions={nvlRowsSafe
                    .map((row) => ({
                      nvl_id: String(row.nvl_id ?? ''),
                      ten_hang: String(row.ten_hang ?? ''),
                      dvt: String(row.dvt ?? ''),
                    }))
                    .sort((a, b) => a.ten_hang.localeCompare(b.ten_hang))}
                  initialVariant={editVariant}
                  initialMacBeTong={editMac}
                  initialItems={editItems}
                />
                <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                  <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                    Hủy
                  </Link>
                  <FormSubmitButton
                    pendingLabel="Đang cập nhật cấp phối..."
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

function buildConcreteMixGroups(rows: RowData[], query: string, nvlMap: Map<string, RowData>) {
  const groups = new Map<
    string,
    { variant: string; macBeTong: string; items: Array<{ ten_hang: string; dvt: string; dinh_muc_m3: string }>; summary: string }
  >()

  for (const row of rows) {
    const variant = parseVariant(row)
    const macBeTong = String(row.mac_be_tong ?? '').trim()
    const key = `${variant}|${macBeTong}`
    const current = groups.get(key) ?? { variant, macBeTong, items: [], summary: '' }
    current.items.push({
      ten_hang: String(nvlMap.get(String(row.nvl_id ?? ''))?.ten_hang ?? row.nvl_id ?? ''),
      dvt: String(row.dvt ?? ''),
      dinh_muc_m3: String(row.dinh_muc_m3 ?? ''),
    })
    groups.set(key, current)
  }

  const keyword = query.trim().toLowerCase()
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.ten_hang.localeCompare(b.ten_hang)),
      summary: group.items
        .sort((a, b) => a.ten_hang.localeCompare(b.ten_hang))
        .map((item) => `${item.ten_hang} (${item.dinh_muc_m3} ${item.dvt}/m3)`)
        .join(', '),
    }))
    .filter((group) => {
      if (!keyword) return true
      return `${group.variant} ${group.macBeTong} ${group.summary}`.toLowerCase().includes(keyword)
    })
    .sort((a, b) => {
      const macDiff = a.macBeTong.localeCompare(b.macBeTong)
      if (macDiff !== 0) return macDiff
      return a.variant.localeCompare(b.variant)
    })
}

function parseVariant(row: RowData) {
  const direct = String(row.variant ?? row.cap_phoi_variant ?? row.loai_cap_phoi ?? '').trim()
  if (direct) return direct
  const ghiChu = String(row.ghi_chu ?? '').trim()
  const match = ghiChu.match(/variant\s*:\s*([A-Z0-9_ -]+)/i)
  return match?.[1]?.trim() || 'FULL_XI_TRO_XI'
}

function compareRows(a: RowData, b: RowData) {
  const macDiff = String(a.mac_be_tong ?? '').localeCompare(String(b.mac_be_tong ?? ''))
  if (macDiff !== 0) return macDiff
  const variantDiff = parseVariant(a).localeCompare(parseVariant(b))
  if (variantDiff !== 0) return variantDiff
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
  page,
}: {
  q: string
  showInactive: boolean
  page: number
}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (showInactive) params.set('show_inactive', '1')
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

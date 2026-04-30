import Link from 'next/link'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { DmThueLoiNhuanGroupListClient } from '@/components/master-data/master-data-list-extras'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { DmBienLoiNhuanForm } from '@/components/master-data/dm-bien-loi-nhuan-form'
import {
  createDmBienLoiNhuanAction,
  saveDmThueVatAction,
  updateDmBienLoiNhuanAction,
} from '@/lib/master-data/dm-thue-loi-nhuan-actions'
import { readParam, type RowData } from '@/lib/master-data/crud-utils'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-thue-loi-nhuan'
const PAGE_SIZE = 15
const DEFAULT_DIAMETER_OPTIONS = ['300', '350', '400', '500', '600']

export default async function DmThueLoiNhuanPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_thue_loi_nhuan')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const editDiameter = readParam(searchParams, 'edit_diameter')
  const editVat = readParam(searchParams, 'edit_vat') === '1'
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const supabase = await createClient()
  const [{ data: vatRowsData, error: vatError }, { data: profitRowsData, error: profitError }, { data: templateRowsData }] = await Promise.all([
    supabase.from('dm_thue_vat').select('vat_id, loai_ap_dung, vat_pct, is_active, created_at, updated_at').limit(20),
    supabase
      .from('dm_bien_loi_nhuan')
      .select('rule_id, duong_kinh_mm, min_md, loi_nhuan_pct, is_active, deleted_at, created_at, updated_at')
      .limit(500),
    supabase.from('dm_coc_template').select('do_ngoai').eq('is_active', true).limit(400),
  ])

  const missingSetup = [vatError, profitError].some((item) => isMissingRelationError(item?.message))
  const vatRows = (vatRowsData ?? []) as RowData[]
  const profitRows = (profitRowsData ?? []) as RowData[]
  const templateRows = (templateRowsData ?? []) as RowData[]
  const cocVat = findVatPct(vatRows, 'COC')
  const phuKienVat = findVatPct(vatRows, 'PHU_KIEN')
  const diameterOptions = Array.from(
    new Set(
      [...DEFAULT_DIAMETER_OPTIONS, ...templateRows
        .map((row) => String(row.do_ngoai ?? '').trim())
        .filter(Boolean)]
    )
  )
    .sort((a, b) => Number(a) - Number(b))
    .map((item) => ({ value: item, label: `D${item}` }))

  const sortedProfitRows = [...profitRows].sort(compareProfitRows)
  const filteredByActive = sortedProfitRows.filter((row) => row.is_active !== false)
  const groupedRows = buildProfitGroups(filteredByActive, '')
  const listGroups = groupedRows.map((group) => ({
    diameter: group.diameter,
    label: group.label,
    summary: group.summary,
    itemCount: group.items.length,
    search_text: `${group.label} ${group.summary}`,
  }))
  const editGroupRows = editDiameter
    ? filteredByActive.filter((row) => String(row.duong_kinh_mm ?? '').trim() === editDiameter)
    : []
  const editItems = editGroupRows.map((row) => ({
    id: String(row.rule_id ?? row.id ?? ''),
    min_md: String(row.min_md ?? ''),
    loi_nhuan_pct: String(row.loi_nhuan_pct ?? ''),
  }))
  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Thuế VAT và biên lợi nhuận</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Thiết lập VAT cọc, VAT phụ kiện và các mức lợi nhuận theo đường kính cọc + tổng md đơn hàng để dùng cho dự toán và báo giá về sau.
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
          Chức năng này cần chạy SQL khởi tạo trước. File cần chạy: <code>sql/dm_thue_loi_nhuan_setup.sql</code>
        </section>
      ) : (
        <>
          <section className="master-data-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Cấu hình VAT</h2>
                <p className="app-muted mt-2 text-sm">Mặc định chỉ xem. Bấm chỉnh sửa khi thật sự cần thay đổi cấu hình VAT.</p>
              </div>
              {editVat ? (
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Hủy chỉnh sửa
                </Link>
              ) : (
                <Link href={`${BASE_PATH}?edit_vat=1`} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Chỉnh sửa VAT
                </Link>
              )}
            </div>

            {editVat ? (
              <form action={saveDmThueVatAction} className="mt-5 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Thuế cọc (%)">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="coc_vat_pct"
                      defaultValue={String(cocVat)}
                      placeholder="Nhập VAT cọc"
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                  <Field label="Thuế phụ kiện (%)">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="phu_kien_vat_pct"
                      defaultValue={String(phuKienVat)}
                      placeholder="Nhập VAT phụ kiện"
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <FormSubmitButton
                    pendingLabel="Đang lưu VAT..."
                    className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                  >
                    Lưu VAT
                  </FormSubmitButton>
                </div>
              </form>
            ) : (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <ReadOnlyCard label="Thuế cọc (%)" value={`${cocVat}%`} />
                <ReadOnlyCard label="Thuế phụ kiện (%)" value={`${phuKienVat}%`} />
              </div>
            )}
          </section>

          <section className="master-data-section">
            <h2 className="text-lg font-semibold">Tạo rule lợi nhuận</h2>
            <form action={createDmBienLoiNhuanAction} className="mt-5 space-y-5">
              <DmBienLoiNhuanForm diameterOptions={diameterOptions} />
              <div className="flex justify-end">
                <FormSubmitButton
                  pendingLabel="Đang lưu lợi nhuận..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu rule lợi nhuận
                </FormSubmitButton>
              </div>
            </form>
          </section>

          <section className="master-data-section">
            <DmThueLoiNhuanGroupListClient
              groups={listGroups}
              basePath={BASE_PATH}
              initialQ={q}
              pageSize={PAGE_SIZE}
            />
          </section>
        </>
      )}

      {editDiameter ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div
            className="app-surface max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border p-0 shadow-2xl"
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
                    Cập nhật bộ rule lợi nhuận
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">D{editDiameter}</h2>
                  <p className="app-muted mt-2 text-sm">
                    Chỉnh lại các mốc lợi nhuận của đường kính cọc này. Các cấu hình mới chỉ áp dụng cho báo giá/chứng từ về sau.
                  </p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <form action={updateDmBienLoiNhuanAction} className="space-y-5 px-6 py-6">
              <input type="hidden" name="current_duong_kinh_mm" value={editDiameter} />
              <DmBienLoiNhuanForm
                diameterOptions={diameterOptions}
                initialDiameter={editDiameter}
                initialItems={editItems}
              />
              <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                  Hủy
                </Link>
                <FormSubmitButton
                  pendingLabel="Đang cập nhật..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu cập nhật
                </FormSubmitButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function findVatPct(rows: RowData[], group: 'COC' | 'PHU_KIEN') {
  const row = rows.find((item) => String(item.loai_ap_dung ?? '').trim().toUpperCase() === group && item.is_active !== false)
  return Number(row?.vat_pct ?? 0)
}

function compareProfitRows(a: RowData, b: RowData) {
  const diameterDiff = Number(a.duong_kinh_mm ?? 0) - Number(b.duong_kinh_mm ?? 0)
  if (diameterDiff !== 0) return diameterDiff
  const minMdDiff = Number(a.min_md ?? 0) - Number(b.min_md ?? 0)
  if (minMdDiff !== 0) return minMdDiff
  const aTime = new Date(String(a.created_at ?? a.updated_at ?? '')).getTime() || 0
  const bTime = new Date(String(b.created_at ?? b.updated_at ?? '')).getTime() || 0
  return bTime - aTime
}

function buildProfitGroups(rows: RowData[], query: string) {
  const groups = new Map<
    string,
    { diameter: string; label: string; items: Array<{ min_md: string; loi_nhuan_pct: string }>; summary: string }
  >()

  for (const row of rows) {
    const diameter = String(row.duong_kinh_mm ?? '').trim()
    if (!diameter) continue
    const current = groups.get(diameter) ?? {
      diameter,
      label: `D${diameter}`,
      items: [],
      summary: '',
    }
    current.items.push({
      min_md: String(row.min_md ?? ''),
      loi_nhuan_pct: String(row.loi_nhuan_pct ?? ''),
    })
    groups.set(diameter, current)
  }

  const keyword = query.trim().toLowerCase()
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => Number(a.min_md) - Number(b.min_md)),
      summary: group.items
        .sort((a, b) => Number(a.min_md) - Number(b.min_md))
        .map((item) => `Từ ${item.min_md} md → ${item.loi_nhuan_pct}%`)
        .join(', '),
    }))
    .filter((group) => {
      if (!keyword) return true
      return `${group.label} ${group.summary}`.toLowerCase().includes(keyword)
    })
    .sort((a, b) => Number(a.diameter) - Number(b.diameter))
}

function isMissingRelationError(message?: string) {
  return /relation .* does not exist/i.test(String(message ?? '')) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(String(message ?? ''))
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
  children: React.ReactNode
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
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  )
}

function ReadOnlyCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border px-4 py-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-3 text-2xl font-bold">{value}</div>
    </div>
  )
}

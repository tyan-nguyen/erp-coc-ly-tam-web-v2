import type { ReactNode } from 'react'
import Link from 'next/link'
import { NvlListClient } from '@/components/master-data/master-data-list-extras'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { NvlCreateForm } from '@/components/master-data/nvl-create-form'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import {
  createNvlAction,
  createNvlPriceAction,
  updateNvlAction,
} from '@/lib/master-data/nvl-actions'
import { buildNvlUsageMap } from '@/lib/master-data/reference-guards'
import { deriveDisplayCode, formatNhomHangLabel } from '@/lib/master-data/nvl'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'
import {
  displayCellValue,
  pickKeyField,
  readParam,
  type RowData,
} from '@/lib/master-data/crud-utils'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/nvl'
const PAGE_SIZE = 15
const DEFAULT_GROUP_OPTIONS = ['THEP', 'NVL', 'VAT_TU_PHU', 'PHU_KIEN', 'TAI_SAN', 'CONG_CU_DUNG_CU']

export default async function NvlPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'nvl')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const group = readParam(searchParams, 'group')
  const editKey = readParam(searchParams, 'edit_key')
  const priceKey = readParam(searchParams, 'price_key')
  const historyKey = readParam(searchParams, 'history_key')
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const supabase = await createClient()
  const [{ data: nvlRows, error }, { data: priceRows }] = await Promise.all([
    supabase.from('nvl').select('*').limit(200),
    supabase.from('gia_nvl').select('gia_nvl_id, nvl_id, don_gia, dvt, created_at, updated_at').limit(400),
  ])

  const rows = (nvlRows ?? []) as RowData[]
  const prices = (priceRows ?? []) as RowData[]
  const latestPriceMap = buildLatestPriceMap(prices)
  const priceHistoryMap = buildPriceHistoryMap(prices)
  const usageMessageMap = await buildNvlUsageMap(
    supabase as never,
    rows.map((row) => String(row.nvl_id ?? '')).filter(Boolean)
  )
  const groupOptions = Array.from(
    new Set(
      [...rows.map((row) => String(row.nhom_hang ?? '')).filter(Boolean), ...DEFAULT_GROUP_OPTIONS].filter(Boolean)
    )
  )

  const keyField = pickKeyField('nvl', rows)
  const sortedRows = [...rows].sort(compareNvlRows)
  const filteredByActive = sortedRows.filter((row) => row.is_active !== false)
  const listRows = filteredByActive.map((row) => ({
    ...row,
    ma_hien_thi: deriveDisplayCode(row),
    nhom_hang_hien_thi: formatNhomHangLabel(row.nhom_hang),
    hao_hut_pct_hien_thi: formatPercentValue(row.hao_hut_pct),
    don_gia_chua_vat: latestPriceMap.get(String(row.nvl_id ?? ''))?.don_gia ?? 0,
    gia_cap_nhat_gan_nhat: latestPriceMap.get(String(row.nvl_id ?? ''))?.created_at ?? '',
    search_text: [
      deriveDisplayCode(row),
      row.ten_hang,
      formatNhomHangLabel(row.nhom_hang),
      row.dvt,
      row.hao_hut_pct,
      latestPriceMap.get(String(row.nvl_id ?? ''))?.don_gia ?? '',
    ]
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .join(' '),
  }))
  const editRow = editKey && keyField ? rows.find((row) => String(row[keyField]) === editKey) ?? null : null
  const editPrice = editRow ? latestPriceMap.get(String(editRow.nvl_id ?? '')) ?? null : null
  const priceRow = priceKey && keyField ? rows.find((row) => String(row[keyField]) === priceKey) ?? null : null
  const historyRow =
    historyKey && keyField ? rows.find((row) => String(row[keyField]) === historyKey) ?? null : null
  const historyRows = historyRow ? priceHistoryMap.get(String(historyRow.nvl_id ?? '')) ?? [] : []
  const editLockedMessage = editRow ? usageMessageMap.get(String(editRow.nvl_id ?? '')) ?? '' : ''
  const editFieldLocked = Boolean(editLockedMessage)

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Nguyên vật liệu</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Mã hàng, tên hàng, đơn vị tính và đơn giá chưa VAT được chuẩn hóa tại đây để bóc tách chọn đúng mã hàng.
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
        <form action={createNvlAction} className="mt-5 space-y-4">
          <NvlCreateForm
            groupOptions={groupOptions}
            existingItems={rows.map((row) => ({
              nvl_id: String(row.nvl_id ?? ''),
              ten_hang: String(row.ten_hang ?? ''),
              nhom_hang: String(row.nhom_hang ?? ''),
              dvt: String(row.dvt ?? ''),
              ma_hien_thi: deriveDisplayCode(row),
            }))}
          />
          <div className="flex justify-end">
            <FormSubmitButton
              pendingLabel="Đang lưu NVL..."
              className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
            >
              Lưu NVL
            </FormSubmitButton>
          </div>
        </form>
      </section>

      <section className="master-data-section">
        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">{JSON.stringify(error, null, 2)}</pre>
        ) : (
          <NvlListClient
            rows={listRows}
            keyField={keyField ?? 'nvl_id'}
            basePath={BASE_PATH}
            initialQ={q}
            initialGroup={group}
            groupOptions={groupOptions.map((item) => ({
              value: item,
              label: formatNhomHangLabel(item),
            }))}
            pageSize={PAGE_SIZE}
          />
        )}
      </section>

      {editRow && keyField ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="app-surface max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border p-0 shadow-2xl" style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 14%, var(--color-border))' }}>
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
                    Chỉnh sửa NVL
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{deriveDisplayCode(editRow)}</h2>
                  <p className="app-muted mt-2 text-sm">Cập nhật mã hàng chuẩn để bóc tách và xuất kho dùng cùng một nguồn.</p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}>
                <InfoCard label="Mã hàng" value={deriveDisplayCode(editRow)} />
                <InfoCard label="Nhóm hàng" value={formatNhomHangLabel(editRow.nhom_hang)} />
                <InfoCard label="% hao hụt" value={formatPercentValue(editRow.hao_hut_pct)} />
                <InfoCard label="Đơn giá chưa VAT" value={formatMoney(editPrice?.don_gia ?? 0)} />
              </div>

              <form action={updateNvlAction} className="mt-6 space-y-5">
                {editLockedMessage ? (
                  <div className="app-primary-soft rounded-2xl px-4 py-4 text-sm">
                    {editLockedMessage}
                    <div className="mt-2 text-xs opacity-80">
                      Chỉ được sửa Tên hàng. Nhóm hàng và ĐVT đã bị khóa để tránh lệch dữ liệu đã phát sinh.
                    </div>
                  </div>
                ) : null}
                  <input type="hidden" name="nvl_id" value={String(editRow.nvl_id ?? '')} />
                  {editFieldLocked ? (
                    <input type="hidden" name="nhom_hang" value={String(editRow.nhom_hang ?? groupOptions[0] ?? 'NVL')} />
                  ) : null}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Tên hàng (bắt buộc)" className="xl:col-span-2">
                      <input
                        type="text"
                        name="ten_hang"
                        required
                        defaultValue={String(editRow.ten_hang ?? '')}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                    <Field label="Nhóm hàng (bắt buộc)">
                      <select
                        name="nhom_hang"
                        defaultValue={String(editRow.nhom_hang ?? groupOptions[0] ?? 'NVL')}
                        disabled={editFieldLocked}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm uppercase"
                      >
                        {groupOptions.map((item) => (
                          <option key={item} value={item}>
                            {formatNhomHangLabel(item)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="ĐVT (bắt buộc)">
                      <input
                        type="text"
                        name="dvt"
                        required
                        defaultValue={String(editRow.dvt ?? '')}
                        readOnly={editFieldLocked}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                    <Field label="% hao hụt cho phép">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          name="hao_hut_pct"
                          defaultValue={String(Number(editRow.hao_hut_pct ?? 0))}
                          placeholder="Ví dụ: 3 = 3%"
                          className="app-input w-full rounded-xl px-3 py-3 text-sm"
                        />
                        <span className="app-muted text-sm font-semibold">%</span>
                      </div>
                    </Field>
                  </div>

                  <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                    <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                      Hủy
                    </Link>
                    <FormSubmitButton
                      pendingLabel="Đang cập nhật..."
                      className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                    >
                      Lưu NVL
                    </FormSubmitButton>
                  </div>
                </form>
            </div>
          </div>
        </div>
      ) : null}

      {priceRow ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div
            className="app-surface max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border p-0 shadow-2xl"
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
                    Cập nhật giá
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{deriveDisplayCode(priceRow)}</h2>
                  <p className="app-muted mt-2 text-sm">{String(priceRow.ten_hang ?? '')}</p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>
            <form action={createNvlPriceAction} className="space-y-5 px-6 py-6">
              <input type="hidden" name="nvl_id" value={String(priceRow.nvl_id ?? '')} />
              <input type="hidden" name="dvt" value={String(priceRow.dvt ?? '')} />
              <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}>
                <InfoCard label="Mã hàng" value={deriveDisplayCode(priceRow)} />
                <InfoCard label="ĐVT" value={String(priceRow.dvt ?? '-')} />
                <InfoCard label="Giá hiện hành" value={formatMoney(latestPriceMap.get(String(priceRow.nvl_id ?? ''))?.don_gia ?? 0)} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Giá mới chưa VAT (bắt buộc)">
                  <input
                    type="number"
                    step="0.001"
                    name="don_gia"
                    defaultValue={String(latestPriceMap.get(String(priceRow.nvl_id ?? ''))?.don_gia ?? 0)}
                    required
                    className="app-input w-full rounded-xl px-3 py-3 text-sm"
                  />
                </Field>
                <ReadOnlyField
                  label="Lần cập nhật gần nhất"
                  value={formatDateTime(latestPriceMap.get(String(priceRow.nvl_id ?? ''))?.created_at)}
                />
              </div>
              <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                  Hủy
                </Link>
                <FormSubmitButton
                  pendingLabel="Đang thêm giá..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu giá mới
                </FormSubmitButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {historyRow ? (
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
                    Lịch sử giá
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{deriveDisplayCode(historyRow)}</h2>
                  <p className="app-muted mt-2 text-sm">{String(historyRow.ten_hang ?? '')}</p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>
            <div className="px-6 py-6">
              {historyRows.length === 0 ? (
                <p className="app-muted text-sm">Chưa có lịch sử giá.</p>
              ) : (
                <div className="overflow-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                        {['Ngày cập nhật', 'Đơn giá chưa VAT', 'ĐVT'].map((label) => (
                          <th
                            key={label}
                            className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap"
                            style={{ backgroundColor: 'var(--color-surface)' }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row, index) => (
                        <tr
                          key={`${row.gia_nvl_id}-${index}`}
                          className="border-b"
                          style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatMoney(row.don_gia)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{displayCellValue(row.dvt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function buildLatestPriceMap(priceRows: RowData[]) {
  const map = new Map<string, { gia_nvl_id: string; don_gia: number; created_at: string }>()
  for (const row of [...priceRows].sort(compareRowsDesc)) {
    const nvlId = String(row.nvl_id ?? '')
    if (!nvlId || map.has(nvlId)) continue
    map.set(nvlId, {
      gia_nvl_id: String(row.gia_nvl_id ?? ''),
      don_gia: Number(row.don_gia ?? 0),
      created_at: String(row.created_at ?? row.updated_at ?? ''),
    })
  }
  return map
}

function buildPriceHistoryMap(priceRows: RowData[]) {
  const map = new Map<string, RowData[]>()
  for (const row of [...priceRows].sort(compareRowsDesc)) {
    const nvlId = String(row.nvl_id ?? '')
    if (!nvlId) continue
    const current = map.get(nvlId) ?? []
    current.push(row)
    map.set(nvlId, current)
  }
  return map
}

function compareNvlRows(a: RowData, b: RowData) {
  const recencyDiff = compareRowsDesc(a, b)
  if (recencyDiff !== 0) return recencyDiff

  const groupDiff = getNvlGroupRank(a) - getNvlGroupRank(b)
  if (groupDiff !== 0) return groupDiff

  const subtypeDiff = getNvlSubtypeRank(a) - getNvlSubtypeRank(b)
  if (subtypeDiff !== 0) return subtypeDiff

  const nameDiff = String(a.ten_hang ?? '').localeCompare(String(b.ten_hang ?? ''))
  if (nameDiff !== 0) return nameDiff

  return 0
}

function getNvlGroupRank(row: RowData) {
  const nhomHang = String(row.nhom_hang ?? '').trim().toUpperCase()
  if (nhomHang === 'THEP') return 0
  if (nhomHang === 'NVL') return 1
  if (nhomHang === 'VAT_TU_PHU') return 2
  if (nhomHang === 'PHU_KIEN') return 3
  if (nhomHang === 'TAI_SAN') return 4
  if (nhomHang === 'CONG_CU_DUNG_CU') return 5
  return 9
}

function getNvlSubtypeRank(row: RowData) {
  const nhomHang = String(row.nhom_hang ?? '').trim().toUpperCase()
  if (nhomHang === 'THEP') {
    const tenHang = String(row.ten_hang ?? '').trim().toUpperCase()
    if (tenHang.startsWith('THÉP PC') || tenHang.startsWith('THEP PC')) return 0
    if (tenHang.startsWith('THÉP ĐAI') || tenHang.startsWith('THEP DAI')) return 1
    if (tenHang.startsWith('THÉP BUỘC') || tenHang.startsWith('THEP BUOC')) return 2
    return 9
  }

  if (nhomHang === 'PHU_KIEN') {
    const tenHang = String(row.ten_hang ?? '').trim().toUpperCase()
    if (tenHang.startsWith('MẶT BÍCH') || tenHang.startsWith('MAT BICH')) return 0
    if (tenHang.startsWith('MĂNG XÔNG') || tenHang.startsWith('MANG XONG')) return 1
    if (tenHang.startsWith('MŨI CỌC') || tenHang.startsWith('MUI COC')) return 2
    if (tenHang.startsWith('TẤM VUÔNG') || tenHang.startsWith('TAM VUONG')) return 3
    return 9
  }

  return 0
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
  group,
  editKey,
  page,
}: {
  q: string
  group: string
  editKey: string
  page: number
}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (group) params.set('group', group)
  if (editKey) params.set('edit_key', editKey)
  params.set('page', String(page))
  const query = params.toString()
  return query ? `${BASE_PATH}?${query}` : BASE_PATH
}

function buildPageNumbers(totalPages: number, currentPage: number) {
  const numbers = new Set<number>()
  numbers.add(1)
  numbers.add(totalPages)
  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= totalPages) numbers.add(page)
  }
  return Array.from(numbers).sort((a, b) => a - b)
}

function PaginationLink({
  href,
  disabled,
  active = false,
  children,
}: {
  href: string
  disabled: boolean
  active?: boolean
  children: ReactNode
}) {
  if (disabled && !active) {
    return (
      <span className="rounded-xl border px-4 py-2 text-sm font-semibold opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
        {children}
      </span>
    )
  }

  if (active) {
    return (
      <span className="rounded-xl px-4 py-2 text-sm font-semibold" style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>
        {children}
      </span>
    )
  }

  return (
    <Link href={href} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
      {children}
    </Link>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <p className="app-muted text-xs font-semibold uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={className}>
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  )
}

function formatMoney(value: unknown) {
  const numberValue = Number(value ?? 0)
  if (!Number.isFinite(numberValue)) return '0'
  return new Intl.NumberFormat('vi-VN').format(numberValue)
}

function formatDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function formatPercentValue(value: unknown) {
  const numberValue = Number(value ?? 0)
  if (!Number.isFinite(numberValue)) return '0%'
  return `${new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numberValue)}%`
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <div className="app-input rounded-xl px-3 py-3 text-sm">{value || '-'}</div>
    </label>
  )
}

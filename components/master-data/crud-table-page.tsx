import Link from 'next/link'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { createClient } from '@/lib/supabase/server'
import {
  createMasterDataAction,
  softDeleteMasterDataAction,
  updateMasterDataAction,
} from '@/lib/master-data/actions'
import {
  displayCellValue,
  filterRowsByQuery,
  formatColumnLabel,
  hasSoftDeleteColumns,
  pickKeyField,
  readParam,
  safeStringify,
  shouldHideColumn,
  type RowData,
} from '@/lib/master-data/crud-utils'
import type { CrudTableConfig } from '@/lib/master-data/table-config'

type SearchParams = Record<string, string | string[] | undefined>

type CrudTablePageProps = {
  config: CrudTableConfig
  searchParams: SearchParams
}

const PAGE_SIZE = 15

export async function CrudTablePage({ config, searchParams }: CrudTablePageProps) {
  const q = readParam(searchParams, 'q')
  const showInactive = readParam(searchParams, 'show_inactive') === '1'
  const editKey = readParam(searchParams, 'edit_key')
  const currentPage = Math.max(1, Number.parseInt(readParam(searchParams, 'page') || '1', 10) || 1)
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const supabase = await createClient()
  const { data, error } = await supabase.from(config.tableName).select('*').limit(200)
  const createTemplate = await resolveCreateTemplate(supabase, config)

  const sourceRows = (data ?? []) as RowData[]
  const keyField = pickKeyField(config.tableName, sourceRows)
  const canSoftDelete = hasSoftDeleteColumns(sourceRows)
  const sortedRows = [...sourceRows].sort(compareRowsDesc)
  const filteredByActive =
    canSoftDelete && !showInactive
      ? sortedRows.filter((row) => row.is_active !== false)
      : sortedRows
  const rows = filterRowsByQuery(filteredByActive, q)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const columns = (
    rows[0] ? Object.keys(rows[0]) : sortedRows[0] ? Object.keys(sortedRows[0]) : []
  ).filter((column) => !shouldHideColumn(column))

  const editRow =
    editKey && keyField
      ? sortedRows.find((row) => String(row[keyField]) === editKey) ?? null
      : null

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">{config.title}</h1>
        <p className="app-muted mt-2 text-sm">{config.description}</p>
      </section>

      {msg ? <section className="master-data-section master-data-message master-data-message-success">{msg}</section> : null}
      {err ? <section className="master-data-section master-data-message master-data-message-error">{err}</section> : null}

      <section className="master-data-section">
        <h2 className="text-lg font-semibold">Tạo mới</h2>
        <p className="app-muted mt-2 text-sm">
          Nhập JSON object đúng cột trong `public.{config.tableName}`.
        </p>
        <form action={createMasterDataAction} className="mt-4 space-y-3">
          <input type="hidden" name="table_name" value={config.tableName} />
          <input type="hidden" name="base_path" value={config.basePath} />
          <textarea
            name="payload"
            required
            defaultValue={JSON.stringify(createTemplate, null, 2)}
            className="app-input h-52 w-full rounded-xl p-3 font-mono text-sm"
          />
          {config.requiredCreateFields?.length ? (
            <p className="app-muted text-xs">Bắt buộc: {config.requiredCreateFields.join(', ')}</p>
          ) : null}
          <FormSubmitButton
            pendingLabel="Đang tạo..."
            className="app-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
          >
            Tạo bản ghi
          </FormSubmitButton>
        </form>
      </section>

      <section className="master-data-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Danh sách</h2>
            <p className="app-muted mt-2 text-sm">
              Số dòng: {rows.length} / {sourceRows.length}
            </p>
          </div>
          <form className="flex flex-wrap items-center gap-3">
            <input
              name="q"
              defaultValue={q}
              placeholder="Nhập từ khóa..."
              className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
            />
            {canSoftDelete ? (
              <label className="app-muted inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="show_inactive" value="1" defaultChecked={showInactive} />
                Hiển thị đã xóa
              </label>
            ) : null}
            <input type="hidden" name="page" value="1" />
            <button type="submit" className="app-primary rounded-xl px-4 py-2 text-sm font-semibold transition">
              Lọc
            </button>
          </form>
        </div>

        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">
            {JSON.stringify(error, null, 2)}
          </pre>
        ) : rows.length === 0 ? (
          <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
        ) : (
          <div className="master-data-table-frame">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr style={{ borderColor: 'var(--color-border)' }} className="border-b">
                  {columns.map((column) => (
                    <th
                      key={column}
                      className="sticky top-0 z-10 px-3 py-3 font-semibold"
                      style={{ backgroundColor: 'var(--color-surface)' }}
                    >
                      {formatColumnLabel(column)}
                    </th>
                  ))}
                  {keyField ? (
                    <th
                      className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap"
                      style={{ backgroundColor: 'var(--color-surface)' }}
                    >
                      Thao tác
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => (
                  <tr
                    key={`${index}-${safeStringify(row[keyField ?? ''])}`}
                    className="border-b align-top"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                  >
                    {columns.map((column) => (
                      <td key={`${index}-${column}`} className="px-3 py-2">
                        {displayCellValue(row[column])}
                      </td>
                    ))}
                    {keyField ? (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <Link
                            href={`${config.basePath}?edit_key=${encodeURIComponent(String(row[keyField]))}`}
                            className="app-outline inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium transition"
                          >
                            Sửa
                          </Link>
                          {canSoftDelete ? (
                            <form action={softDeleteMasterDataAction}>
                              <input type="hidden" name="table_name" value={config.tableName} />
                              <input type="hidden" name="base_path" value={config.basePath} />
                              <input type="hidden" name="key_field" value={keyField} />
                              <input type="hidden" name="key_value" value={safeStringify(row[keyField])} />
                              <button
                                type="submit"
                                className="app-accent-soft inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium transition"
                              >
                                Xóa
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > PAGE_SIZE ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
            <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
            <div className="flex flex-wrap items-center gap-2">
              <PaginationLink
                disabled={safePage <= 1}
                href={buildPageHref({ basePath: config.basePath, q, showInactive, editKey, page: safePage - 1 })}
              >
                ‹
              </PaginationLink>
              {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
                <PaginationLink
                  key={pageNumber}
                  disabled={pageNumber === safePage}
                  active={pageNumber === safePage}
                  href={buildPageHref({ basePath: config.basePath, q, showInactive, editKey, page: pageNumber })}
                >
                  {pageNumber}
                </PaginationLink>
              ))}
              <PaginationLink
                disabled={safePage >= totalPages}
                href={buildPageHref({ basePath: config.basePath, q, showInactive, editKey, page: safePage + 1 })}
              >
                ›
              </PaginationLink>
            </div>
          </div>
        ) : null}
      </section>

      {editRow && keyField ? (
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
                  <p
                    className="text-sm font-semibold tracking-[0.16em] uppercase"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Chỉnh sửa
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{String(editRow[keyField])}</h2>
                </div>
                <Link href={config.basePath} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <form action={updateMasterDataAction} className="space-y-4 px-6 py-6">
              <input type="hidden" name="table_name" value={config.tableName} />
              <input type="hidden" name="base_path" value={config.basePath} />
              <input type="hidden" name="key_field" value={keyField} />
              <input type="hidden" name="key_value" value={safeStringify(editRow[keyField])} />
              <textarea
                name="payload"
                required
                defaultValue={JSON.stringify(editRow, null, 2)}
                className="app-input h-72 w-full rounded-xl p-3 font-mono text-sm"
              />
              <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                <Link href={config.basePath} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Hủy
                </Link>
                <FormSubmitButton
                  pendingLabel="Đang lưu..."
                  className="app-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu thay đổi
                </FormSubmitButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

async function resolveCreateTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  config: CrudTableConfig
) {
  const payload: RowData = { ...config.createTemplate }

  if (config.requiredCreateFields?.includes('nvl_id') && !payload.nvl_id) {
    const { data } = await supabase.from('nvl').select('nvl_id').limit(1)
    if (data?.[0]?.nvl_id) {
      payload.nvl_id = data[0].nvl_id
    }
  }

  if (config.requiredCreateFields?.includes('kh_id') && !payload.kh_id) {
    const { data } = await supabase.from('dm_kh').select('kh_id').limit(1)
    if (data?.[0]?.kh_id) {
      payload.kh_id = data[0].kh_id
    }
  }

  return payload
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

function buildPageNumbers(totalPages: number, currentPage: number) {
  const numbers = new Set<number>()
  numbers.add(1)
  numbers.add(totalPages)
  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= totalPages) numbers.add(page)
  }
  return Array.from(numbers).sort((a, b) => a - b)
}

function buildPageHref({
  basePath,
  q,
  showInactive,
  editKey,
  page,
}: {
  basePath: string
  q: string
  showInactive: boolean
  editKey: string
  page: number
}) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (showInactive) params.set('show_inactive', '1')
  if (editKey) params.set('edit_key', editKey)
  params.set('page', String(page))
  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
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
  children: React.ReactNode
}) {
  if (disabled && !active) {
    return (
      <span
        className="rounded-xl border px-4 py-2 text-sm font-semibold opacity-50"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        {children}
      </span>
    )
  }

  if (active) {
    return (
      <span
        className="rounded-xl px-4 py-2 text-sm font-semibold"
        style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}
      >
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

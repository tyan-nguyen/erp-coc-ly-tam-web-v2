'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { bulkSoftDeleteMasterDataAction } from '@/lib/master-data/actions'
import { bulkDeactivateWarehouseLocationAction } from '@/lib/master-data/warehouse-location-actions'
import { formatWarehouseLocationGroup } from '@/lib/master-data/warehouse-location-shared'
import { filterRowsByQuery, safeStringify, type RowData } from '@/lib/master-data/crud-utils'

const FILTER_DEBOUNCE_MS = 180

function buildHref(basePath: string, params: URLSearchParams) {
  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function readRowTime(row: RowData) {
  const raw = row.created_at ?? row.updated_at ?? null
  if (!raw) return 0
  const time = new Date(String(raw)).getTime()
  return Number.isNaN(time) ? 0 : time
}

function readRowCode(row: RowData) {
  return String(
    row.ma_kh ??
      row.ma_da ??
      row.ma_ncc ??
      row.id ??
      ''
  )
}

function compareRowsDesc(a: RowData, b: RowData) {
  const aTime = readRowTime(a)
  const bTime = readRowTime(b)
  if (aTime !== bTime) {
    return bTime - aTime
  }
  return readRowCode(b).localeCompare(readRowCode(a))
}

function buildPageNumbers(totalPages: number, currentPage: number) {
  const numbers = new Set<number>()
  numbers.add(1)
  numbers.add(totalPages)

  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= totalPages) {
      numbers.add(page)
    }
  }

  return Array.from(numbers).sort((a, b) => a - b)
}

function PaginationButton({
  disabled,
  active = false,
  onClick,
  children,
}: {
  disabled: boolean
  active?: boolean
  onClick: () => void
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
    <button type="button" onClick={onClick} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
      {children}
    </button>
  )
}

function SelectAllHeaderCheckbox({ scope }: { scope: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const updateState = () => {
      const items = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[data-select-scope="${scope}"][data-select-item="true"]`)
      )
      const checkedCount = items.filter((item) => item.checked).length
      const allChecked = items.length > 0 && checkedCount === items.length
      const partiallyChecked = checkedCount > 0 && checkedCount < items.length

      if (inputRef.current) {
        inputRef.current.checked = allChecked
        inputRef.current.indeterminate = partiallyChecked
      }
    }

    updateState()
    document.addEventListener('change', updateState)
    return () => document.removeEventListener('change', updateState)
  }, [scope])

  return (
    <input
      ref={inputRef}
      type="checkbox"
      aria-label="Chọn tất cả"
      onChange={(event) => {
        const items = document.querySelectorAll<HTMLInputElement>(
          `input[data-select-scope="${scope}"][data-select-item="true"]`
        )
        items.forEach((item) => {
          item.checked = event.target.checked
        })
        event.target.indeterminate = false
      }}
    />
  )
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [delayMs, value])

  return debouncedValue
}

function useLocalFilterState({
  rows,
  basePath,
  initialQ,
  initialShowInactive,
  pageSize,
}: {
  rows: RowData[]
  basePath: string
  initialQ: string
  initialShowInactive: boolean
  pageSize: number
}) {
  const [q, setQ] = useState(initialQ)
  const [showInactive, setShowInactive] = useState(initialShowInactive)
  const [page, setPage] = useState(1)
  const debouncedQ = useDebouncedValue(q, FILTER_DEBOUNCE_MS)

  const sortedRows = useMemo(() => [...rows].sort(compareRowsDesc), [rows])

  const filteredRows = useMemo(() => {
    const activeRows = showInactive ? sortedRows : sortedRows.filter((row) => row.is_active !== false)
    return filterRowsByQuery(activeRows, debouncedQ)
  }, [debouncedQ, showInactive, sortedRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (debouncedQ.trim()) {
      params.set('q', debouncedQ.trim())
    } else {
      params.delete('q')
    }
    if (showInactive) {
      params.set('show_inactive', '1')
    } else {
      params.delete('show_inactive')
    }
    params.set('page', String(safePage))
    const nextHref = buildHref(basePath, params)
    const currentHref = `${window.location.pathname}${window.location.search}`
    if (nextHref !== currentHref) {
      window.history.replaceState({}, '', nextHref)
    }
  }, [basePath, debouncedQ, safePage, showInactive])

  return {
    q,
    setQ,
    showInactive,
    setShowInactive,
    filteredRows,
    totalPages,
    safePage,
    pagedRows,
    setPage,
  }
}

const NHOM_KH_LABELS: Record<string, string> = {
  TIEM_NANG: 'Tiềm năng',
  VANG_LAI: 'Vãng lai',
}

function getKhHeaderClassName(column: string) {
  if (column === 'ten_kh') return 'min-w-[280px] whitespace-nowrap'
  if (column === 'email') return 'min-w-[220px] whitespace-nowrap'
  if (column === 'ma_kh') return 'whitespace-nowrap'
  return ''
}

function getKhCellClassName(column: string) {
  if (column === 'ten_kh') return 'min-w-[280px] whitespace-nowrap'
  if (column === 'email') return 'min-w-[220px] whitespace-nowrap'
  if (column === 'ma_kh') return 'whitespace-nowrap'
  return ''
}

function formatKhCell(column: string, value: unknown) {
  if (column === 'nhom_kh' && typeof value === 'string') {
    return NHOM_KH_LABELS[value] ?? value
  }
  return displayCell(value)
}

function formatLoaiNccLabel(value: unknown) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized === 'PHU_KIEN') return 'Phụ kiện'
  if (normalized === 'NVL') return 'NVL'
  if (normalized === 'TAI_SAN') return 'Tài sản'
  if (normalized === 'CCDC') return 'Công cụ dụng cụ'
  if (normalized === 'VAN_CHUYEN') return 'Vận chuyển'
  return displayCell(value)
}

export function DmKhListClient({
  rows,
  columns,
  keyField,
  basePath,
  initialQ,
  initialShowInactive,
  pageSize,
  contact,
  columnLabels,
}: {
  rows: RowData[]
  columns: string[]
  keyField: string
  basePath: string
  initialQ: string
  initialShowInactive: boolean
  pageSize: number
  contact: string
  columnLabels: Record<string, string>
}) {
  const selectScope = useId()
  const { q, setQ, showInactive, setShowInactive, filteredRows, totalPages, safePage, pagedRows, setPage } =
    useLocalFilterState({ rows, basePath, initialQ, initialShowInactive, pageSize })

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách khách hàng</h2>
          <p className="app-muted mt-2 text-sm">Số dòng: {filteredRows.length} / {rows.length}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
            placeholder="Tìm theo mã, khách hàng, liên hệ..."
            className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
          />
          <label className="app-muted inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => {
                setShowInactive(event.target.checked)
                setPage(1)
              }}
            />
            Hiển thị đã xóa
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <form action={bulkSoftDeleteMasterDataAction} className="mt-4 space-y-4">
          <input type="hidden" name="table_name" value="dm_kh" />
          <input type="hidden" name="base_path" value={basePath} />
          <input type="hidden" name="key_field" value={keyField} />
          <input type="hidden" name="contact" value={contact} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-muted text-sm">Chọn nhiều dòng rồi dùng một nút xóa chung. Bấm trực tiếp vào mã hoặc tên để mở popup sửa.</p>
            <button type="submit" className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition">
              Xóa các dòng đã chọn
            </button>
          </div>
          <div className="max-h-[560px] overflow-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th
                    className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap"
                    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                  >
                    <SelectAllHeaderCheckbox scope={selectScope} />
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column}
                      className={`sticky top-0 z-10 px-3 py-3 font-semibold ${getKhHeaderClassName(column)}`}
                      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                    >
                      {columnLabels[column] ?? column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const editHref = buildHref(
                    basePath,
                    new URLSearchParams({
                      ...(q.trim() ? { q: q.trim() } : {}),
                      ...(showInactive ? { show_inactive: '1' } : {}),
                      ...(contact ? { contact } : {}),
                      page: String(safePage),
                      edit_key: String(row[keyField]),
                    })
                  )

                  return (
                    <tr
                      key={`${index}-${safeStringify(row[keyField] ?? row.ma_kh)}`}
                      className="border-b align-top"
                      style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                    >
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          name="key_value"
                          value={safeStringify(row[keyField])}
                          data-select-scope={selectScope}
                          data-select-item="true"
                        />
                      </td>
                      {columns.map((column) => {
                        const isLinkColumn = column === 'ma_kh' || column === 'ten_kh'
                        const cellContent = formatKhCell(column, row[column])
                        return (
                          <td key={`${index}-${column}`} className={`px-3 py-2 ${getKhCellClassName(column)}`}>
                            {isLinkColumn ? (
                              <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                                {cellContent}
                              </Link>
                            ) : (
                              cellContent
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              ‹
            </PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              ›
            </PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function DmNccListClient({
  rows,
  keyField,
  basePath,
  initialQ,
  initialShowInactive,
  pageSize,
  phoneField,
  emailField,
  contactNameField,
  addressField,
  noteField,
}: {
  rows: RowData[]
  keyField: string
  basePath: string
  initialQ: string
  initialShowInactive: boolean
  pageSize: number
  phoneField: string
  emailField: string
  contactNameField: string
  addressField: string
  noteField: string
}) {
  const selectScope = useId()
  const { q, setQ, showInactive, setShowInactive, filteredRows, totalPages, safePage, pagedRows, setPage } =
    useLocalFilterState({ rows, basePath, initialQ, initialShowInactive, pageSize })

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách nhà cung cấp</h2>
          <p className="app-muted mt-2 text-sm">Số dòng: {filteredRows.length} / {rows.length}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
            placeholder="Tìm theo mã, tên, liên hệ..."
            className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
          />
          <label className="app-muted inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => {
                setShowInactive(event.target.checked)
                setPage(1)
              }}
            />
            Hiển thị đã xóa
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <form action={bulkSoftDeleteMasterDataAction} className="mt-4 space-y-4">
          <input type="hidden" name="table_name" value="dm_ncc" />
          <input type="hidden" name="base_path" value={basePath} />
          <input type="hidden" name="key_field" value={keyField} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-muted text-sm">Chọn nhiều dòng rồi xóa chung. Bấm vào mã hoặc tên nhà cung cấp để mở popup sửa.</p>
            <button type="submit" className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition">
              Xóa các dòng đã chọn
            </button>
          </div>
          <div className="max-h-[560px] overflow-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <SelectAllHeaderCheckbox scope={selectScope} />
                  </th>
                  {['Mã nhà cung cấp', 'Tên nhà cung cấp', 'Loại nhà cung cấp', 'Người liên hệ', 'SĐT', 'Email', 'Địa chỉ', 'Ghi chú'].map((label) => (
                    <th key={label} className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const editHref = buildHref(
                    basePath,
                    new URLSearchParams({
                      ...(q.trim() ? { q: q.trim() } : {}),
                      ...(showInactive ? { show_inactive: '1' } : {}),
                      page: String(safePage),
                      edit_key: String(row[keyField]),
                    })
                  )

                  return (
                    <tr
                      key={`${index}-${safeStringify(row[keyField] ?? row.ma_ncc)}`}
                      className="border-b align-top"
                      style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                    >
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          name="key_value"
                          value={safeStringify(row[keyField])}
                          data-select-scope={selectScope}
                          data-select-item="true"
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.ma_ncc)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 min-w-[240px] whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.ten_ncc)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatLoaiNccLabel(row.loai_ncc)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(contactNameField ? row[contactNameField] : null)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(phoneField ? row[phoneField] : null)}</td>
                      <td className="px-3 py-2 min-w-[220px] whitespace-nowrap">{displayCell(emailField ? row[emailField] : null)}</td>
                      <td className="px-3 py-2 min-w-[200px]">{displayCell(addressField ? row[addressField] : null)}</td>
                      <td className="px-3 py-2 min-w-[180px]">{displayCell(noteField ? row[noteField] : null)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              ‹
            </PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              ›
            </PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function DmDuanListClient({
  rows,
  keyField,
  basePath,
  initialQ,
  initialShowInactive,
  pageSize,
  customerField,
  addressField,
  areaField,
  noteField,
}: {
  rows: RowData[]
  keyField: string
  basePath: string
  initialQ: string
  initialShowInactive: boolean
  pageSize: number
  customerField: string
  addressField: string
  areaField: string
  noteField: string
}) {
  const selectScope = useId()
  const { q, setQ, showInactive, setShowInactive, filteredRows, totalPages, safePage, pagedRows, setPage } =
    useLocalFilterState({ rows, basePath, initialQ, initialShowInactive, pageSize })

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách dự án</h2>
          <p className="app-muted mt-2 text-sm">Số dòng: {filteredRows.length} / {rows.length}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
            placeholder="Tìm theo mã dự án, tên dự án, khách hàng..."
            className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
          />
          <label className="app-muted inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => {
                setShowInactive(event.target.checked)
                setPage(1)
              }}
            />
            Hiển thị đã xóa
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <form action={bulkSoftDeleteMasterDataAction} className="mt-4 space-y-4">
          <input type="hidden" name="table_name" value="dm_duan" />
          <input type="hidden" name="base_path" value={basePath} />
          <input type="hidden" name="key_field" value={keyField} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-muted text-sm">Chọn nhiều dòng rồi xóa một lần. Bấm trực tiếp vào mã hoặc tên dự án để mở popup sửa.</p>
            <button type="submit" className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition">
              Xóa các dòng đã chọn
            </button>
          </div>
          <div className="max-h-[560px] overflow-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <SelectAllHeaderCheckbox scope={selectScope} />
                  </th>
                  {['Mã dự án', 'Tên dự án', 'Khách hàng', 'Địa chỉ công trình', 'Khu vực', 'Ghi chú'].map((label) => (
                    <th key={label} className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const editHref = buildHref(
                    basePath,
                    new URLSearchParams({
                      ...(q.trim() ? { q: q.trim() } : {}),
                      ...(showInactive ? { show_inactive: '1' } : {}),
                      page: String(safePage),
                      edit_key: String(row[keyField]),
                    })
                  )

                  return (
                    <tr
                      key={`${index}-${safeStringify(row[keyField] ?? row.ma_da)}`}
                      className="border-b align-top"
                      style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                    >
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          name="key_value"
                          value={safeStringify(row[keyField])}
                          data-select-scope={selectScope}
                          data-select-item="true"
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.ma_da)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 min-w-[260px] whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.ten_da)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 min-w-[220px] whitespace-nowrap">
                        {displayCell(row[customerField])}
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">{displayCell(row[addressField])}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row[areaField])}</td>
                      <td className="px-3 py-2 min-w-[180px]">{displayCell(row[noteField])}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              ‹
            </PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              ›
            </PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function WarehouseLocationListClient({
  rows,
  keyField,
  basePath,
  initialQ,
  initialShowInactive,
  pageSize,
}: {
  rows: RowData[]
  keyField: string
  basePath: string
  initialQ: string
  initialShowInactive: boolean
  pageSize: number
}) {
  const selectScope = useId()
  const { q, setQ, showInactive, setShowInactive, filteredRows, totalPages, safePage, pagedRows, setPage } =
    useLocalFilterState({ rows, basePath, initialQ, initialShowInactive, pageSize })

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách bãi / khu vực tồn</h2>
          <p className="app-muted mt-2 text-sm">Số dòng: {filteredRows.length} / {rows.length}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
            placeholder="Tìm theo mã bãi, tên bãi, bãi cha..."
            className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
          />
          <label className="app-muted inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => {
                setShowInactive(event.target.checked)
                setPage(1)
              }}
            />
            Hiển thị đã ngừng dùng
          </label>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <form action={bulkDeactivateWarehouseLocationAction} className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-muted text-sm">
              Chọn nhiều dòng rồi ngừng sử dụng một lần. Bấm vào mã hoặc tên bãi để mở popup sửa.
            </p>
            <button type="submit" className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition">
              Ngừng dùng các dòng đã chọn
            </button>
          </div>
          <div className="max-h-[560px] overflow-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <SelectAllHeaderCheckbox scope={selectScope} />
                  </th>
                  {['Mã bãi', 'Tên bãi', 'Nhóm', 'Bãi cha', 'Đang chứa', 'Trạng thái'].map((label) => (
                    <th key={label} className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const editHref = buildHref(
                    basePath,
                    new URLSearchParams({
                      ...(q.trim() ? { q: q.trim() } : {}),
                      ...(showInactive ? { show_inactive: '1' } : {}),
                      page: String(safePage),
                      edit_key: String(row[keyField]),
                    })
                  )

                  return (
                    <tr
                      key={`${index}-${safeStringify(row[keyField] ?? row.location_code)}`}
                      className="border-b align-top"
                      style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                    >
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          name="key_value"
                          value={safeStringify(row[keyField])}
                          data-select-scope={selectScope}
                          data-select-item="true"
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.location_code)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 min-w-[240px] whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.location_name)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatWarehouseLocationGroup(row)}</td>
                      <td className="px-3 py-2 min-w-[220px] whitespace-nowrap">{displayCell(row.parent_label)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.current_serial_count)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.is_active === false ? 'Ngừng dùng' : 'Đang dùng'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              ‹
            </PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
              ›
            </PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

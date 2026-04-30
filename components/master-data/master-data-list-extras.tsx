'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { bulkDeleteDmCocTemplateAction } from '@/lib/master-data/dm-coc-template-actions'
import { bulkDeleteNvlAction } from '@/lib/master-data/nvl-actions'
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

function buildPageNumbers(totalPages: number, currentPage: number) {
  const numbers = new Set<number>()
  numbers.add(1)
  numbers.add(totalPages)
  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= totalPages) numbers.add(page)
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
  basePath,
  initialQ,
  pageSize,
}: {
  basePath: string
  initialQ: string
  pageSize: number
}) {
  const [q, setQ] = useState(initialQ)
  const [page, setPage] = useState(1)
  const debouncedQ = useDebouncedValue(q, FILTER_DEBOUNCE_MS)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (debouncedQ.trim()) {
      params.set('q', debouncedQ.trim())
    } else {
      params.delete('q')
    }
    params.set('page', String(page))
    const nextHref = buildHref(basePath, params)
    const currentHref = `${window.location.pathname}${window.location.search}`
    if (nextHref !== currentHref) {
      window.history.replaceState({}, '', nextHref)
    }
  }, [basePath, debouncedQ, page])

  return { q, setQ, debouncedQ, page, setPage, pageSize }
}

export function NvlListClient({
  rows,
  keyField,
  basePath,
  initialQ,
  initialGroup,
  groupOptions,
  pageSize,
}: {
  rows: RowData[]
  keyField: string
  basePath: string
  initialQ: string
  initialGroup: string
  groupOptions: Array<{ value: string; label: string }>
  pageSize: number
}) {
  const selectScope = useId()
  const [q, setQ] = useState(initialQ)
  const [group, setGroup] = useState(initialGroup)
  const [page, setPage] = useState(1)
  const debouncedQ = useDebouncedValue(q, FILTER_DEBOUNCE_MS)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (debouncedQ.trim()) {
      params.set('q', debouncedQ.trim())
    } else {
      params.delete('q')
    }
    if (group.trim()) {
      params.set('group', group.trim())
    } else {
      params.delete('group')
    }
    params.set('page', String(page))
    const nextHref = buildHref(basePath, params)
    const currentHref = `${window.location.pathname}${window.location.search}`
    if (nextHref !== currentHref) {
      window.history.replaceState({}, '', nextHref)
    }
  }, [basePath, debouncedQ, group, page])

  const filteredRows = useMemo(() => {
    const filteredByGroup = group
      ? rows.filter((row) => String(row.nhom_hang ?? '').trim().toUpperCase() === group.trim().toUpperCase())
      : rows
    return filterRowsByQuery(filteredByGroup, debouncedQ)
  }, [debouncedQ, group, rows])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách NVL</h2>
          <p className="app-muted mt-2 text-sm">Số dòng: {filteredRows.length} / {rows.length}</p>
        </div>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
          placeholder="Tìm theo mã hàng, tên hàng..."
          className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
        />
        <select
          value={group}
          onChange={(event) => {
            setGroup(event.target.value)
            setPage(1)
          }}
          className="app-input w-full rounded-xl px-3 py-2 text-sm md:w-auto"
        >
          <option value="">-- Tất cả nhóm --</option>
          {groupOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <form action={bulkDeleteNvlAction} className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-muted text-sm">Chọn nhiều dòng rồi xóa chung. Bấm trực tiếp vào mã hoặc tên hàng để mở popup sửa.</p>
            <button type="submit" className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition">
              Xóa các dòng đã chọn
            </button>
          </div>
          <div className="master-data-table-frame">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <SelectAllHeaderCheckbox scope={selectScope} />
                  </th>
                  {['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'ĐVT', '% hao hụt', 'Đơn giá chưa VAT', 'Giá'].map((label) => (
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
                      page: String(safePage),
                      edit_key: String(row[keyField]),
                    })
                  )
                  const priceHref = buildHref(
                    basePath,
                    new URLSearchParams({
                      ...(q.trim() ? { q: q.trim() } : {}),
                      page: String(safePage),
                      price_key: String(row[keyField]),
                    })
                  )
                  const historyHref = buildHref(
                    basePath,
                    new URLSearchParams({
                      ...(q.trim() ? { q: q.trim() } : {}),
                      page: String(safePage),
                      history_key: String(row[keyField]),
                    })
                  )

                  return (
                    <tr
                      key={`${index}-${safeStringify(row[keyField] ?? row.nvl_id)}`}
                      className="border-b align-top"
                      style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                    >
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="checkbox"
                          name="nvl_id"
                          value={String(row.nvl_id ?? '')}
                          data-select-scope={selectScope}
                          data-select-item="true"
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.ma_hien_thi)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 min-w-[260px] whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.ten_hang)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.nhom_hang_hien_thi ?? row.nhom_hang)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.dvt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.hao_hut_pct_hien_thi ?? row.hao_hut_pct)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatMoney(row.don_gia_chua_vat)}</td>
                      <td className="px-3 py-2 min-w-[180px]">
                        <div className="text-xs font-medium">{formatDateTime(row.gia_cap_nhat_gan_nhat)}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                          <Link href={priceHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                            Cập nhật giá
                          </Link>
                          <Link href={historyHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                            Lịch sử giá
                          </Link>
                        </div>
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
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function DmCocTemplateListClient({
  rows,
  keyField,
  basePath,
  initialQ,
  pageSize,
}: {
  rows: RowData[]
  keyField: string
  basePath: string
  initialQ: string
  pageSize: number
}) {
  const selectScope = useId()
  const { q, setQ, page, setPage } = useLocalFilterState({ basePath, initialQ, pageSize })
  const filteredRows = useMemo(() => filterRowsByQuery(rows, q), [rows, q])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách loại cọc mẫu</h2>
          <p className="app-muted mt-2 text-sm">Số dòng: {filteredRows.length} / {rows.length}</p>
        </div>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
          placeholder="Tìm theo loại cọc, thép, phụ kiện..."
          className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
        />
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <form action={bulkDeleteDmCocTemplateAction} className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="app-muted text-sm">Chọn nhiều dòng rồi xóa chung. Bấm mã hoặc loại cọc để mở popup xem/sửa.</p>
            <button type="submit" className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition">
              Xóa các dòng đã chọn
            </button>
          </div>
          <div className="master-data-table-frame">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <SelectAllHeaderCheckbox scope={selectScope} />
                  </th>
                  {['Mã', 'Nguồn mẫu', 'Loại cọc', 'ĐK ngoài', 'Thành cọc', 'Mác BT', 'Thép PC', 'Số thanh PC', 'Thép đai', 'Đơn/kép', 'Thép buộc', 'A1', 'A2', 'A3', 'PctA1', 'PctA2', 'PctA3', 'Mặt bích', 'Măng xông', 'Táp vuông', 'Mũi cọc', 'Kg/md'].map((label) => (
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
                      page: String(safePage),
                      edit_key: String(row[keyField]),
                    })
                  )

                  return (
                    <tr
                      key={`${index}-${safeStringify(row[keyField] ?? row.template_id)}`}
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
                          {displayCell(row.ma_hien_thi)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.nguon_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                          {displayCell(row.loai_coc)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.do_ngoai)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.chieu_day)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.mac_be_tong)}</td>
                      <td className="px-3 py-2 min-w-[180px] whitespace-nowrap">{displayCell(row.steel_pc_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.pc_nos_hien_thi)}</td>
                      <td className="px-3 py-2 min-w-[130px] whitespace-nowrap">{displayCell(row.steel_dai_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.don_kep_hien_thi)}</td>
                      <td className="px-3 py-2 min-w-[130px] whitespace-nowrap">{displayCell(row.steel_buoc_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.a1_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.a2_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.a3_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.p1_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.p2_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.p3_hien_thi)}</td>
                      <td className="px-3 py-2 min-w-[220px]">{displayCell(row.mat_bich_hien_thi)}</td>
                      <td className="px-3 py-2 min-w-[180px]">{displayCell(row.mang_xong_hien_thi)}</td>
                      <td className="px-3 py-2 min-w-[180px]">{displayCell(row.tap_hien_thi)}</td>
                      <td className="px-3 py-2 min-w-[180px]">{displayCell(row.mui_coc_hien_thi)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{displayCell(row.khoi_luong_kg_md_hien_thi)}</td>
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
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

type AuxiliaryGroupRow = {
  group: string
  label: string
  summary: string
  itemCount: number
}

export function DmDinhMucPhuGroupListClient({
  groups,
  basePath,
  initialQ,
  pageSize,
}: {
  groups: AuxiliaryGroupRow[]
  basePath: string
  initialQ: string
  pageSize: number
}) {
  const { q, setQ, debouncedQ, page, setPage } = useLocalFilterState({ basePath, initialQ, pageSize })
  const filteredRows = useMemo(() => {
    const keyword = debouncedQ.trim().toLowerCase()
    if (!keyword) return groups
    return groups.filter((group) => `${group.label} ${group.summary}`.toLowerCase().includes(keyword))
  }, [debouncedQ, groups])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách định mức</h2>
          <p className="app-muted mt-2 text-sm">Số bộ định mức: {filteredRows.length} / {groups.length}</p>
        </div>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
          placeholder="Tìm theo loại cọc, vật tư, ĐVT..."
          className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
        />
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <div className="master-data-table-frame">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                {['ĐK ngoài + Thành cọc', 'Vật tư phụ hiện hành', 'Số dòng'].map((label) => (
                  <th key={label} className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((group, index) => {
                const editHref = buildHref(
                  basePath,
                  new URLSearchParams({
                    ...(q.trim() ? { q: q.trim() } : {}),
                    page: String(safePage),
                    edit_group: group.group,
                  })
                )
                return (
                  <tr
                    key={`${index}-${group.group}`}
                    className="border-b align-top"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                  >
                    <td className="px-3 py-2 min-w-[260px]">
                      <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                        {group.label}
                      </Link>
                    </td>
                    <td className="px-3 py-2 min-w-[320px]">{group.summary}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{group.itemCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

type ConcreteMixGroupRow = {
  variant: string
  macBeTong: string
  summary: string
  itemCount: number
}

export function DmCapphoiBtGroupListClient({
  groups,
  basePath,
  initialQ,
  pageSize,
}: {
  groups: ConcreteMixGroupRow[]
  basePath: string
  initialQ: string
  pageSize: number
}) {
  const { q, setQ, debouncedQ, page, setPage } = useLocalFilterState({ basePath, initialQ, pageSize })
  const filteredRows = useMemo(() => {
    const keyword = debouncedQ.trim().toLowerCase()
    if (!keyword) return groups
    return groups.filter((group) => `${group.variant} ${group.macBeTong} ${group.summary}`.toLowerCase().includes(keyword))
  }, [debouncedQ, groups])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách cấp phối</h2>
          <p className="app-muted mt-2 text-sm">Số bộ cấp phối: {filteredRows.length} / {groups.length}</p>
        </div>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
          placeholder="Tìm theo variant, mác, NVL..."
          className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
        />
      </div>

      {filteredRows.length === 0 ? (
        <p className="app-muted mt-4 text-sm">Không có dữ liệu phù hợp.</p>
      ) : (
        <div className="master-data-table-frame">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                {['Variant', 'Mác BT', 'NVL hiện hành', 'Số dòng'].map((label) => (
                  <th key={label} className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((group, index) => {
                const editHref = buildHref(
                  basePath,
                  new URLSearchParams({
                    ...(q.trim() ? { q: q.trim() } : {}),
                    page: String(safePage),
                    edit_variant: group.variant,
                    edit_mac: group.macBeTong,
                  })
                )
                return (
                  <tr
                    key={`${index}-${group.variant}-${group.macBeTong}`}
                    className="border-b align-top"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                        {group.variant}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{group.macBeTong}</td>
                    <td className="px-3 py-2 min-w-[340px]">{group.summary}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{group.itemCount}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

type ProfitGroupRow = {
  diameter: string
  label: string
  summary: string
  itemCount: number
}

export function DmThueLoiNhuanGroupListClient({
  groups,
  basePath,
  initialQ,
  pageSize,
}: {
  groups: ProfitGroupRow[]
  basePath: string
  initialQ: string
  pageSize: number
}) {
  const { q, setQ, debouncedQ, page, setPage } = useLocalFilterState({ basePath, initialQ, pageSize })
  const filteredRows = useMemo(() => {
    const keyword = debouncedQ.trim().toLowerCase()
    if (!keyword) return groups
    return groups.filter((group) => `${group.label} ${group.summary}`.toLowerCase().includes(keyword))
  }, [debouncedQ, groups])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Danh sách rule lợi nhuận</h2>
          <p className="app-muted mt-2 text-sm">Số bộ rule: {filteredRows.length} / {groups.length}</p>
        </div>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
          placeholder="Tìm theo đường kính, md, % lợi nhuận..."
          className="app-input w-full min-w-[260px] rounded-xl px-3 py-2 text-sm md:w-auto"
        />
      </div>

      <div className="master-data-table-frame">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              {['Đường kính cọc', 'Các mốc lợi nhuận hiện hành', 'Số dòng'].map((label) => (
                <th key={label} className="sticky top-0 z-10 px-3 py-3 font-semibold whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)' }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((group, index) => {
              const editHref = buildHref(
                basePath,
                new URLSearchParams({
                  ...(q.trim() ? { q: q.trim() } : {}),
                  page: String(safePage),
                  edit_diameter: group.diameter,
                })
              )
              return (
                <tr
                  key={`${group.diameter}-${index}`}
                  className="border-b align-top"
                  style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={editHref} className="font-semibold hover:underline" style={{ color: 'var(--color-primary)' }}>
                      {group.label}
                    </Link>
                  </td>
                  <td className="px-3 py-2 min-w-[320px]">{group.summary}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{group.itemCount}</td>
                </tr>
              )
            })}
            {pagedRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-500">
                  Không có dữ liệu phù hợp.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {filteredRows.length > pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="app-muted text-sm">Trang {safePage} / {totalPages}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PaginationButton disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</PaginationButton>
            {buildPageNumbers(totalPages, safePage).map((pageNumber) => (
              <PaginationButton key={pageNumber} disabled={pageNumber === safePage} active={pageNumber === safePage} onClick={() => setPage(pageNumber)}>
                {pageNumber}
              </PaginationButton>
            ))}
            <PaginationButton disabled={safePage >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</PaginationButton>
          </div>
        </div>
      ) : null}
    </>
  )
}

import type { ReactNode } from 'react'
import Link from 'next/link'
import { DmDuanListClient } from '@/components/master-data/local-master-data-list'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createDmDuanAction, updateDmDuanAction } from '@/lib/master-data/dm-duan-actions'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'
import {
  displayCellValue,
  readParam,
  safeStringify,
} from '@/lib/master-data/crud-utils'
import {
  AREA_DATALIST_ID,
  AREA_OPTIONS,
  loadDmDuanPageData,
  readAddressValue as readDuanAddressValue,
  readAreaValue as readDuanAreaValue,
  readNoteValue as readDuanNoteValue,
} from '@/lib/master-data/dm-duan'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-duan'
const PAGE_SIZE = 15

export default async function DmDuanPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_duan')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const showInactive = readParam(searchParams, 'show_inactive') === '1'
  const editKey = readParam(searchParams, 'edit_key')
  const currentPage = Math.max(1, Number.parseInt(readParam(searchParams, 'page') || '1', 10) || 1)
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')
  const {
    rows,
    customers,
    customerMap,
    keyField,
    error,
    storage: { addressField, noteField, addressStorageMode, areaField, areaStorageMode },
    editRow,
  } = await loadDmDuanPageData({
    q,
    showInactive,
    editKey,
    currentPage,
    pageSize: PAGE_SIZE,
  })
  const resolvedKeyField = keyField ?? 'duan_id'
  const listRows = rows.map((row) => ({
    ...row,
    khach_hang_hien_thi:
      customerMap.get(String(row.kh_id ?? ''))?.ten_kh
        ? [customerMap.get(String(row.kh_id ?? ''))?.ma_kh, customerMap.get(String(row.kh_id ?? ''))?.ten_kh]
            .filter(Boolean)
            .join(' - ')
        : displayCellValue(row.kh_id),
    dia_chi_hien_thi: displayCellValue(readDuanAddressValue(row, addressField, noteField)),
    khu_vuc_hien_thi: displayCellValue(readDuanAreaValue(row, areaField, noteField)),
    ghi_chu_hien_thi: displayCellValue(readDuanNoteValue(row, noteField)),
  }))

  return (
    <div className="master-data-page">
      <datalist id={AREA_DATALIST_ID}>
        {AREA_OPTIONS.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>

      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Dự án</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Tạo dự án gắn trực tiếp với khách hàng để dùng tiếp cho bóc tách và dự toán.
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
        <form action={createDmDuanAction} className="mt-5 space-y-4">
          <input type="hidden" name="address_field" value={addressField} />
          <input type="hidden" name="address_storage_mode" value={addressStorageMode} />
          <input type="hidden" name="area_field" value={areaField} />
          <input type="hidden" name="area_storage_mode" value={areaStorageMode} />
          <input type="hidden" name="note_field" value={noteField} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Tên Dự Án (bắt buộc)" className="xl:col-span-2">
              <input
                type="text"
                name="ten_da"
                required
                className="app-input w-full rounded-xl px-3 py-3 text-sm"
              />
            </Field>
            <Field label="Khách hàng (bắt buộc)">
              <select name="kh_id" required defaultValue="" className="app-input w-full rounded-xl px-3 py-3 text-sm">
                <option value="">-- Chọn khách hàng --</option>
                {customers.map((customer) => (
                  <option key={customer.kh_id} value={customer.kh_id}>
                    {[customer.ma_kh, customer.ten_kh].filter(Boolean).join(' - ')}
                  </option>
                ))}
              </select>
            </Field>
            {addressStorageMode !== 'none' ? (
              <Field label="Địa Chỉ Công Trình" className="md:col-span-2">
                <input
                  type="text"
                  name={addressField}
                  placeholder="Nhập địa chỉ công trình"
                  className="app-input w-full rounded-xl px-3 py-3 text-sm"
                />
              </Field>
            ) : null}
            {areaStorageMode !== 'none' ? (
              <Field label="Khu vực">
                <input
                  type="text"
                  name={areaField}
                  list={AREA_DATALIST_ID}
                  required
                  placeholder="-- chọn hoặc gõ khu vực -- bắt buộc"
                  className="app-input w-full rounded-xl px-3 py-3 text-sm"
                />
              </Field>
            ) : null}
            {noteField ? (
              <Field label="Ghi chú" className="md:col-span-2 xl:col-span-3">
                <textarea name={noteField} rows={3} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
              </Field>
            ) : null}
          </div>

          <div className="flex justify-end">
            <FormSubmitButton
              pendingLabel="Đang lưu dự án..."
              className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
            >
              Lưu dự án
            </FormSubmitButton>
          </div>
        </form>
      </section>

      <section className="master-data-section">
        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">
            {JSON.stringify(error, null, 2)}
          </pre>
        ) : (
          <DmDuanListClient
            rows={listRows}
            keyField={resolvedKeyField}
            basePath={BASE_PATH}
            initialQ={q}
            initialShowInactive={showInactive}
            pageSize={PAGE_SIZE}
            customerField="khach_hang_hien_thi"
            addressField="dia_chi_hien_thi"
            areaField="khu_vuc_hien_thi"
            noteField="ghi_chu_hien_thi"
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
                    Chỉnh sửa dự án
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{String(editRow.ma_da ?? editRow[keyField])}</h2>
                  <p className="app-muted mt-2 text-sm">
                    Cập nhật dự án mà vẫn giữ nguyên luồng thao tác hiện tại.
                  </p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}>
                <InfoCard label="Mã dự án" value={String(editRow.ma_da ?? '-')} />
                <InfoCard label="Khách hàng" value={customerMap.get(String(editRow.kh_id ?? ''))?.ten_kh ?? String(editRow.kh_id ?? '-')} />
                <InfoCard label="Khu vực" value={String(readDuanAreaValue(editRow, areaField, noteField) ?? '-')} />
              </div>

              <form action={updateDmDuanAction} className="mt-6 space-y-5">
                <input type="hidden" name="key_value" value={safeStringify(editRow[keyField])} />
                <input type="hidden" name="address_field" value={addressField} />
                <input type="hidden" name="address_storage_mode" value={addressStorageMode} />
                <input type="hidden" name="area_field" value={areaField} />
                <input type="hidden" name="area_storage_mode" value={areaStorageMode} />
                <input type="hidden" name="note_field" value={noteField} />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="Tên Dự Án (bắt buộc)" className="xl:col-span-2">
                    <input
                      type="text"
                      name="ten_da"
                      required
                      defaultValue={String(editRow.ten_da ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                  <Field label="Khách hàng (bắt buộc)">
                    <select
                      name="kh_id"
                      required
                      defaultValue={String(editRow.kh_id ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    >
                      <option value="">-- Chọn khách hàng --</option>
                      {customers.map((customer) => (
                        <option key={customer.kh_id} value={customer.kh_id}>
                          {[customer.ma_kh, customer.ten_kh].filter(Boolean).join(' - ')}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {addressStorageMode !== 'none' ? (
                    <Field label="Địa Chỉ Công Trình" className="md:col-span-2">
                      <input
                        type="text"
                        name={addressField}
                        defaultValue={String(readDuanAddressValue(editRow, addressField, noteField) ?? '')}
                        placeholder="Nhập địa chỉ công trình"
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                  {areaStorageMode !== 'none' ? (
                    <Field label="Khu vực">
                      <input
                        type="text"
                        name={areaField}
                        list={AREA_DATALIST_ID}
                        required
                        defaultValue={String(readDuanAreaValue(editRow, areaField, noteField) ?? '')}
                        placeholder="-- chọn hoặc gõ khu vực -- bắt buộc"
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                  {noteField ? (
                    <Field label="Ghi chú" className="md:col-span-2 xl:col-span-3">
                      <textarea
                        name={noteField}
                        rows={4}
                        defaultValue={String(readDuanNoteValue(editRow, noteField) ?? '')}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                </div>

                <div className="flex items-center justify-end gap-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                  <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                    Hủy
                  </Link>
                  <FormSubmitButton
                    pendingLabel="Đang cập nhật..."
                    className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                  >
                    Lưu dự án
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

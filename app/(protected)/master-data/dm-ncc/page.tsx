import type { ReactNode } from 'react'
import Link from 'next/link'
import { DmNccListClient } from '@/components/master-data/local-master-data-list'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createDmNccAction, updateDmNccAction } from '@/lib/master-data/dm-ncc-actions'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'
import {
  LOAI_NCC_OPTIONS,
  loadDmNccPageData,
} from '@/lib/master-data/dm-ncc'
import {
  readParam,
  safeStringify,
} from '@/lib/master-data/crud-utils'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-ncc'
const PAGE_SIZE = 15

function getLoaiNccLabel(value: unknown) {
  const normalized = String(value ?? '').trim().toUpperCase()
  return LOAI_NCC_OPTIONS.find((option) => option.value === normalized)?.label ?? String(value ?? '-')
}

export default async function DmNccPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_ncc')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const showInactive = readParam(searchParams, 'show_inactive') === '1'
  const editKey = readParam(searchParams, 'edit_key')
  const currentPage = Math.max(1, Number.parseInt(readParam(searchParams, 'page') || '1', 10) || 1)
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')

  const {
    rows,
    error,
    keyField,
    phoneField,
    emailField,
    contactNameField,
    addressField,
    noteField,
    editRow,
  } = await loadDmNccPageData({
    q,
    showInactive,
    editKey,
    currentPage,
    pageSize: PAGE_SIZE,
  })
  const resolvedKeyField = keyField ?? 'ncc_id'

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Nhà cung cấp</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Quản lý danh mục nhà cung cấp theo cùng chuẩn thao tác với khách hàng và dự án.
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
        <form action={createDmNccAction} className="mt-5 space-y-4">
          <input type="hidden" name="contact_field" value={phoneField} />
          <input type="hidden" name="email_field" value={emailField} />
          <input type="hidden" name="contact_name_field" value={contactNameField} />
          <input type="hidden" name="address_field" value={addressField} />
          <input type="hidden" name="note_field" value={noteField} />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Tên Nhà Cung Cấp (bắt buộc)" className="xl:col-span-2">
              <input type="text" name="ten_ncc" required className="app-input w-full rounded-xl px-3 py-3 text-sm" />
            </Field>
            <Field label="Loại Nhà Cung Cấp (bắt buộc)">
              <select
                name="loai_ncc"
                defaultValue="PHU_KIEN"
                className="app-input w-full rounded-xl px-3 py-3 text-sm"
              >
                {LOAI_NCC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            {contactNameField ? (
              <Field label="Người liên hệ">
                <input type="text" name={contactNameField} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
              </Field>
            ) : null}
            {phoneField ? (
              <Field label="SĐT">
                <input type="text" name={phoneField} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
              </Field>
            ) : null}
            {emailField ? (
              <Field label="Email">
                <input type="email" name={emailField} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
              </Field>
            ) : null}
            {addressField ? (
              <Field label="Địa chỉ" className="md:col-span-2">
                <input type="text" name={addressField} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
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
              pendingLabel="Đang lưu nhà cung cấp..."
              className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
            >
              Lưu nhà cung cấp
            </FormSubmitButton>
          </div>
        </form>
      </section>

      <section className="master-data-section">
        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto rounded-xl p-4 text-sm">{JSON.stringify(error, null, 2)}</pre>
        ) : (
          <DmNccListClient
            rows={rows}
            keyField={resolvedKeyField}
            basePath={BASE_PATH}
            initialQ={q}
            initialShowInactive={showInactive}
            pageSize={PAGE_SIZE}
            phoneField={phoneField}
            emailField={emailField}
            contactNameField={contactNameField}
            addressField={addressField}
            noteField={noteField}
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
                    Chỉnh sửa nhà cung cấp
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{String(editRow.ma_ncc ?? editRow[keyField])}</h2>
                  <p className="app-muted mt-2 text-sm">Cập nhật nhà cung cấp mà không rời khỏi danh sách hiện tại.</p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}>
                <InfoCard label="Mã nhà cung cấp" value={String(editRow.ma_ncc ?? '-')} />
                <InfoCard label="Loại nhà cung cấp" value={getLoaiNccLabel(editRow.loai_ncc)} />
                <InfoCard label="SĐT" value={String(phoneField ? editRow[phoneField] ?? '-' : '-')} />
              </div>

              <form action={updateDmNccAction} className="mt-6 space-y-5">
                <input type="hidden" name="key_value" value={safeStringify(editRow[keyField])} />
                <input type="hidden" name="contact_field" value={phoneField} />
                <input type="hidden" name="email_field" value={emailField} />
                <input type="hidden" name="contact_name_field" value={contactNameField} />
                <input type="hidden" name="address_field" value={addressField} />
                <input type="hidden" name="note_field" value={noteField} />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <Field label="Tên Nhà Cung Cấp (bắt buộc)" className="xl:col-span-2">
                    <input
                      type="text"
                      name="ten_ncc"
                      required
                      defaultValue={String(editRow.ten_ncc ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                  <Field label="Loại Nhà Cung Cấp (bắt buộc)">
                    <select
                      name="loai_ncc"
                      defaultValue={String(editRow.loai_ncc ?? 'PHU_KIEN')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    >
                      {LOAI_NCC_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {contactNameField ? (
                    <Field label="Người liên hệ">
                      <input
                        type="text"
                        name={contactNameField}
                        defaultValue={String(editRow[contactNameField] ?? '')}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                  {phoneField ? (
                    <Field label="SĐT">
                      <input
                        type="text"
                        name={phoneField}
                        defaultValue={String(editRow[phoneField] ?? '')}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                  {emailField ? (
                    <Field label="Email">
                      <input
                        type="email"
                        name={emailField}
                        defaultValue={String(editRow[emailField] ?? '')}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                  {addressField ? (
                    <Field label="Địa chỉ" className="md:col-span-2">
                      <input
                        type="text"
                        name={addressField}
                        defaultValue={String(editRow[addressField] ?? '')}
                        className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      />
                    </Field>
                  ) : null}
                  {noteField ? (
                    <Field label="Ghi chú" className="md:col-span-2 xl:col-span-3">
                      <textarea
                        name={noteField}
                        rows={4}
                        defaultValue={String(editRow[noteField] ?? '')}
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
                    Lưu nhà cung cấp
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

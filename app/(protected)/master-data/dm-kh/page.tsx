import type { ReactNode } from 'react'
import Link from 'next/link'
import { DmKhListClient } from '@/components/master-data/local-master-data-list'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createDmKhAction, updateDmKhAction } from '@/lib/master-data/dm-kh-actions'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'
import {
  DM_KH_FIELD_LABELS,
  getPreferredContactValue,
  loadDmKhPageData,
} from '@/lib/master-data/dm-kh'
import {
  readParam,
  safeStringify,
} from '@/lib/master-data/crud-utils'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/dm-kh'
const PAGE_SIZE = 15

const NHOM_KH_LABELS: Record<string, string> = {
  TIEM_NANG: 'Tiềm năng',
  VANG_LAI: 'Vãng lai',
}

export default async function DmKhPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_kh')
  const searchParams = await props.searchParams
  const q = readParam(searchParams, 'q')
  const showInactive = readParam(searchParams, 'show_inactive') === '1'
  const editKey = readParam(searchParams, 'edit_key')
  const currentPage = Math.max(1, Number.parseInt(readParam(searchParams, 'page') || '1', 10) || 1)
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')
  const contact = readParam(searchParams, 'contact')
  const {
    rows,
    error,
    keyField,
    formFields,
    columns,
    editRow,
    duplicateMatches,
  } = await loadDmKhPageData({
    q,
    showInactive,
    editKey,
    contact,
    currentPage,
    pageSize: PAGE_SIZE,
  })
  const resolvedKeyField = keyField ?? 'kh_id'

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Khách hàng</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Kiểm tra trùng theo liên hệ trước khi tạo mới để tránh phát sinh khách hàng trùng.
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

        <form method="get" action={BASE_PATH} className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className="mb-2 block text-sm font-semibold">Liên hệ (bắt buộc)</label>
              <input
                type="text"
                name="contact"
                defaultValue={contact}
                placeholder="SĐT hoặc Email..."
                className="app-input w-full rounded-xl px-3 py-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="app-outline h-12 rounded-xl px-5 text-sm font-semibold transition"
            >
              Kiểm tra trùng
            </button>
          </div>
        </form>

        {contact ? (
          duplicateMatches.length > 0 ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
                Liên hệ này đã tồn tại. Vui lòng dùng khách hàng có sẵn.
              </p>
              {duplicateMatches.map((row) => (
                <div
                  key={String(row[keyField ?? 'kh_id'] ?? row.ma_kh ?? row.ten_kh)}
                  className="rounded-2xl border p-4"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{String(row.ten_kh ?? '-')}</p>
                      <p className="app-muted mt-1 text-sm">
                        {[row.ma_kh, getPreferredContactValue(row), row.email].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {keyField ? (
                      <Link
                        href={`${BASE_PATH}?edit_key=${encodeURIComponent(String(row[keyField]))}`}
                        className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition"
                      >
                        Mở khách hàng này
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <form action={createDmKhAction} className="mt-5 space-y-4">
              <input type="hidden" name="contact" value={contact} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Thông tin khách hàng (bắt buộc)" className="xl:col-span-2">
                  <input
                    type="text"
                    name="ten_kh"
                    required
                    placeholder="VD: CÔNG TY TNHH ..."
                    className="app-input w-full rounded-xl px-3 py-3 text-sm"
                  />
                </Field>
                {formFields.includes('email') ? (
                  <Field label="Email">
                    <input type="email" name="email" className="app-input w-full rounded-xl px-3 py-3 text-sm" />
                  </Field>
                ) : null}
                {formFields.includes('mst') ? (
                  <Field label="MST">
                    <input type="text" name="mst" className="app-input w-full rounded-xl px-3 py-3 text-sm" />
                  </Field>
                ) : null}
                {formFields.includes('dia_chi') ? (
                  <Field label="Địa chỉ" className="xl:col-span-2">
                    <input type="text" name="dia_chi" className="app-input w-full rounded-xl px-3 py-3 text-sm" />
                  </Field>
                ) : null}
                <Field label="Nhóm khách hàng">
                  <select name="nhom_kh" defaultValue="TIEM_NANG" className="app-input w-full rounded-xl px-3 py-3 text-sm">
                    <option value="TIEM_NANG">Tiềm năng</option>
                    <option value="VANG_LAI">Vãng lai</option>
                  </select>
                </Field>
                {formFields.includes('ghi_chu') ? (
                  <Field label="Ghi chú" className="md:col-span-2 xl:col-span-3">
                    <textarea name="ghi_chu" rows={3} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
                  </Field>
                ) : null}
              </div>
              <div className="flex justify-end">
                <FormSubmitButton
                  pendingLabel="Đang lưu khách hàng..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu khách hàng
                </FormSubmitButton>
              </div>
            </form>
          )
        ) : (
          <p className="app-muted mt-5 text-sm">
            Nhập SĐT hoặc Email rồi bấm <span className="font-semibold">Kiểm tra trùng</span> để tiếp tục.
          </p>
        )}
      </section>

      <section className="master-data-section">
        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">
            {JSON.stringify(error, null, 2)}
          </pre>
        ) : (
          <DmKhListClient
            rows={rows}
            columns={columns}
            keyField={resolvedKeyField}
            basePath={BASE_PATH}
            initialQ={q}
            initialShowInactive={showInactive}
            pageSize={PAGE_SIZE}
            contact={contact}
            columnLabels={DM_KH_FIELD_LABELS}
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
                  <p
                    className="text-sm font-semibold tracking-[0.16em] uppercase"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Chỉnh sửa khách hàng
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{String(editRow.ma_kh ?? editRow[keyField])}</h2>
                  <p className="app-muted mt-2 text-sm">
                    Cập nhật thông tin khách hàng mà không rời khỏi danh sách hiện tại.
                  </p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
            <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}>
              <InfoCard label="Mã khách hàng" value={String(editRow.ma_kh ?? '-')} />
              <InfoCard label="Liên hệ hiện tại" value={getPreferredContactValue(editRow) || '-'} />
              <InfoCard label="Nhóm khách hàng" value={NHOM_KH_LABELS[String(editRow.nhom_kh ?? '')] ?? String(editRow.nhom_kh ?? '-')} />
            </div>

            <form action={updateDmKhAction} className="mt-6 space-y-5">
              <input type="hidden" name="key_value" value={safeStringify(editRow[keyField])} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Liên hệ (bắt buộc)">
                  <input
                    type="text"
                    name="contact"
                    defaultValue={getPreferredContactValue(editRow)}
                    className="app-input w-full rounded-xl px-3 py-3 text-sm"
                  />
                </Field>
                {formFields.includes('email') ? (
                  <Field label="Email">
                    <input
                      type="email"
                      name="email"
                      defaultValue={String(editRow.email ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                ) : null}
                <Field label="Thông tin khách hàng (bắt buộc)" className="md:col-span-2 xl:col-span-1">
                  <input
                    type="text"
                    name="ten_kh"
                    required
                    defaultValue={String(editRow.ten_kh ?? '')}
                    className="app-input w-full rounded-xl px-3 py-3 text-sm"
                  />
                </Field>
                {formFields.includes('mst') ? (
                  <Field label="MST">
                    <input
                      type="text"
                      name="mst"
                      defaultValue={String(editRow.mst ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                ) : null}
                {formFields.includes('dia_chi') ? (
                  <Field label="Địa chỉ" className="md:col-span-2 xl:col-span-2">
                    <input
                      type="text"
                      name="dia_chi"
                      defaultValue={String(editRow.dia_chi ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    />
                  </Field>
                ) : null}
                <Field label="Nhóm khách hàng">
                  <select
                    name="nhom_kh"
                    defaultValue={String(editRow.nhom_kh ?? 'TIEM_NANG')}
                    className="app-input w-full rounded-xl px-3 py-3 text-sm"
                  >
                    <option value="TIEM_NANG">Tiềm năng</option>
                    <option value="VANG_LAI">Vãng lai</option>
                  </select>
                </Field>
                {formFields.includes('ghi_chu') ? (
                  <Field label="Ghi chú" className="md:col-span-2 xl:col-span-3">
                    <textarea
                      name="ghi_chu"
                      rows={4}
                      defaultValue={String(editRow.ghi_chu ?? '')}
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
                    Lưu khách hàng
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

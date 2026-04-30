import type { ReactNode } from 'react'
import Link from 'next/link'
import { WarehouseLocationListClient } from '@/components/master-data/local-master-data-list'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'
import {
  loadWarehouseLocationPageData,
} from '@/lib/master-data/warehouse-location'
import {
  buildWarehouseLocationLabel,
  formatWarehouseLocationGroup,
} from '@/lib/master-data/warehouse-location-shared'
import {
  createWarehouseLocationAction,
  updateWarehouseLocationAction,
} from '@/lib/master-data/warehouse-location-actions'
import {
  readParam,
} from '@/lib/master-data/crud-utils'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const BASE_PATH = '/master-data/khu-vuc-ton'
const PAGE_SIZE = 15

export default async function WarehouseLocationPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_khu_vuc_ton')
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
    editRow,
    parentOptions,
  } = await loadWarehouseLocationPageData({
    q,
    showInactive,
    editKey,
    currentPage,
    pageSize: PAGE_SIZE,
  })

  const resolvedKeyField = keyField ?? 'location_id'

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
              Danh mục
            </div>
            <h1 className="mt-4 text-2xl font-bold">Khu vực tồn / Bãi</h1>
            <p className="app-muted mt-2 max-w-3xl text-sm">
              Tạo các bãi thực tế như A1, A2, A3... để sau này gán serial cọc vào đúng vị trí ngoài kho.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/ton-kho/thanh-pham/vi-tri-bai/ma-qr"
              className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition"
            >
              In QR bãi
            </Link>
            <Link
              href="/ton-kho/thanh-pham/vi-tri-bai"
              className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition"
            >
              Xem tồn theo bãi
            </Link>
          </div>
        </div>
      </section>

      {msg ? <section className="master-data-section master-data-message master-data-message-success">{msg}</section> : null}
      {err ? <section className="master-data-section master-data-message master-data-message-error">{err}</section> : null}

      <section className="master-data-section">
        <h2 className="text-lg font-semibold">Tạo mới</h2>
        <p className="app-muted mt-2 text-sm">
          Tạo xong bãi là có thể mở ngay trang in QR để dán ngoài hiện trường.
        </p>
        <form action={createWarehouseLocationAction} className="mt-5">
          <input type="hidden" name="location_type" value="STORAGE" />
          <div className="grid items-end gap-4 md:grid-cols-[260px_minmax(0,1fr)_auto]">
            <Field label="Mã bãi (bắt buộc)">
              <input type="text" name="location_code" required className="app-input h-12 w-full rounded-xl px-3 text-sm uppercase" />
            </Field>
            <Field label="Tên bãi / mô tả ngắn">
              <input type="text" name="location_name" className="app-input h-12 w-full rounded-xl px-3 text-sm" placeholder="Ví dụ: Bãi cọc ngoài trời phía Đông" />
            </Field>
            <FormSubmitButton
              pendingLabel="Đang lưu khu vực tồn..."
              className="app-primary h-12 whitespace-nowrap rounded-xl px-5 text-sm font-semibold transition disabled:opacity-60"
            >
              Lưu khu vực tồn
            </FormSubmitButton>
          </div>
        </form>
      </section>

      <section className="master-data-section">
        {error ? (
          <pre className="app-accent-soft mt-4 overflow-auto p-4 text-sm">{JSON.stringify(error, null, 2)}</pre>
        ) : (
          <WarehouseLocationListClient
            rows={rows}
            keyField={resolvedKeyField}
            basePath={BASE_PATH}
            initialQ={q}
            initialShowInactive={showInactive}
            pageSize={PAGE_SIZE}
          />
        )}
      </section>

      {editRow ? (
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
                    Chỉnh sửa bãi
                  </p>
                  <h2 className="mt-2 text-2xl font-bold">{buildWarehouseLocationLabel(editRow)}</h2>
                  <p className="app-muted mt-2 text-sm">Cập nhật bãi vật lý mà không rời khỏi danh sách hiện tại.</p>
                </div>
                <Link href={BASE_PATH} className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Đóng
                </Link>
              </div>
            </div>

            <div className="px-6 py-6">
              <div
                className="grid gap-4 rounded-2xl border p-4 md:grid-cols-3"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-background) 55%, white)' }}
              >
                <InfoCard label="Mã bãi" value={String(editRow.location_code ?? '-')} />
                <InfoCard label="Nhóm" value={formatWarehouseLocationGroup(editRow)} />
                <InfoCard label="Đang chứa" value={`${String(editRow.current_serial_count ?? 0)} serial`} />
              </div>

              <form action={updateWarehouseLocationAction} className="mt-6 space-y-5">
                <input type="hidden" name="location_id" value={String(editRow.location_id ?? '')} />
                <input type="hidden" name="location_type" value={String(editRow.location_type ?? 'STORAGE')} />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Mã bãi (bắt buộc)">
                    <input
                      type="text"
                      name="location_code"
                      required
                      defaultValue={String(editRow.location_code ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm uppercase"
                    />
                  </Field>
                  <Field label="Tên bãi / mô tả ngắn" className="xl:col-span-2">
                    <input
                      type="text"
                      name="location_name"
                      defaultValue={String(editRow.location_name ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                      placeholder="Ví dụ: Bãi cọc ngoài trời phía Đông"
                    />
                  </Field>
                  <Field label="Bãi cha / khu lớn" className="md:col-span-2">
                    <select
                      name="parent_location_id"
                      defaultValue={String(editRow.parent_location_id ?? '')}
                      className="app-input w-full rounded-xl px-3 py-3 text-sm"
                    >
                      <option value="">Không chọn</option>
                      {parentOptions
                        .filter((option) => option.locationId !== String(editRow.location_id ?? ''))
                        .map((option) => (
                          <option key={option.locationId} value={option.locationId}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>

                <div className="flex justify-end gap-3">
                  <Link href={BASE_PATH} className="app-outline rounded-xl px-5 py-3 text-sm font-semibold transition">
                    Hủy
                  </Link>
                  <FormSubmitButton
                    pendingLabel="Đang lưu thay đổi..."
                    className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                  >
                    Lưu thay đổi
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

function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`space-y-2 ${className}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'white' }}>
      <p className="app-muted text-xs font-semibold tracking-[0.14em] uppercase">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  )
}

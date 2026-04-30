import Link from 'next/link'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { FormSubmitButton } from '@/components/ui/form-submit-button'
import { DmChiPhiKhacForm } from '@/components/master-data/dm-chi-phi-khac-form'
import { DmChiPhiKhacView } from '@/components/master-data/dm-chi-phi-khac-view'
import { saveDmChiPhiKhacAction } from '@/lib/master-data/dm-chi-phi-khac-actions'
import { readParam, type RowData } from '@/lib/master-data/crud-utils'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const DEFAULT_DIAMETER_OPTIONS = ['300', '350', '400', '500', '600']
const DEFAULT_ROW_LABELS = [
  'Chi phí vật dụng',
  'Chi phí thí nghiệm',
  'Chi phí chứng chỉ/hồ sơ',
  'Chi phí sửa chữa, bảo trì',
  'Chi phí khác: Hoa hồng',
  'Chi phí khen thưởng',
  'Chi phí sản xuất/ var',
  'Chi phí sản xuất/ fix',
  'Chi phí khấu hao',
  'Chi phí bán hàng/ var',
  'Chi phí bán hàng/ fix',
]

export default async function DmChiPhiKhacPage(props: { searchParams: SearchParams }) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_chi_phi_khac')
  const searchParams = await props.searchParams
  const msg = readParam(searchParams, 'msg')
  const err = readParam(searchParams, 'err')
  const editMode = readParam(searchParams, 'edit') === '1'

  const supabase = await createClient()
  const [{ data: costRowsData, error: costError }, { data: templateRowsData }] = await Promise.all([
    supabase.from('dm_chi_phi_khac_md').select('*').eq('is_active', true).limit(4000),
    supabase.from('dm_coc_template').select('do_ngoai').eq('is_active', true).limit(400),
  ])

  const missingSetup = isMissingRelationError(costError?.message)
  const costRows = (costRowsData ?? []) as RowData[]
  const templateRows = (templateRowsData ?? []) as RowData[]

  const diameterSet = new Set<string>(DEFAULT_DIAMETER_OPTIONS)
  for (const row of costRows) {
    const value = String(row.duong_kinh_mm ?? '').trim()
    if (value) diameterSet.add(value)
  }
  for (const row of templateRows) {
    const value = String(row.do_ngoai ?? '').trim()
    if (value) diameterSet.add(value)
  }

  const diameters = Array.from(diameterSet).sort((a, b) => Number(a) - Number(b))
  const groupedRows = buildInitialRows(costRows, diameters)

  return (
    <div className="master-data-page">
      <section className="master-data-section">
        <div className="inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-[0.18em] uppercase app-primary-soft">
          Danh mục
        </div>
        <h1 className="mt-4 text-2xl font-bold">Chi phí khác / md</h1>
        <p className="app-muted mt-2 max-w-3xl text-sm">
          Thiết lập ma trận các khoản mục chi phí khác theo từng đường kính cọc để dùng trực tiếp trong dự toán.
        </p>
      </section>

      {msg ? <section className="master-data-section master-data-message master-data-message-success">{msg}</section> : null}
      {err ? <section className="master-data-section master-data-message master-data-message-error">{err}</section> : null}

      {missingSetup ? (
        <section className="master-data-section master-data-message master-data-message-success">
          Chức năng này cần chạy SQL khởi tạo trước. File cần chạy: <code>sql/dm_chi_phi_khac_md_setup.sql</code>
        </section>
      ) : (
        <section className="master-data-section">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Ma trận chi phí khác / md</h2>
              <p className="app-muted mt-2 text-sm">
                Dòng là khoản mục chi phí, cột là đường kính cọc. Dòng cuối tự cộng tổng chi phí khác / md theo từng đường kính.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {editMode ? (
                <Link href="/master-data/dm-chi-phi-khac" className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Hủy chỉnh sửa
                </Link>
              ) : (
                <Link href="/master-data/dm-chi-phi-khac?edit=1" className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition">
                  Chỉnh sửa
                </Link>
              )}
            </div>
          </div>

          {editMode ? (
            <form action={saveDmChiPhiKhacAction} className="mt-5 space-y-5">
              <DmChiPhiKhacForm initialDiameters={diameters} initialRows={groupedRows} />
              <div className="flex justify-end">
                <FormSubmitButton
                  pendingLabel="Đang lưu ma trận..."
                  className="app-primary rounded-xl px-5 py-3 text-sm font-semibold transition disabled:opacity-60"
                >
                  Lưu chi phí khác / md
                </FormSubmitButton>
              </div>
            </form>
          ) : (
            <DmChiPhiKhacView diameters={diameters} rows={groupedRows} />
          )}
        </section>
      )}
    </div>
  )
}

function isMissingRelationError(message?: string) {
  if (!message) return false
  return /relation .* does not exist/i.test(message) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(message)
}

function buildInitialRows(rows: RowData[], diameters: string[]) {
  const sorted = [...rows].sort((a, b) => {
    const orderDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
    if (orderDiff !== 0) return orderDiff
    return String(a.item_name ?? '').localeCompare(String(b.item_name ?? ''))
  })

  const grouped = new Map<
    string,
    {
      item_name: string
      dvt: string
      values: Record<string, string>
    }
  >()

  for (const row of sorted) {
    const key = `${row.sort_order ?? ''}::${row.item_name ?? ''}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        item_name: String(row.item_name ?? ''),
        dvt: String(row.dvt ?? 'vnd/md').replace(/^VND\/md$/i, 'vnd/md'),
        values: Object.fromEntries(diameters.map((diameter) => [diameter, ''])),
      })
    }

    const current = grouped.get(key)
    if (!current) continue
    const diameter = String(row.duong_kinh_mm ?? '').trim()
    if (diameter) current.values[diameter] = String(row.chi_phi_vnd_md ?? '')
  }

  const result = Array.from(grouped.values())
  if (result.length > 0) return result

  return DEFAULT_ROW_LABELS.map((item_name) => ({
    item_name,
    dvt: 'vnd/md',
    values: Object.fromEntries(diameters.map((diameter) => [diameter, ''])),
  }))
}

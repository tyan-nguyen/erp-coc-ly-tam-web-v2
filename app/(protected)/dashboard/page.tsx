import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentSessionProfile } from '@/lib/auth/session'
import {
  isAdminRole,
  isCommercialRole,
  isInventoryCounterRole,
  isPurchaseRole,
  isQcRole,
  isQlsxRole,
  isSalesAccountingRole,
  isTechnicalRole,
  isWarehouseRole,
} from '@/lib/auth/roles'
import { loadBaoGiaListPageData } from '@/lib/bao-gia/page-data'
import { loadBocTachListPageData } from '@/lib/boc-tach/list-page'
import { loadDonHangListPageData } from '@/lib/don-hang/page-data'
import { loadFinishedGoodsCountingPageData } from '@/lib/finished-goods-counting/page-data'
import { loadInventoryCountingPageData } from '@/lib/inventory-counting/page-data'
import { loadNvlProcurementFlowPageData } from '@/lib/nvl-procurement/page-data'
import { loadQcNghiemThuPageData } from '@/lib/san-xuat/page-data'
import { loadKeHoachNgayList } from '@/lib/san-xuat/repository'
import { loadFinishedGoodsInventoryPageData } from '@/lib/ton-kho-thanh-pham/page-data'

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0))
}

function formatDateLabel(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatDashboardDate(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function HeaderBlock(props: { title: string; subtitle: string; metrics: Array<{ label: string; value: string }> }) {
  return (
    <>
      <div className="px-6 py-6">
        <div className="app-muted text-xs font-semibold uppercase tracking-[0.18em]">Dashboard</div>
        <h1 className="mt-2 text-3xl font-bold">{props.title}</h1>
        <p className="app-muted mt-2 text-sm">{props.subtitle}</p>
      </div>
      <div className="grid gap-0 border-t md:grid-cols-4" style={{ borderColor: 'var(--color-border)' }}>
        {props.metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={`px-6 py-4 ${index < props.metrics.length - 1 ? 'md:border-r' : ''}`}
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="app-muted text-xs uppercase tracking-[0.18em]">{metric.label}</div>
            <div className="mt-2 text-3xl font-semibold">{metric.value}</div>
          </div>
        ))}
      </div>
    </>
  )
}

function SectionTitle(props: { eyebrow?: string; title: string; description?: string }) {
  return (
    <div>
      {props.eyebrow ? (
        <div className="app-muted text-xs font-semibold uppercase tracking-[0.18em]">{props.eyebrow}</div>
      ) : null}
      <h2 className="mt-1 text-lg font-semibold">{props.title}</h2>
      {props.description ? <p className="app-muted mt-2 text-sm">{props.description}</p> : null}
    </div>
  )
}

function MetricRow(props: { label: string; value: string; hint?: string; emphasized?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.label}</div>
        {props.hint ? <div className="app-muted mt-1 text-xs">{props.hint}</div> : null}
      </div>
      <div className={props.emphasized ? 'text-lg font-semibold' : 'font-semibold'}>{props.value}</div>
    </div>
  )
}

function ActionRow(props: { href: string; title: string; meta: string; value: string; emphasized?: boolean }) {
  return (
    <Link
      href={props.href}
      prefetch={false}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 transition hover:opacity-80"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="app-muted mt-1 text-xs">{props.meta}</div>
      </div>
      <div className={props.emphasized ? 'text-lg font-semibold' : 'font-semibold'}>{props.value}</div>
    </Link>
  )
}

function NoteRow(props: { title: string; meta: string; value?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{props.title}</div>
        <div className="app-muted mt-1 text-xs">{props.meta}</div>
      </div>
      {props.value ? <div className="font-semibold">{props.value}</div> : null}
    </div>
  )
}

function UnifiedShell(props: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <section className="app-surface overflow-hidden rounded-2xl">{props.children}</section>
    </div>
  )
}

function EmptyDashboard(props: { title: string; subtitle: string; roleLabel: string }) {
  return (
    <UnifiedShell>
      <div className="px-6 py-6">
        <div className="app-muted text-xs font-semibold uppercase tracking-[0.18em]">Dashboard</div>
        <h1 className="mt-2 text-3xl font-bold">{props.title}</h1>
        <p className="app-muted mt-2 text-sm">{props.subtitle}</p>
      </div>
      <div className="border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
        <div className="text-sm font-medium">Role hiện tại</div>
        <div className="mt-2 text-2xl font-semibold">{props.roleLabel}</div>
      </div>
    </UnifiedShell>
  )
}

function extractDashboardDataIssue(error: unknown) {
  if (!error || typeof error !== 'object') return null

  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message : ''

  if (code === 'PGRST205' || message.includes('schema cache') || message.includes('Could not find the table')) {
    return message || 'Dashboard dang goi vao bang/schema chua ton tai trong project test.'
  }

  return null
}

function MissingSchemaDashboard(props: { subtitle: string; roleLabel: string; detail: string }) {
  return (
    <UnifiedShell>
      <div className="px-6 py-6">
        <div className="app-muted text-xs font-semibold uppercase tracking-[0.18em]">Dashboard</div>
        <h1 className="mt-2 text-3xl font-bold">Moi truong test chua du schema dashboard</h1>
        <p className="app-muted mt-2 text-sm">{props.subtitle}</p>
      </div>
      <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
          <SectionTitle
            eyebrow="Chan doan"
            title="Dang nhap da thanh cong"
            description="Project test nay chua du cac bang nghiep vu nen dashboard khong the tai du lieu nhu moi truong that."
          />
          <div className="mt-4 rounded-2xl border px-4 py-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
            {props.detail}
          </div>
        </div>
        <div className="px-6 py-5">
          <SectionTitle
            eyebrow="Goi y"
            title="Can dung them schema"
            description="Anh van co the dung project test, nhung can chay them cac bang/module khi test den tung nghiep vu."
          />
          <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
            <NoteRow title="Role dang dung" meta="Ho so user_profiles da hop le." value={props.roleLabel} />
            <NoteRow title="Auth da OK" meta="Login test da qua buoc xac thuc va doc profile." />
            <NoteRow title="Buoc tiep theo" meta="Dung them schema cho don_hang, bao_gia, ke_hoach, ton kho... khi can." />
          </div>
        </div>
      </div>
    </UnifiedShell>
  )
}

async function guardDashboardData<T>(loader: () => Promise<T>) {
  try {
    return { data: await loader(), issue: null as string | null }
  } catch (error) {
    const issue = extractDashboardDataIssue(error)
    if (issue) return { data: null as T | null, issue }
    throw error
  }
}

export default async function DashboardPage() {
  const { profile } = await getCurrentSessionProfile()
  const supabase = await createClient()
  const welcomeLine = `${profile.ho_ten || profile.email} • ${formatDashboardDate(new Date())}`

  const qlsxViewer = isQlsxRole(profile.role)
  const purchaseViewer = isPurchaseRole(profile.role)
  const warehouseViewer = isWarehouseRole(profile.role)
  const salesAccountingViewer = isSalesAccountingRole(profile.role)
  const commercialViewer = isCommercialRole(profile.role)
  const technicalViewer = isTechnicalRole(profile.role)
  const inventoryCounterViewer = isInventoryCounterRole(profile.role)
  const qcViewer = isQcRole(profile.role)
  const adminViewer = isAdminRole(profile.role)

  if (qlsxViewer) {
    const [bocTachData, donHangData, procurementData, planRows] = await Promise.all([
      loadBocTachListPageData({ qlsxViewer: true }),
      loadDonHangListPageData(supabase, { viewerRole: profile.role }),
      loadNvlProcurementFlowPageData(supabase),
      loadKeHoachNgayList(supabase, profile.role),
    ])

    const duToanChoQlsx = bocTachData.rows.filter((row) => row.trangThai === 'DA_GUI')
    const duToanDaDuyet = bocTachData.rows.filter((row) => row.trangThai === 'DA_DUYET_QLSX')
    const keHoachNhap = planRows.filter((row) => row.plan.trang_thai === 'NHAP')
    const keHoachDaChot = planRows.filter((row) => row.plan.trang_thai === 'DA_CHOT')
    const deXuatMuaDangMo = procurementData.savedRequestRows.length
    const poDangMo = procurementData.savedPurchaseOrderRows.filter((row) => row.status !== 'DA_NHAN_DU').length
    const dotDangVe = procurementData.savedReceiptRows.filter(
      (row) => !row.movementRecorded || row.settlementStatus !== 'DA_CHOT'
    ).length
    const nvlThieu = procurementData.demandRows.filter((row) => Number(row.shortageQty || 0) > 0)
    const topShortageRows = [...nvlThieu]
      .sort((left, right) => Number(right.shortageQty || 0) - Number(left.shortageQty || 0))
      .slice(0, 5)
    const recentOrders = donHangData.rows.slice(0, 5)
    const recentPlans = planRows.slice(0, 5)
    const recentBocTach = bocTachData.rows.slice(0, 5)

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Điều độ sản xuất trong ngày"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Dự toán chờ duyệt', value: formatNumber(duToanChoQlsx.length) },
            { label: 'KHSX nháp', value: formatNumber(keHoachNhap.length) },
            { label: 'Đề xuất mua đang mở', value: formatNumber(deXuatMuaDangMo) },
            { label: 'NVL đang thiếu', value: formatNumber(nvlThieu.length) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1.15fr_0.85fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle
              eyebrow="Ưu tiên"
              title="Việc cần xử lý"
              description="QLSX vào đầu ngày chỉ cần nhìn cụm này là biết việc nào đang chờ mình hoặc đang chặn tiến độ."
            />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow
                href="/boc-tach/boc-tach-nvl"
                title="Duyệt dự toán mới gửi"
                meta="Các bộ bóc tách đang chờ QLSX rà và duyệt."
                value={formatNumber(duToanChoQlsx.length)}
                emphasized
              />
              <ActionRow
                href="/san-xuat/ke-hoach-ngay"
                title="Chốt kế hoạch sản xuất ngày"
                meta="Các kế hoạch đang ở trạng thái nháp, chưa khóa để xuống kho."
                value={formatNumber(keHoachNhap.length)}
              />
              <ActionRow
                href="/ton-kho/nvl/mua-hang"
                title="Theo dõi mua NVL"
                meta="Đề xuất mua, PO và các đợt nhập đang ảnh hưởng đầu vào sản xuất."
                value={`${formatNumber(deXuatMuaDangMo)} / ${formatNumber(poDangMo)}`}
              />
              <ActionRow
                href="/san-xuat/mua-coc-ngoai"
                title="Kiểm tra mua cọc thành phẩm"
                meta="Theo dõi đơn mua cọc ngoài và tiến độ nhập kho phục vụ sản xuất."
                value="Mở"
              />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle
              eyebrow="Tóm tắt"
              title="Điểm nhấn trong ngày"
              description="Các chỉ số cần nhìn nhanh để biết chuỗi đầu vào sản xuất đang ổn hay đang nghẽn."
            />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <MetricRow label="Dự toán đã duyệt" value={formatNumber(duToanDaDuyet.length)} hint="Khối lượng đầu vào đã đi qua bước rà soát của QLSX." />
              <MetricRow label="Đơn hàng đang theo dõi" value={formatNumber(donHangData.rows.length)} hint="Các đơn hàng QLSX đang nhìn thấy trong chuỗi sản xuất." />
              <MetricRow label="KHSX đã chốt" value={formatNumber(keHoachDaChot.length)} hint="Những kế hoạch đã sẵn sàng cho các bước vận hành tiếp theo." />
              <MetricRow label="Đợt hàng còn mở" value={formatNumber(dotDangVe)} hint="Các đợt nhập NVL còn chờ ghi sổ hoặc chờ xác nhận KTMH." emphasized />
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Cảnh báo NVL" title="Mặt hàng đang thiếu nhiều nhất" description="Ưu tiên theo shortage thực tế để biết vật tư nào có nguy cơ chặn kế hoạch." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {topShortageRows.length ? (
                topShortageRows.map((row) => (
                  <ActionRow
                    key={row.id}
                    href="/ton-kho/nvl/mua-hang"
                    title={row.materialName}
                    meta={`${row.materialCode} • ${row.windowLabel || 'Chưa có kỳ'}`}
                    value={`${formatNumber(row.shortageQty)} ${row.unit}`}
                  />
                ))
              ) : (
                <NoteRow title="Không có cảnh báo thiếu NVL" meta="Hiện chưa có mã vật tư nào thiếu theo nhu cầu sản xuất." />
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Điều phối" title="Kế hoạch gần nhất" description="Nhìn nhanh các kế hoạch mới tạo hoặc mới chốt để bám nhịp điều độ." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {recentPlans.length ? (
                recentPlans.map((item) => (
                  <ActionRow
                    key={item.plan.plan_id}
                    href={`/san-xuat/ke-hoach-ngay?plan_id=${item.plan.plan_id}`}
                    title={`Kế hoạch ${formatDateLabel(item.plan.ngay_ke_hoach)}`}
                    meta={`${formatNumber(item.lineCount)} dòng • ${formatNumber(item.orderCount)} đơn`}
                    value={item.plan.trang_thai === 'DA_CHOT' ? 'Đã chốt' : 'Nháp'}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có kế hoạch sản xuất" meta="Hệ thống chưa có kế hoạch ngày nào để QLSX điều phối." />
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Đơn hàng" title="Đơn mới cập nhật" description="Các đơn hàng QLSX đang theo dõi để chuyển thành kế hoạch hoặc bám tiến độ." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {recentOrders.length ? (
                recentOrders.map((item) => (
                  <ActionRow
                    key={item.order.order_id}
                    href={`/don-hang/${item.order.order_id}`}
                    title={item.order.ma_order || item.order.order_id}
                    meta={`${item.khachHangName || '-'} • ${item.duAnName || '-'}`}
                    value={item.order.trang_thai_label || item.order.trang_thai}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có đơn hàng" meta="QLSX chưa có đơn nào trong phạm vi theo dõi." />
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Dự toán" title="Bộ bóc tách gần đây" description="Những bộ bóc tách mới gửi hoặc vừa được QLSX duyệt để chuyển bước tiếp theo." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {recentBocTach.length ? (
                recentBocTach.map((row) => (
                  <ActionRow
                    key={row.id}
                    href={`/boc-tach/boc-tach-nvl/${row.id}`}
                    title={row.displayId}
                    meta={`${row.khachHang} • ${row.duAn}`}
                    value={row.trangThaiLabel}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có bộ bóc tách" meta="Hệ thống chưa có bóc tách nào để QLSX xử lý." />
              )}
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (purchaseViewer) {
    const procurementData = await loadNvlProcurementFlowPageData(supabase)
    const deXuatChoDuyet = procurementData.savedRequestRows.length
    const poDangMo = procurementData.savedPurchaseOrderRows.filter((row) => row.status !== 'DA_NHAN_DU').length
    const dotChoChot = procurementData.savedReceiptRows.filter((row) => row.movementRecorded && row.settlementStatus !== 'DA_CHOT').length
    const poChoKhoa = procurementData.savedPurchaseOrderRows.filter((row) => row.status === 'XAC_NHAN_MOT_PHAN').length
    const receipts = procurementData.savedReceiptRows.slice(0, 5)
    const requests = procurementData.savedRequestRows.slice(0, 5)

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Mua hàng và chốt đợt"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Đề xuất đang mở', value: formatNumber(deXuatChoDuyet) },
            { label: 'PO đang mở', value: formatNumber(poDangMo) },
            { label: 'Đợt chờ chốt', value: formatNumber(dotChoChot) },
            { label: 'PO chờ khóa', value: formatNumber(poChoKhoa) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Ưu tiên" title="Việc cần làm của KTMH" description="Tập trung vào các bước đang chặn công nợ và khóa PO." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow href="/ton-kho/nvl/mua-hang" title="Duyệt đề xuất NVL" meta="Rà các đề xuất mua mới từ nhu cầu sản xuất." value={formatNumber(deXuatChoDuyet)} emphasized />
              <ActionRow href="/ton-kho/nvl/mua-hang" title="Chốt đợt đã ghi sổ" meta="Các đợt nhập kho đã ghi sổ nhưng KTMH chưa xác nhận." value={formatNumber(dotChoChot)} />
              <ActionRow href="/ton-kho/nvl/mua-hang" title="Khóa PO khi đã đủ điều kiện" meta="Chỉ khóa khi các đợt nhập của PO đã được KTMH chốt hết." value={formatNumber(poChoKhoa)} />
              <ActionRow href="/san-xuat/mua-coc-ngoai" title="Duyệt mua cọc ngoài" meta="Theo dõi các yêu cầu mua ngoài phục vụ sản xuất." value="Mở" />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Tóm tắt" title="Tình hình đầu vào mua hàng" description="Các chỉ số đủ để KTMH nhìn ra luồng việc nào đang ùn lại." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <MetricRow label="Phiếu mua đã tạo" value={formatNumber(procurementData.savedPurchaseOrderRows.length)} hint="Tổng số PO đang đọc được từ hệ thống." />
              <MetricRow label="Phiếu nhập đã tạo" value={formatNumber(procurementData.savedReceiptRows.length)} hint="Các đợt nhập hàng đã phát sinh từ PO NVL." />
              <MetricRow label="Đợt chưa ghi sổ" value={formatNumber(procurementData.savedReceiptRows.filter((row) => !row.movementRecorded).length)} hint="Kho vẫn còn phiếu nhập nháp hoặc chưa ghi sổ." />
              <MetricRow label="Đợt chờ KTMH" value={formatNumber(dotChoChot)} hint="Đã ghi sổ xong, đang chờ nhập SL tính tiền và đơn giá." emphasized />
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Đợt nhập" title="Các đợt cần bám ngay" description="Ưu tiên các đợt vừa ghi sổ hoặc còn chờ xác nhận." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {receipts.length ? (
                receipts.map((row) => (
                  <ActionRow
                    key={row.receiptId}
                    href="/ton-kho/nvl/mua-hang"
                    title={row.receiptCode}
                    meta={`${row.poCode} • Đợt ${formatNumber(row.batchNo)}`}
                    value={row.settlementStatus === 'DA_CHOT' ? 'Đã chốt' : row.movementRecorded ? 'Chờ chốt' : 'Chưa ghi sổ'}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có đợt nhập" meta="Hệ thống chưa có receipt NVL để KTMH theo dõi." />
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Đề xuất" title="Đề xuất gần đây" description="Các đề xuất mới nhất để KTMH nắm luồng đầu vào từ sản xuất." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {requests.length ? (
                requests.map((row) => (
                  <ActionRow
                    key={row.requestId}
                    href="/ton-kho/nvl/mua-hang"
                    title={row.requestCode}
                    meta={`${formatNumber(row.lineCount)} dòng • ${formatDateLabel(row.createdAt)}`}
                    value={row.status}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có đề xuất" meta="Hiện không có yêu cầu mua NVL nào cần KTMH xử lý." />
              )}
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (warehouseViewer) {
    const [procurementData, finishedGoodsData, inventoryCountData, finishedGoodsCountData, planRows] = await Promise.all([
      loadNvlProcurementFlowPageData(supabase),
      loadFinishedGoodsInventoryPageData(supabase, {}),
      loadInventoryCountingPageData(supabase),
      loadFinishedGoodsCountingPageData(supabase),
      loadKeHoachNgayList(supabase, profile.role),
    ])

    const choGhiSo = procurementData.savedReceiptRows.filter((row) => !row.movementRecorded).length
    const poDangNhan = procurementData.savedPurchaseOrderRows.filter((row) => row.status !== 'DA_NHAN_DU').length
    const phieuKiemKeVatTuMo = inventoryCountData.savedSheets.filter((row) => row.status !== 'DA_DIEU_CHINH_TON').length
    const phieuKiemKeThanhPhamMo = finishedGoodsCountData.savedSheets.filter((row) => row.status !== 'DA_DIEU_CHINH_TON').length
    const stockSummary = finishedGoodsData.summaryRows.slice(0, 5)
    const receiptRows = procurementData.savedReceiptRows.slice(0, 5)
    const operationalPlans = planRows.slice(0, 5)

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Kho và vận hành nhập xuất"
          subtitle={welcomeLine}
          metrics={[
            { label: 'PO đang nhận', value: formatNumber(poDangNhan) },
            { label: 'Chờ ghi sổ', value: formatNumber(choGhiSo) },
            { label: 'Kiểm kê vật tư mở', value: formatNumber(phieuKiemKeVatTuMo) },
            { label: 'Kiểm kê TP mở', value: formatNumber(phieuKiemKeThanhPhamMo) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Ưu tiên" title="Việc cần làm của Thủ kho" description="Bám theo những luồng trực tiếp ảnh hưởng nhập, xuất và tồn." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow href="/ton-kho/nvl/mua-hang" title="Nhận hàng theo PO NVL" meta="Xử lý phiếu mua đang mở và ghi sổ các đợt hàng vừa về." value={formatNumber(poDangNhan)} emphasized />
              <ActionRow href="/ton-kho/nvl/mua-hang" title="Ghi sổ phiếu nhập NVL" meta="Các đợt đang còn ở nháp hoặc mới lưu số liệu." value={formatNumber(choGhiSo)} />
              <ActionRow href="/don-hang/phieu-xuat" title="Phiếu xuất hàng" meta="Theo dõi và xử lý các đợt xuất cọc thành phẩm." value="Mở" />
              <ActionRow href="/san-xuat/ke-hoach-ngay" title="Kế hoạch đã chốt" meta="Nhìn nhanh kế hoạch đã khóa để chuẩn bị vận hành kho." value={formatNumber(planRows.length)} />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Tóm tắt" title="Sức khỏe vận hành kho" description="Những chỉ số đủ để biết kho đang ùn ở nhập, xuất hay kiểm kê." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <MetricRow label="Tồn thành phẩm đang theo dõi" value={formatNumber(finishedGoodsData.summaryRows.length)} hint="Số bucket thành phẩm hiện có trong trang tồn kho." />
              <MetricRow label="Phiếu nhập NVL đã tạo" value={formatNumber(procurementData.savedReceiptRows.length)} hint="Tất cả đợt nhập đã phát sinh từ PO NVL." />
              <MetricRow label="Phiếu kiểm kê vật tư" value={formatNumber(inventoryCountData.savedSheets.length)} hint="Bao gồm phiếu đang mở và đã hoàn tất." />
              <MetricRow label="Phiếu kiểm kê cọc" value={formatNumber(finishedGoodsCountData.savedSheets.length)} hint="Theo dõi kiểm kê thành phẩm, kể cả tồn đầu kỳ." emphasized />
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Đợt nhập" title="Phiếu nhập gần đây" description="Các đợt nhập cần mở nhanh để cập nhật hoặc kiểm tra trạng thái." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {receiptRows.length ? (
                receiptRows.map((row) => (
                  <ActionRow
                    key={row.receiptId}
                    href="/ton-kho/nvl/mua-hang"
                    title={row.receiptCode}
                    meta={`${row.poCode} • Đợt ${formatNumber(row.batchNo)}`}
                    value={row.movementRecorded ? 'Đã ghi sổ' : 'Chờ ghi sổ'}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có phiếu nhập" meta="Kho chưa có đợt nhận NVL nào để thao tác." />
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Thành phẩm" title="Bucket tồn gần đây" description="Bám nhanh các loại cọc đang có tồn để phục vụ xuất hàng và đối soát." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {stockSummary.length ? (
                stockSummary.map((row) => (
                  <ActionRow
                    key={row.itemKey}
                    href="/ton-kho/thanh-pham"
                    title={row.itemLabel}
                    meta={`${row.loaiCoc} • ${row.tenDoan || 'Chưa có đoạn'}`}
                    value={formatNumber(row.physicalQty)}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có tồn thành phẩm" meta="Trang tồn kho hiện chưa có bucket cọc nào." />
              )}
            </div>
          </div>
        </div>

        <div className="border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
          <SectionTitle eyebrow="Sản xuất" title="Kế hoạch đã chốt gần đây" description="Kho nhìn nhanh để biết các lệnh vận hành đã khóa từ phía điều độ." />
          <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
            {operationalPlans.length ? (
              operationalPlans.map((item) => (
                <ActionRow
                  key={item.plan.plan_id}
                  href={`/san-xuat/ke-hoach-ngay?plan_id=${item.plan.plan_id}`}
                  title={`Kế hoạch ${formatDateLabel(item.plan.ngay_ke_hoach)}`}
                  meta={`${formatNumber(item.lineCount)} dòng • ${formatNumber(item.orderCount)} đơn`}
                  value={item.plan.trang_thai === 'DA_CHOT' ? 'Đã chốt' : 'Nháp'}
                />
              ))
            ) : (
              <NoteRow title="Chưa có kế hoạch" meta="Không có kế hoạch ngày nào để kho theo dõi." />
            )}
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (salesAccountingViewer) {
    const [baoGiaData, donHangData, planRows] = await Promise.all([
      loadBaoGiaListPageData(supabase),
      loadDonHangListPageData(supabase, { viewerRole: profile.role }),
      loadKeHoachNgayList(supabase, profile.role),
    ])

    const quotesChoDuyet = baoGiaData.rows.filter((row) => !row.productionApproved).length
    const quotesDaDuyet = baoGiaData.rows.filter((row) => row.productionApproved).length
    const plansChoChot = planRows.filter((row) => row.plan.trang_thai === 'NHAP').length
    const recentQuotes = baoGiaData.rows.slice(0, 5)
    const recentOrders = donHangData.rows.slice(0, 5)

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Điểm điều phối kế toán bán hàng"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Báo giá chờ duyệt SX', value: formatNumber(quotesChoDuyet) },
            { label: 'Báo giá đã duyệt SX', value: formatNumber(quotesDaDuyet) },
            { label: 'KHSX chờ chốt', value: formatNumber(plansChoChot) },
            { label: 'Đơn đang theo dõi', value: formatNumber(donHangData.rows.length) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Ưu tiên" title="Việc cần xử lý" description="Tập trung vào duyệt sản xuất và các đầu mối chuyển đơn sang vận hành." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow href="/don-hang/bao-gia" title="Duyệt sản xuất cho báo giá" meta="Những báo giá đã đủ thông tin để chốt chuyển sang sản xuất." value={formatNumber(quotesChoDuyet)} emphasized />
              <ActionRow href="/san-xuat/ke-hoach-ngay" title="Chốt KHSX ngày" meta="Các kế hoạch đang còn nháp, cần khóa để xuống kho." value={formatNumber(plansChoChot)} />
              <ActionRow href="/don-hang/phieu-xuat" title="Theo dõi phiếu xuất" meta="Bám luồng giao hàng và đối chiếu với các đơn đang chạy." value="Mở" />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Tóm tắt" title="Chuyển đổi từ báo giá sang đơn hàng" description="Nhìn nhanh tiến độ duyệt và số lượng đơn đang được kéo theo." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <MetricRow label="Tổng báo giá" value={formatNumber(baoGiaData.rows.length)} hint="Toàn bộ báo giá đang đọc được trong hệ thống." />
              <MetricRow label="Đơn hàng hiện có" value={formatNumber(donHangData.rows.length)} hint="Các đơn hàng phát sinh từ chuỗi báo giá - duyệt sản xuất." />
              <MetricRow label="KHSX hiện có" value={formatNumber(planRows.length)} hint="Các kế hoạch ngày nằm trong phạm vi theo dõi của role này." emphasized />
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Báo giá" title="Báo giá gần đây" description="Ưu tiên các báo giá còn chờ duyệt sản xuất hoặc mới cập nhật." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {recentQuotes.length ? (
                recentQuotes.map((row) => (
                  <ActionRow
                    key={row.quoteId}
                    href={`/don-hang/bao-gia/${row.quoteId}`}
                    title={row.maBaoGia}
                    meta={`${row.khachHang} • ${row.duAn}`}
                    value={row.productionApprovalLabel || 'Chưa duyệt SX'}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có báo giá" meta="Hệ thống chưa có báo giá nào để theo dõi." />
              )}
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Đơn hàng" title="Đơn gần đây" description="Các đơn vừa thay đổi trạng thái để bám chuỗi giao hàng." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {recentOrders.length ? (
                recentOrders.map((item) => (
                  <ActionRow
                    key={item.order.order_id}
                    href={`/don-hang/${item.order.order_id}`}
                    title={item.order.ma_order || item.order.order_id}
                    meta={`${item.khachHangName || '-'} • ${item.duAnName || '-'}`}
                    value={item.order.trang_thai_label || item.order.trang_thai}
                  />
                ))
              ) : (
                <NoteRow title="Chưa có đơn hàng" meta="Role này hiện chưa có đơn nào cần theo dõi." />
              )}
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (commercialViewer) {
    const [baoGiaData, donHangData, finishedGoodsData] = await Promise.all([
      loadBaoGiaListPageData(supabase),
      loadDonHangListPageData(supabase, { viewerRole: profile.role }),
      loadFinishedGoodsInventoryPageData(supabase, {}),
    ])

    const quotesOpen = baoGiaData.rows.filter((row) => !row.exportedAt).length
    const quotesNeedProduction = baoGiaData.rows.filter((row) => !row.productionApproved).length
    const inventoryBuckets = finishedGoodsData.summaryRows.length

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Kinh doanh và theo dõi giao hàng"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Báo giá đang mở', value: formatNumber(quotesOpen) },
            { label: 'Chờ duyệt SX', value: formatNumber(quotesNeedProduction) },
            { label: 'Đơn đang theo dõi', value: formatNumber(donHangData.rows.length) },
            { label: 'Bucket tồn TP', value: formatNumber(inventoryBuckets) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Ưu tiên" title="Việc cần làm của Kinh doanh" description="Bám báo giá, đơn hàng và khả năng giao thực tế." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow href="/don-hang/bao-gia" title="Theo dõi báo giá" meta="Các báo giá đang mở hoặc vừa cập nhật." value={formatNumber(quotesOpen)} emphasized />
              <ActionRow href="/don-hang" title="Theo dõi đơn hàng" meta="Bám trạng thái đơn để phối hợp với sản xuất và kho." value={formatNumber(donHangData.rows.length)} />
              <ActionRow href="/don-hang/phieu-xuat" title="Phiếu xuất hàng" meta="Kiểm tra luồng giao hàng và hoàn tất giao nhận." value="Mở" />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Tồn kho" title="Khả năng giao hàng hiện tại" description="Nhìn nhanh tồn thành phẩm để chủ động trao đổi với khách." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {finishedGoodsData.summaryRows.slice(0, 5).map((row) => (
                <ActionRow
                  key={row.itemKey}
                  href="/ton-kho/thanh-pham"
                  title={row.itemLabel}
                  meta={`${row.loaiCoc} • ${row.tenDoan || 'Chưa có đoạn'}`}
                  value={formatNumber(row.projectQty + row.retailQty)}
                />
              ))}
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (technicalViewer) {
    const [bocTachData, donHangData, finishedGoodsData, procurementData] = await Promise.all([
      loadBocTachListPageData({ qlsxViewer: false }),
      loadDonHangListPageData(supabase, { viewerRole: profile.role }),
      loadFinishedGoodsInventoryPageData(supabase, {}),
      loadNvlProcurementFlowPageData(supabase),
    ])

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Theo dõi kỹ thuật và đầu vào"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Bóc tách gần đây', value: formatNumber(bocTachData.rows.length) },
            { label: 'Đơn hàng đang xem', value: formatNumber(donHangData.rows.length) },
            { label: 'Bucket thành phẩm', value: formatNumber(finishedGoodsData.summaryRows.length) },
            { label: 'Mã NVL thiếu', value: formatNumber(procurementData.demandRows.filter((row) => Number(row.shortageQty || 0) > 0).length) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Đầu việc" title="Những nơi kỹ thuật cần nhìn" description="Tập trung vào bóc tách, đơn hàng và tồn để hỗ trợ triển khai." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow href="/boc-tach/boc-tach-nvl" title="Danh sách bóc tách" meta="Rà các bộ bóc tách và thông số kỹ thuật đầu vào." value={formatNumber(bocTachData.rows.length)} emphasized />
              <ActionRow href="/don-hang" title="Đơn hàng kỹ thuật đang bám" meta="Theo dõi yêu cầu kỹ thuật đi kèm từng đơn." value={formatNumber(donHangData.rows.length)} />
              <ActionRow href="/ton-kho/thanh-pham/tra-cuu-coc" title="Tra cứu mã cọc" meta="Kiểm tra nhanh tồn và thông tin serial thực tế." value="Mở" />
              <ActionRow href="/ton-kho/nvl/ton-thuc" title="Tồn thực NVL" meta="Đối chiếu nhanh khả năng đáp ứng vật tư." value="Mở" />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Cảnh báo" title="Những điểm cần lưu ý" description="Dành cho việc phối hợp kỹ thuật với sản xuất và mua hàng." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <MetricRow label="NVL đang thiếu" value={formatNumber(procurementData.demandRows.filter((row) => Number(row.shortageQty || 0) > 0).length)} hint="Các mã vật tư có shortage theo tính toán hiện tại." emphasized />
              <MetricRow label="Tồn thành phẩm có sẵn" value={formatNumber(finishedGoodsData.summaryRows.reduce((sum, row) => sum + Number(row.physicalQty || 0), 0))} hint="Tổng vật lý của bucket thành phẩm đang đọc được." />
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (inventoryCounterViewer) {
    const [inventoryCountData, finishedGoodsCountData] = await Promise.all([
      loadInventoryCountingPageData(supabase),
      loadFinishedGoodsCountingPageData(supabase),
    ])

    const openMaterialSheets = inventoryCountData.savedSheets.filter((row) => row.status !== 'DA_DIEU_CHINH_TON').length
    const openFinishedSheets = finishedGoodsCountData.savedSheets.filter((row) => row.status !== 'DA_DIEU_CHINH_TON').length

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Điều phối kiểm kê"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Phiếu vật tư mở', value: formatNumber(openMaterialSheets) },
            { label: 'Phiếu TP mở', value: formatNumber(openFinishedSheets) },
            { label: 'Danh mục vật tư', value: formatNumber(inventoryCountData.catalogOptions.length) },
            { label: 'Danh mục cọc', value: formatNumber(finishedGoodsCountData.catalogOptions.length) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Vật tư" title="Phiếu kiểm kê vật tư" description="Theo dõi phiếu đang mở và chuyển nhanh vào màn xử lý." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {inventoryCountData.savedSheets.slice(0, 5).map((row) => (
                <ActionRow
                  key={row.countSheetId}
                  href="/ton-kho/kiem-ke"
                  title={row.countSheetCode}
                  meta={`${row.countType} • ${formatDateLabel(row.countDate)}`}
                  value={row.status}
                />
              ))}
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Thành phẩm" title="Phiếu kiểm kê cọc" description="Ưu tiên các phiếu còn chờ xác nhận hoặc chờ duyệt chênh lệch." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              {finishedGoodsCountData.savedSheets.slice(0, 5).map((row) => (
                <ActionRow
                  key={row.countSheetId}
                  href="/ton-kho/thanh-pham/kiem-ke"
                  title={row.countSheetCode}
                  meta={`${row.countMode} • ${formatDateLabel(row.countDate)}`}
                  value={row.status}
                />
              ))}
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (qcViewer) {
    const qcData = await loadQcNghiemThuPageData(supabase, { viewerRole: profile.role })
    const choQc = qcData.rows.filter((row) => !row.qcConfirmed).length

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Nghiệm thu chất lượng"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Kế hoạch chờ QC', value: formatNumber(choQc) },
            { label: 'Kế hoạch đã QC', value: formatNumber(qcData.rows.filter((row) => row.qcConfirmed).length) },
            { label: 'Tổng kế hoạch QC', value: formatNumber(qcData.rows.length) },
            { label: 'Phiếu cần mở', value: formatNumber(Math.min(qcData.rows.length, 5)) },
          ]}
        />

        <div className="border-t px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
          <SectionTitle eyebrow="Nghiệm thu" title="Danh sách kế hoạch chờ QC" description="Tập trung vào các kế hoạch đã có xuất NVL nhưng QC chưa xác nhận." />
          <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
            {qcData.rows.length ? (
              qcData.rows.slice(0, 8).map((row) => (
                <ActionRow
                  key={row.plan.plan_id}
                  href={`/san-xuat/qc-nghiem-thu?plan_id=${row.plan.plan_id}`}
                  title={`Kế hoạch ${formatDateLabel(row.plan.ngay_ke_hoach)}`}
                  meta={`${formatNumber(row.lineCount)} dòng • ${formatNumber(row.orderCount)} đơn`}
                  value={row.qcConfirmed ? 'Đã QC' : 'Chờ QC'}
                />
              ))
            ) : (
              <NoteRow title="Chưa có kế hoạch QC" meta="Hiện chưa có kế hoạch nào vào hàng chờ nghiệm thu." />
            )}
          </div>
        </div>
      </UnifiedShell>
    )
  }

  if (adminViewer) {
    const { data, issue } = await guardDashboardData(() =>
      Promise.all([
        loadBaoGiaListPageData(supabase),
        loadDonHangListPageData(supabase, { viewerRole: profile.role }),
        loadNvlProcurementFlowPageData(supabase),
        loadKeHoachNgayList(supabase, profile.role),
        loadInventoryCountingPageData(supabase),
        loadFinishedGoodsCountingPageData(supabase),
      ])
    )

    if (issue || !data) {
      return <MissingSchemaDashboard subtitle={welcomeLine} roleLabel={profile.role} detail={issue || 'Dashboard test chua du schema.'} />
    }

    const [baoGiaData, donHangData, procurementData, planRows, inventoryCountData, finishedGoodsCountData] = data

    return (
      <UnifiedShell>
        <HeaderBlock
          title="Tổng quan vận hành hệ thống"
          subtitle={welcomeLine}
          metrics={[
            { label: 'Báo giá', value: formatNumber(baoGiaData.rows.length) },
            { label: 'Đơn hàng', value: formatNumber(donHangData.rows.length) },
            { label: 'PO NVL', value: formatNumber(procurementData.savedPurchaseOrderRows.length) },
            { label: 'KHSX', value: formatNumber(planRows.length) },
          ]}
        />

        <div className="grid gap-0 border-t lg:grid-cols-[1fr_1fr]" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-6 py-5 lg:border-r" style={{ borderColor: 'var(--color-border)' }}>
            <SectionTitle eyebrow="Hệ thống" title="Các luồng đang mở" description="Admin nhìn nhanh để biết luồng nào đang phát sinh nhiều việc." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <MetricRow label="Đề xuất mua NVL" value={formatNumber(procurementData.savedRequestRows.length)} />
              <MetricRow label="Receipt NVL" value={formatNumber(procurementData.savedReceiptRows.length)} />
              <MetricRow label="Kiểm kê vật tư" value={formatNumber(inventoryCountData.savedSheets.length)} />
              <MetricRow label="Kiểm kê cọc" value={formatNumber(finishedGoodsCountData.savedSheets.length)} emphasized />
            </div>
          </div>

          <div className="px-6 py-5">
            <SectionTitle eyebrow="Đi nhanh" title="Lối tắt quản trị" description="Các điểm vào chính để admin soi nhanh từng module." />
            <div className="mt-4 divide-y" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 82%, white)' }}>
              <ActionRow href="/don-hang/bao-gia" title="Báo giá" meta="Kiểm tra luồng thương mại." value={formatNumber(baoGiaData.rows.length)} />
              <ActionRow href="/don-hang" title="Đơn hàng" meta="Theo dõi state machine đơn." value={formatNumber(donHangData.rows.length)} />
              <ActionRow href="/san-xuat/ke-hoach-ngay" title="Kế hoạch sản xuất ngày" meta="Điều độ và chốt kế hoạch." value={formatNumber(planRows.length)} />
              <ActionRow href="/ton-kho/nvl/mua-hang" title="Mua hàng NVL" meta="Luồng đề xuất, PO, receipt và chốt KTMH." value={formatNumber(procurementData.savedPurchaseOrderRows.length)} />
            </div>
          </div>
        </div>
      </UnifiedShell>
    )
  }

  return <EmptyDashboard title="Tổng quan công việc" subtitle={welcomeLine} roleLabel={profile.role} />
}

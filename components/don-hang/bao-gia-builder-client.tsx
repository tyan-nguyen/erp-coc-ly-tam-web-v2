'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { QuoteEstimateSummary } from '@/lib/bao-gia/quote'
import type { BaoGiaSnapshot, BaoGiaStatus, BaoGiaVersionRow } from '@/lib/bao-gia/repository'

type AccessoryOption = {
  value: string
  label: string
  dvt: string
  price: number
}

type AccessoryDraftRow = {
  id: string
  nvlId: string
  qty: number
  unitPrice: number
  profitPct: number
  vatPct: number
}

type NoteDraft = {
  opening: string
  vatNote: string
  transportNote: string
  transportNoteTouched: boolean
  otherNote: string
  validityNote: string
  closing: string
}

type ProductPileRow = {
  kind: 'pile'
  key: string
  index: number
  specText: string
  dvt: string
  qty: number
  unitPrice: number
  unitPriceVat: number
  amount: number
  profitPct: number
  vatPct: number
}

type ProductAccessoryRow = {
  kind: 'accessory'
  key: string
  index: number
  rowId: string
  label: string
  dvt: string
  qty: number
  unitPrice: number
  unitPriceVat: number
  amount: number
  profitPct: number
  vatPct: number
}

export function BaoGiaBuilderClient(props: {
  estimates: Array<
    QuoteEstimateSummary & {
      daId: string
      khId: string
    }
  >
  sameScope: boolean
  customerName: string
  projectName: string
  transportCopy: string[]
  accessoryOptions: AccessoryOption[]
  vatConfig: {
    coc_vat_pct: number
    phu_kien_vat_pct: number
  }
  sourceEstimateIds: string[]
  initialSnapshot?: BaoGiaSnapshot | null
  quoteMeta?: {
    quoteId: string
    maBaoGia: string
    status: BaoGiaStatus
    statusLabel: string
    currentVersionNo: number
    productionApproved?: boolean
    productionApprovalLabel?: string | null
  } | null
  versions?: BaoGiaVersionRow[]
  viewingVersionNo?: number
  isHistoricalView?: boolean
  readOnly?: boolean
}) {
  const router = useRouter()
  const sanitizedTransportCopy = useMemo(
    () => props.transportCopy.map((line) => cleanTransportText(line)),
    [props.transportCopy]
  )
  const [pendingAccessory, setPendingAccessory] = useState({
    nvlId: props.accessoryOptions[0]?.value || '',
    qty: 1,
    unitPrice: Number(props.accessoryOptions[0]?.price || 0),
    profitPct: 14,
    vatPct: Number(props.vatConfig.phu_kien_vat_pct || 0),
  })
  const [accessoryRows, setAccessoryRows] = useState<AccessoryDraftRow[]>(() =>
    (props.initialSnapshot?.productRows || [])
      .filter((row) => row.kind === 'accessory')
      .map((row) => ({
        id: String(row.rowId || row.key),
        nvlId: String(row.nvlId || ''),
        qty: Number(row.qty || 0),
        unitPrice:
          Number(row.vatPct || 0) >= -100
            ? Number(row.unitPriceVat || 0) / (1 + Number(row.vatPct || 0) / 100) / (1 + Number(row.profitPct || 0) / 100)
            : Number(row.unitPrice || 0),
        profitPct: Number(row.profitPct || 0),
        vatPct: Number(row.vatPct || 0),
      }))
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [statusLabel, setStatusLabel] = useState(props.quoteMeta?.statusLabel || 'Nháp')
  const [quoteMeta, setQuoteMeta] = useState(props.quoteMeta || null)
  const [versions, setVersions] = useState<BaoGiaVersionRow[]>(props.versions || [])
  const [notes, setNotes] = useState<NoteDraft>(() => ({
    opening:
      props.initialSnapshot?.notes.opening ||
      `Kính gửi: ${props.customerName}\nCông ty TNHH MTV Gạch-Ngói-Cấu Kiện Bê tông Nguyễn Trinh rất hân hạnh được phục vụ Quý Khách và Trân trọng cảm ơn Quý Khách đã tin tưởng, quan tâm đến sản phẩm do Công ty chúng tôi sản xuất.\nCông ty chúng tôi xin báo giá đến Quý khách hàng sản phẩm cọc ống bê tông ly tâm dự ứng lực như sau:`,
    vatNote:
      props.initialSnapshot?.notes.vatNote ||
      `Giá trên đã bao gồm thuế VAT theo từng hạng mục (cọc ${Number(props.vatConfig.coc_vat_pct || 0)}%, phụ kiện ${Number(props.vatConfig.phu_kien_vat_pct || 0)}%).`,
    transportNote: props.initialSnapshot?.notes.transportNote || sanitizedTransportCopy.join('\n'),
    transportNoteTouched: Boolean(props.initialSnapshot?.notes.transportNote),
    otherNote: props.initialSnapshot?.notes.otherNote || '',
    validityNote: props.initialSnapshot?.notes.validityNote || 'Báo giá có hiệu lực trong 7 ngày kể từ ngày báo giá.',
    closing: props.initialSnapshot?.notes.closing || 'Rất hân hạnh phục vụ Quý khách hàng !',
  }))

  const derivedQuoteRows = useMemo(
    () =>
      props.estimates.map((item) => ({
        kind: 'pile' as const,
        key: item.bocId,
        specText: buildSpecText(item),
        dvt: 'md',
        qty: Number(item.tongMd || 0),
        unitPrice: roundQuoteCurrency(Number(item.donGiaBanChuaVatMd || 0)),
        unitPriceVat: roundQuoteCurrency(Number(item.donGiaBanDaVatMd || 0)),
        amount: roundQuoteCurrency(Number(item.tongGiaDaVat || 0)),
        profitPct:
          Number(item.donGiaVonMd || 0) > 0
            ? ((Number(item.donGiaBanChuaVatMd || 0) - Number(item.donGiaVonMd || 0)) /
                Number(item.donGiaVonMd || 0)) *
              100
            : Number(item.profitPct || 0),
        vatPct:
          Number(item.donGiaBanChuaVatMd || 0) > 0
            ? ((Number(item.donGiaBanDaVatMd || 0) - Number(item.donGiaBanChuaVatMd || 0)) /
                Number(item.donGiaBanChuaVatMd || 0)) *
              100
            : Number(item.vatPct || 0),
      })),
    [props.estimates]
  )

  const quoteRows = useMemo(
    () =>
      props.initialSnapshot?.productRows?.some((row) => row.kind === 'pile')
        ? props.initialSnapshot.productRows
            .filter((row) => row.kind === 'pile')
            .map((row) => ({
              kind: 'pile' as const,
              key: row.key,
              index: row.index,
              specText: String(row.specText || ''),
              dvt: row.dvt,
              qty: Number(row.qty || 0),
              unitPrice: Number(row.unitPrice || 0),
              unitPriceVat: Number(row.unitPriceVat || 0),
              amount: Number(row.amount || 0),
              profitPct: Number(row.profitPct || 0),
              vatPct: Number(row.vatPct || 0),
            }))
        : derivedQuoteRows,
    [derivedQuoteRows, props.initialSnapshot]
  )

  const accessoryComputedRows = useMemo(
    () =>
      accessoryRows.map((row, index) => {
        const option = props.accessoryOptions.find((item) => item.value === row.nvlId) || null
        const basePrice = Number(row.unitPrice || option?.price || 0)
        const salePrice = roundQuoteCurrency(basePrice * (1 + Number(row.profitPct || 0) / 100))
        const unitPriceVat = roundQuoteCurrency(salePrice * (1 + Number(row.vatPct || 0) / 100))
        return {
          kind: 'accessory' as const,
          index: quoteRows.length + index + 1,
          key: row.id,
          rowId: row.id,
          label: option?.label || 'Chưa chọn phụ kiện',
          dvt: option?.dvt || 'cái',
          qty: Number(row.qty || 0),
          unitPrice: salePrice,
          unitPriceVat,
          amount: roundQuoteCurrency(Number(row.qty || 0) * unitPriceVat),
          profitPct: Number(row.profitPct || 0),
          vatPct: Number(row.vatPct || 0),
        }
      }),
    [accessoryRows, props.accessoryOptions, quoteRows.length]
  )

  const productRows = useMemo<Array<ProductPileRow | ProductAccessoryRow>>(
    () => [
      ...quoteRows.map((item, index) => ({ ...item, index: index + 1 })),
      ...accessoryComputedRows,
    ],
    [quoteRows, accessoryComputedRows]
  )

  const totalAmount = useMemo(
    () => productRows.reduce((acc, item) => acc + Number(item.amount || 0), 0),
    [productRows]
  )
  const displayTransportNote = notes.transportNoteTouched ? notes.transportNote : sanitizedTransportCopy.join('\n')

  const currentSnapshot = useMemo<BaoGiaSnapshot>(
    () => ({
      customerName: props.customerName,
      projectName: props.projectName,
      transportMode: props.estimates[0]?.phuongThucVanChuyen || '',
      sourceEstimateIds: props.sourceEstimateIds,
      notes: {
        opening: notes.opening,
        vatNote: notes.vatNote,
        transportNote: displayTransportNote,
        otherNote: notes.otherNote,
        validityNote: notes.validityNote,
        closing: notes.closing,
      },
      productRows: productRows.map((row) =>
        row.kind === 'pile'
          ? {
              kind: 'pile',
              key: row.key,
              index: row.index,
              specText: row.specText,
              dvt: row.dvt,
              qty: row.qty,
              unitPrice: row.unitPrice,
              unitPriceVat: row.unitPriceVat,
              amount: row.amount,
              profitPct: row.profitPct,
              vatPct: row.vatPct,
            }
          : {
              kind: 'accessory',
              key: row.key,
              rowId: row.rowId,
              nvlId: accessoryRows.find((item) => item.id === row.rowId)?.nvlId || '',
              index: row.index,
              label: row.label,
              dvt: row.dvt,
              qty: row.qty,
              unitPrice: row.unitPrice,
              unitPriceVat: row.unitPriceVat,
              amount: row.amount,
              profitPct: row.profitPct,
              vatPct: row.vatPct,
            }
      ),
      totalAmount,
    }),
    [
      accessoryRows,
      displayTransportNote,
      notes.closing,
      notes.opening,
      notes.otherNote,
      notes.validityNote,
      notes.vatNote,
      productRows,
      props.customerName,
      props.estimates,
      props.projectName,
      props.sourceEstimateIds,
      totalAmount,
    ]
  )

  const currentSnapshotSignature = useMemo(() => JSON.stringify(currentSnapshot), [currentSnapshot])
  const [lastSavedSignature, setLastSavedSignature] = useState(() =>
    props.initialSnapshot ? currentSnapshotSignature : ''
  )
  useEffect(() => {
    setVersions(props.versions || [])
  }, [props.versions])

  const isDirty = currentSnapshotSignature !== lastSavedSignature
  const readOnly = Boolean(props.readOnly)
  const canExport =
    Boolean(quoteMeta?.quoteId) && !isDirty && props.sameScope && !saving && !props.isHistoricalView && !readOnly

  function addAccessoryRow() {
    if (readOnly) return
    if (!pendingAccessory.nvlId) return
    setMessage('')
    setAccessoryRows((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        nvlId: pendingAccessory.nvlId,
        qty: Number(pendingAccessory.qty || 0),
        unitPrice: Number(pendingAccessory.unitPrice || 0),
        profitPct: Number(pendingAccessory.profitPct || 0),
        vatPct: Number(pendingAccessory.vatPct || 0),
      },
    ])
    setPendingAccessory((prev) => ({
      ...prev,
      qty: 1,
    }))
  }

  function removeAccessoryRow(id: string) {
    if (readOnly) return
    setMessage('')
    setAccessoryRows((prev) => prev.filter((item) => item.id !== id))
  }

  function buildSnapshot(): BaoGiaSnapshot {
    return currentSnapshot
  }

  async function persistQuote(action: 'SAVE' | 'EXPORT') {
    if (readOnly) {
      setError('Role hiện tại chỉ được xem preview/PDF báo giá, không chỉnh sửa nội dung.')
      return null
    }
    if (props.isHistoricalView) {
      setError('Bạn đang xem version cũ. Hãy quay về version hiện tại để lưu hoặc xuất PDF.')
      return null
    }
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const snapshot = buildSnapshot()
      const printHtml = buildPrintHtml({
        customerName: props.customerName,
        projectName: props.projectName,
        productRows,
        totalAmount,
        opening: notes.opening,
        vatNote: notes.vatNote,
        transportNote: displayTransportNote,
        otherNote: notes.otherNote,
        validityNote: notes.validityNote,
        closing: notes.closing,
      })

      const response = await fetch('/api/bao-gia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: quoteMeta?.quoteId,
          action,
          snapshot,
          printHtml,
        }),
      })
      const result = (await response.json()) as {
        ok: boolean
        error?: string
        data?: { quoteId: string; maBaoGia: string; versionNo: number; status: BaoGiaStatus }
      }

      if (!response.ok || !result.ok || !result.data) {
        throw new Error(result.error || 'Không lưu được báo giá.')
      }

      const data = result.data
      const nextStatusLabel =
        action === 'SAVE' && data.status === 'NHAP'
          ? 'Đã lưu báo giá'
          : formatBaoGiaStatusLabel(data.status)
      setQuoteMeta({
        quoteId: data.quoteId,
        maBaoGia: data.maBaoGia,
        status: data.status,
        statusLabel: nextStatusLabel,
        currentVersionNo: data.versionNo,
        productionApproved: quoteMeta?.productionApproved || false,
        productionApprovalLabel: quoteMeta?.productionApprovalLabel || null,
      })
      setStatusLabel(nextStatusLabel)
      if (action === 'SAVE') {
        setLastSavedSignature(currentSnapshotSignature)
        if (quoteMeta?.quoteId) {
          const createdAt = new Date().toISOString()
          setVersions((prev) => [
            {
              version_id: `local-${data.versionNo}-${createdAt}`,
              quote_id: data.quoteId,
              version_no: data.versionNo,
              action_type: 'SAVE',
              snapshot_json: snapshot,
              print_html: null,
              tong_tien: Number(snapshot.totalAmount || 0),
              ghi_chu: null,
              exported_at: null,
              created_at: createdAt,
              created_by: null,
            },
            ...prev.filter((version) => version.version_no !== data.versionNo),
          ])
        }
      }
      setMessage(
        action === 'EXPORT'
          ? 'Đã cập nhật trạng thái xuất PDF.'
          : `Đã lưu báo giá version ${data.versionNo}. Bạn có thể xuất PDF.`
      )

      if (!props.initialSnapshot || !quoteMeta?.quoteId) {
        router.replace(`/don-hang/bao-gia/${data.quoteId}`)
      }

      return printHtml
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được báo giá.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handlePrint() {
    const html = await persistQuote('EXPORT')
    if (!html) return
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)

    const frameWindow = iframe.contentWindow
    if (!frameWindow) {
      iframe.remove()
      return
    }

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove()
      }, 300)
    }

    frameWindow.document.open()
    frameWindow.document.write(html)
    frameWindow.document.close()
    frameWindow.focus()
    frameWindow.onafterprint = cleanup
    window.setTimeout(() => {
      frameWindow.print()
    }, 150)
  }

  return (
    <div className="mx-auto max-w-7xl">
      {message ? (
        <section
          className="mb-4 rounded-2xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
            backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
            color: 'var(--color-primary)',
          }}
        >
          {message}
        </section>
      ) : null}
      {error ? <section className="mb-4 app-accent-soft rounded-2xl px-4 py-3 text-sm">{error}</section> : null}
      <section className="app-surface rounded-[28px] px-4 py-5 md:px-6 md:py-6">
        <div className="flex items-start justify-between gap-4 border-b pb-4" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <h1 className="text-2xl font-bold">Xuất báo giá PDF</h1>
            <p className="app-muted mt-2 text-sm">
              Chỉ gộp đơn khi cùng khách hàng và dự án.
            </p>
            <p className="app-muted mt-3 text-sm">
              Khách hàng: <span className="font-semibold text-[var(--color-text)]">{props.customerName}</span> · Dự án:{' '}
              <span className="font-semibold text-[var(--color-text)]">{props.projectName}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-white/70 px-3 py-1 font-semibold" style={{ color: 'var(--color-text)' }}>
                Mã báo giá: {quoteMeta?.maBaoGia || 'Chưa lưu'}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 font-semibold" style={{ color: 'var(--color-text)' }}>
                Đang xem: V{props.viewingVersionNo || quoteMeta?.currentVersionNo || 0}
              </span>
              <span className="rounded-full bg-white/70 px-3 py-1 font-semibold" style={{ color: 'var(--color-text)' }}>
                Trạng thái: {statusLabel}
              </span>
            </div>
            {props.isHistoricalView ? (
              <p className="mt-3 text-sm font-medium" style={{ color: 'var(--color-danger,#dc2626)' }}>
                Bạn đang xem version cũ. Nội dung này chỉ để tra cứu, không thể lưu hoặc xuất PDF.
              </p>
            ) : readOnly ? (
              <p className="mt-3 text-sm font-medium" style={{ color: 'var(--color-muted)' }}>
                Role hiện tại chỉ được xem preview/PDF báo giá và cập nhật kết quả kinh doanh ở danh sách.
              </p>
            ) : null}
          </div>
          <Link
            href="/boc-tach/boc-tach-nvl"
            className="app-outline rounded-2xl px-4 py-2 text-sm font-semibold transition"
          >
            Đóng
          </Link>
        </div>

        {!props.sameScope ? (
          <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
            Các dự toán đang chọn chưa cùng khách hàng, dự án hoặc phương án vận chuyển.
          </div>
        ) : null}

        <section className="mt-6">
          <h2 className="text-xl font-semibold">Danh sách sản phẩm</h2>

          <div className="mt-4 overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                  <th className="w-16 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">STT</th>
                  <th className="min-w-[360px] px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Quy cách, chủng loại</th>
                  <th className="w-20 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">ĐVT</th>
                  <th className="w-36 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Khối lượng</th>
                  <th className="w-36 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đơn giá</th>
                  <th className="w-36 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đơn giá VAT</th>
                  <th className="w-40 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {productRows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-t align-top"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
                  >
                    <td className="px-4 py-4">{row.index}</td>
                    <td className="px-4 py-4 whitespace-pre-line leading-7">
                      {row.kind === 'pile' ? (
                        <div className="space-y-2">
                          <div>{row.specText}</div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
                            <span>LN {formatCompactNumber(row.profitPct)}%</span>
                            <span>VAT {formatCompactNumber(row.vatPct)}%</span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="font-medium">{row.label}</div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-muted)]">
                            <span>LN {formatCompactNumber(row.profitPct)}%</span>
                            <span>VAT {formatCompactNumber(row.vatPct)}%</span>
                            <button
                              type="button"
                              onClick={() => removeAccessoryRow(row.rowId)}
                              disabled={props.isHistoricalView}
                              className="text-[var(--color-danger,#dc2626)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                            >
                              Xóa
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">{row.dvt}</td>
                    <td className="px-4 py-4 text-right">{formatNumber(row.qty)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrency(row.unitPrice)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrency(row.unitPriceVat)}</td>
                    <td className="px-4 py-4 text-right font-semibold">{formatCurrency(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td colSpan={6} className="px-4 py-4 text-right font-semibold">
                    Tổng:
                  </td>
                  <td className="px-4 py-4 text-right text-lg font-bold">{formatCurrency(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {!readOnly ? (
        <section className="mt-8 border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-xl font-semibold">Thêm phụ kiện bán riêng</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.8fr_auto]">
            <Field label="Chọn phụ kiện">
              <select
                value={pendingAccessory.nvlId}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  const nextId = event.target.value
                  const option = props.accessoryOptions.find((item) => item.value === nextId)
                  setMessage('')
                  setPendingAccessory((prev) => ({
                    ...prev,
                    nvlId: nextId,
                    unitPrice: Number(option?.price || 0),
                  }))
                }}
                className="app-input w-full rounded-xl px-3 py-2 text-sm"
              >
                <option value="">-- chọn phụ kiện --</option>
                {props.accessoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Số lượng">
              <input
                type="number"
                min={0}
                value={pendingAccessory.qty}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setPendingAccessory((prev) => ({ ...prev, qty: Number(event.target.value || 0) }))
                }}
                className="app-input w-full rounded-xl px-3 py-2 text-sm"
                placeholder="VD: 10"
              />
            </Field>
            <Field label="Đơn giá">
              <input
                type="number"
                min={0}
                value={pendingAccessory.unitPrice}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setPendingAccessory((prev) => ({ ...prev, unitPrice: Number(event.target.value || 0) }))
                }}
                className="app-input w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="% Lợi nhuận">
              <input
                type="number"
                min={0}
                step="0.01"
                value={pendingAccessory.profitPct}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setPendingAccessory((prev) => ({ ...prev, profitPct: Number(event.target.value || 0) }))
                }}
                className="app-input w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Thuế VAT">
              <input
                type="number"
                min={0}
                value={pendingAccessory.vatPct}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setPendingAccessory((prev) => ({ ...prev, vatPct: Number(event.target.value || 0) }))
                }}
                className="app-input w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                onClick={addAccessoryRow}
                className="app-outline w-full rounded-xl px-4 py-2 text-sm font-semibold transition"
                disabled={props.isHistoricalView}
              >
                + Thêm phụ kiện
              </button>
            </div>
          </div>
        </section>
        ) : null}

        <section className="mt-8 border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-xl font-semibold">Văn bản mở & ghi chú</h2>
          {!readOnly ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Lời mở đầu">
              <textarea
                value={notes.opening}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setNotes((prev) => ({ ...prev, opening: event.target.value }))
                }}
                className="app-input min-h-[140px] w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Ghi chú VAT">
              <textarea
                value={notes.vatNote}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setNotes((prev) => ({ ...prev, vatNote: event.target.value }))
                }}
                className="app-input min-h-[140px] w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Ghi chú vận chuyển">
              <textarea
                value={displayTransportNote}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setNotes((prev) => ({
                    ...prev,
                    transportNote: event.target.value,
                    transportNoteTouched: true,
                  }))
                }}
                className="app-input min-h-[140px] w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Ghi chú khác">
              <textarea
                value={notes.otherNote}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setNotes((prev) => ({ ...prev, otherNote: event.target.value }))
                }}
                className="app-input min-h-[140px] w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Hiệu lực báo giá">
              <textarea
                value={notes.validityNote}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setNotes((prev) => ({ ...prev, validityNote: event.target.value }))
                }}
                className="app-input min-h-[110px] w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Lời chào cuối">
              <textarea
                value={notes.closing}
                disabled={props.isHistoricalView}
                onChange={(event) => {
                  setMessage('')
                  setNotes((prev) => ({ ...prev, closing: event.target.value }))
                }}
                className="app-input min-h-[110px] w-full rounded-xl px-3 py-2 text-sm"
              />
            </Field>
          </div>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ReadOnlyField label="Lời mở đầu" value={notes.opening} />
              <ReadOnlyField label="Ghi chú VAT" value={notes.vatNote} />
              <ReadOnlyField label="Ghi chú vận chuyển" value={displayTransportNote} />
              <ReadOnlyField label="Ghi chú khác" value={notes.otherNote || '-'} />
              <ReadOnlyField label="Hiệu lực báo giá" value={notes.validityNote} />
              <ReadOnlyField label="Lời chào cuối" value={notes.closing} />
            </div>
          )}
        </section>

        {!readOnly ? (
        <div className="mt-8 flex flex-wrap justify-end gap-3 border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
          {quoteMeta?.quoteId && isDirty ? (
            <p className="mr-auto text-sm text-[var(--color-muted)]">
              Báo giá đã thay đổi, cần lưu lại trước khi xuất PDF.
            </p>
          ) : props.isHistoricalView ? (
            <p className="mr-auto text-sm text-[var(--color-muted)]">
              Đây là version cũ để tra cứu. Quay về version hiện tại để thao tác.
            </p>
          ) : quoteMeta?.quoteId ? (
            <p className="mr-auto text-sm text-[var(--color-muted)]">
              Báo giá đã lưu. Bạn có thể xuất PDF.
            </p>
          ) : (
            <p className="mr-auto text-sm text-[var(--color-muted)]">
              Lưu báo giá trước để tạo hồ sơ và quản lý version.
            </p>
          )}
          <button
            type="button"
            onClick={() => void (canExport ? handlePrint() : persistQuote('SAVE'))}
            className="app-outline rounded-2xl px-5 py-3 text-sm font-semibold transition"
            disabled={!props.sameScope || saving || Boolean(props.isHistoricalView)}
          >
            {saving ? 'Đang xử lý...' : canExport ? 'Xuất PDF' : 'Lưu báo giá'}
          </button>
        </div>
        ) : null}

        {versions.length > 0 ? (
          <section className="mt-8 border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="text-xl font-semibold">Lịch sử version</h2>
            <div className="mt-4 overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Version</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Loại</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Tổng tiền</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.version_id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-4 py-3 font-semibold">
                        {quoteMeta?.quoteId ? (
                          <Link
                            href={`/don-hang/bao-gia/${quoteMeta.quoteId}?v=${version.version_no}`}
                            className="underline-offset-2 hover:underline"
                          >
                            V{version.version_no}
                          </Link>
                        ) : (
                          <>V{version.version_no}</>
                        )}
                      </td>
                      <td className="px-4 py-3">{version.action_type === 'EXPORT' ? 'Xuất PDF' : 'Lưu báo giá'}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(Number(version.tong_tien || 0))}</td>
                      <td className="px-4 py-3">{formatDateTime(version.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </section>

    </div>
  )
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{props.label}</span>
      {props.children}
    </label>
  )
}

function ReadOnlyField(props: { label: string; value: string }) {
  return (
    <div className="block">
      <span className="mb-2 block text-sm font-semibold">{props.label}</span>
      <div className="app-input min-h-[110px] w-full rounded-xl px-3 py-2 text-sm whitespace-pre-line">
        {props.value}
      </div>
    </div>
  )
}

function buildSpecText(item: QuoteEstimateSummary) {
  const payload = item.payload
  const segments = payload.segments.filter((segment) => Number(segment.so_luong_doan || 0) > 0)
  const diameter = resolveDisplayDiameter(payload)
  const totalLength = segments.reduce((acc, segment) => {
    return acc + Number(segment.len_m || 0)
  }, 0)
  const segmentLine = expandSegmentLengths(segments)
  const steelLines = buildSteelSpecLines(payload)
  const accessoryLines = payload.items
    .filter((entry) => entry.loai_nvl === 'PHU_KIEN' && entry.ten_nvl)
    .map((entry) => `+ ${formatAccessorySpecLabel(entry.ten_nvl)}`)
  const concreteLine = formatConcreteSpecLine(item.macBeTong)

  return [
    `Cọc BTLT PC - A - D${formatCompactNumber(diameter)}`,
    `(L=${formatCompactNumber(totalLength)}m; TH:${segmentLine})`,
    ...steelLines,
    ...accessoryLines,
    concreteLine,
  ]
    .filter(Boolean)
    .join('\n')
}

function resolveDisplayDiameter(payload: QuoteEstimateSummary['payload']) {
  const direct = Number(payload.header.do_ngoai || payload.header.do_mm || 0)
  if (direct > 0) return direct
  const pileType = String(payload.header.loai_coc || '')
  const match = pileType.match(/(?:D|Ø|Φ|A)\s*(\d+(?:[.,]\d+)?)/iu)
  if (!match) return 0
  const parsed = Number(match[1].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function expandSegmentLengths(segments: QuoteEstimateSummary['payload']['segments']) {
  return segments
    .map((segment) => formatCompactNumber(Number(segment.len_m || 0)))
    .filter(Boolean)
    .join('+')
}

function buildSteelSpecLines(payload: QuoteEstimateSummary['payload']) {
  const pcNos = Number(payload.header.pc_nos || 0)
  const pcDia = formatCompactNumber(Number(payload.header.pc_dia_mm || 0))
  const daiDia = formatCompactNumber(Number(payload.header.dai_dia_mm || 0))
  const buocDia = formatCompactNumber(Number(payload.header.buoc_dia_mm || 0))
  const lines = [
    pcNos > 0 && pcDia ? `+ Thép dự ứng lực ${formatCompactNumber(pcNos)}Φ${pcDia} mm` : '',
    daiDia ? `+ Thép đai kéo nguội Φ${daiDia} mm` : '',
    buocDia ? `+ Thép buộc Φ${buocDia} mm` : '',
  ]
  return lines.filter(Boolean)
}

function formatAccessorySpecLabel(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/x(\d+)\s*LO\b/iu, 'x$1 lỗ')
    .trim()
}

function formatConcreteSpecLine(value: string | number) {
  const numeric = Number(value || 0)
  const mpa = numeric > 0 ? formatCompactNumber(numeric / 10) : String(value || '').trim()
  return mpa ? `+ Mác bê tông ${mpa} Mpa (mẫu trụ 150*300)` : ''
}

function formatCompactNumber(value: number) {
  const numeric = Number(value || 0)
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(3).replace(/\.?0+$/, '')
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0))
}

function roundQuoteCurrency(value: number) {
  if (!Number.isFinite(value)) return 0
  if (value === 0) return 0
  const sign = value < 0 ? -1 : 1
  return Math.floor(Math.abs(value) / 1000) * 1000 * sign
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatBaoGiaStatusLabel(status: BaoGiaStatus) {
  switch (status) {
    case 'DA_XUAT_PDF':
      return 'Đã xuất PDF'
    case 'DA_GUI_KHACH':
      return 'Đã gửi khách'
    case 'KH_YEU_CAU_CHINH_SUA':
      return 'Khách yêu cầu chỉnh sửa'
    case 'DA_CHOT':
      return 'Thành công'
    case 'THAT_BAI':
      return 'Thất bại'
    case 'NHAP':
    default:
      return 'Nháp'
  }
}

function cleanTransportText(value: string) {
  return String(value || '')
    .replaceAll('[VI_TRI_CONG_TRINH]:', '')
    .replaceAll('[KHU_VUC]:', '')
    .split('\n')
    .map((line) => collapseRepeatedPhrase(line.trim()))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+\./g, '.')
    .trim()
}

function collapseRepeatedPhrase(value: string) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2
    const left = words.slice(0, half).join(' ')
    const right = words.slice(half).join(' ')
    if (left.localeCompare(right, 'vi', { sensitivity: 'accent' }) === 0) {
      return left
    }
  }
  return words.join(' ')
}

function buildPrintHtml(props: {
  customerName: string
  projectName: string
  productRows: Array<ProductPileRow | ProductAccessoryRow>
  totalAmount: number
  opening: string
  vatNote: string
  transportNote: string
  otherNote: string
  validityNote: string
  closing: string
}) {
  const body = renderToStaticMarkup(<QuotePrintDocument {...props} />)
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <title>Bảng báo giá</title>
    <style>
      @page { size: A4 portrait; margin: 18mm 16mm; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #111;
        font-family: "Times New Roman", Times, serif;
      }
      body {
        font-size: 13.5px;
        line-height: 1.35;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      * { box-sizing: border-box; }
      p { margin: 0; }
      .quote-doc {
        width: 100%;
      }
      .quote-header {
        display: table;
        width: 100%;
        border-bottom: 1px solid #333;
        margin-bottom: 6px;
      }
      .quote-header-logo,
      .quote-header-meta {
        display: table-cell;
        vertical-align: top;
      }
      .quote-header-logo {
        width: 120px;
        padding-right: 10px;
      }
      .seal-mark {
        width: 92px;
        height: 92px;
        border: 2px solid #b91c1c;
        color: #b91c1c;
        border-radius: 50%;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.1;
      }
      .brand-mark {
        margin-top: 4px;
        text-align: center;
        font-size: 22px;
        font-weight: 700;
        color: #0f766e;
        line-height: 1;
      }
      .brand-sub {
        text-align: center;
        font-size: 11px;
        font-weight: 700;
        color: #0f766e;
        margin-top: 2px;
      }
      .quote-header-meta {
        padding-bottom: 6px;
      }
      .company-name {
        font-size: 14.5px;
        font-weight: 700;
        text-transform: uppercase;
        line-height: 1.2;
      }
      .company-line {
        font-size: 12.5px;
        line-height: 1.35;
        margin-top: 1px;
      }
      .quote-title {
        text-align: center;
        font-size: 17.5px;
        font-weight: 700;
        text-transform: uppercase;
        margin: 6px 0 0 0;
        line-height: 1.1;
      }
      .quote-subtitle {
        text-align: center;
        font-size: 14.5px;
        font-weight: 700;
        text-transform: uppercase;
        margin: 2px 0 0 0;
        line-height: 1.1;
      }
      .quote-date {
        text-align: right;
        font-style: italic;
        font-size: 12.5px;
        margin: 4px 0 0 0;
      }
      .quote-intro {
        margin-top: 8px;
        font-size: 13.5px;
        line-height: 1.4;
        text-align: justify;
      }
      .quote-intro p {
        margin-bottom: 2px;
      }
      .quote-intro p:last-child {
        margin-bottom: 0;
      }
      .quote-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin-top: 10px;
        border: 1px solid #333;
      }
      .quote-table th,
      .quote-table td {
        border: 1px solid #333;
        padding: 6px;
        vertical-align: top;
      }
      .quote-table th {
        background: #f5f5f5;
        text-align: center;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.15;
      }
      .quote-table td {
        font-size: 13px;
      }
      .col-stt { width: 40px; }
      .col-spec { width: auto; }
      .col-uom { width: 50px; }
      .col-qty { width: 70px; }
      .col-price { width: 90px; }
      .col-amount { width: 100px; }
      .td-center { text-align: center; }
      .td-right { text-align: right; white-space: nowrap; }
      .td-amount { text-align: right; font-weight: 700; white-space: nowrap; }
      .spec-cell {
        line-height: 1.28;
      }
      .spec-title {
        font-weight: 700;
        margin-bottom: 1px;
      }
      .spec-line {
        margin: 0;
      }
      .quote-notes {
        margin-top: 10px;
        font-size: 12.5px;
        line-height: 1.35;
      }
      .quote-note-line {
        margin-bottom: 3px;
      }
      .quote-note-line:last-child {
        margin-bottom: 0;
      }
      .quote-note-closing {
        font-weight: 600;
        margin-top: 4px;
      }
      .quote-total {
        text-align: right;
        font-size: 13.5px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>${body}</body>
</html>`
}

function QuotePrintDocument(props: {
  customerName: string
  projectName: string
  productRows: Array<ProductPileRow | ProductAccessoryRow>
  totalAmount: number
  opening: string
  vatNote: string
  transportNote: string
  otherNote: string
  validityNote: string
  closing: string
}) {
  const printDate = formatPrintDate(new Date())
  const openingLines = normalizeOpeningLines(props.opening, props.customerName)
  const noteLines = [
    props.vatNote ? `+ ${props.vatNote}` : '',
    props.otherNote ? `+ ${props.otherNote}` : '',
    props.transportNote ? `+ ${props.transportNote}` : '',
    props.validityNote ? `• ${props.validityNote}` : '',
  ].filter(Boolean)

  return (
    <div className="quote-doc">
      <div className="quote-header">
        <div className="quote-header-logo">
          <div className="seal-mark">CÔNG TY<br />NGUYỄN TRINH</div>
          <div className="brand-mark">NT</div>
          <div className="brand-sub">NGUYỄN TRINH</div>
        </div>
        <div className="quote-header-meta">
          <div className="company-name">CÔNG TY TNHH MTV GẠCH-NGÓI-CẤU KIỆN BÊ TÔNG NGUYỄN TRINH</div>
          <div className="company-line">- Địa chỉ: Lô E, đường số 6, KCN Long Đức, xã Long Đức, TP. Trà Vinh, tỉnh Trà Vinh.</div>
          <div className="company-line">- Mã số thuế: 2100622431.</div>
          <div className="company-line">- Số TK: 114000039182 tại NH TMCP Công Thương Việt Nam (VietinBank) - Chi nhánh Trà Vinh.</div>
          <div className="company-line">- Điện thoại: 0294.3840058</div>
          <div className="company-line">- Email: nguyentrinh40@yahoo.com</div>
        </div>
      </div>

      <div className="quote-title">BẢNG BÁO GIÁ</div>
      <div className="quote-subtitle">CỌC ỐNG BÊ TÔNG LY TÂM DỰ ỨNG LỰC</div>
      <div className="quote-date">{printDate}</div>

      <div className="quote-intro">
        <p><strong>Kính gửi: {props.customerName}</strong></p>
        {openingLines.map((line, index) => (
          <p key={`opening-${index}`}>{line}</p>
        ))}
      </div>

      <table className="quote-table">
        <colgroup>
          <col className="col-stt" />
          <col className="col-spec" />
          <col className="col-uom" />
          <col className="col-qty" />
          <col className="col-price" />
          <col className="col-amount" />
        </colgroup>
          <thead>
            <tr>
              <th>STT</th>
              <th>Quy cách, chủng loại</th>
              <th>ĐVT</th>
              <th>Khối lượng</th>
              <th>Đơn giá (VND)</th>
              <th>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {props.productRows.map((row) => (
              <tr key={`print-${row.key}`}>
                <td className="td-center">{row.index}</td>
                <td className="spec-cell">
                  {row.kind === 'pile' ? (
                    <PrintPileSpec specText={row.specText} />
                  ) : (
                    <div>
                      <div className="spec-title">{row.label}</div>
                    </div>
                  )}
                </td>
                <td className="td-center">{row.dvt}</td>
                <td className="td-right">{formatNumber(row.qty)}</td>
                <td className="td-right">{formatCurrency(row.unitPriceVat)}</td>
                <td className="td-amount">{formatCurrency(row.amount)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} className="quote-total">Tổng cộng</td>
              <td className="td-amount">{formatCurrency(props.totalAmount)}</td>
            </tr>
          </tbody>
      </table>

      <div className="quote-notes">
        {noteLines.map((line, index) => (
          <div key={`note-${index}`} className="quote-note-line">
            {line}
          </div>
        ))}
        {props.closing.trim() ? <div className="quote-note-line quote-note-closing">{props.closing}</div> : null}
      </div>
    </div>
  )
}

function PrintPileSpec(props: { specText: string }) {
  const lines = String(props.specText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  return (
    <div>
      <div className="spec-title">{lines[0]}</div>
      {lines.slice(1).map((line, index) => (
        <div key={`spec-${index}`} className="spec-line">
          {line}
        </div>
      ))}
    </div>
  )
}

function normalizeOpeningLines(value: string, customerName: string) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => {
      if (index > 0) return true
      const normalized = line.replace(/\s+/g, ' ').trim().toLowerCase()
      const greeting = `kính gửi: ${String(customerName || '').replace(/\s+/g, ' ').trim().toLowerCase()}`
      return normalized !== greeting
    })
}

function formatPrintDate(date: Date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `Trà Vinh, ngày ${day} tháng ${month} năm ${year}`
}

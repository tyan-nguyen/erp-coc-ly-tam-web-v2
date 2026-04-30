'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RowData } from '@/lib/master-data/crud-utils'

type TemplateFieldsProps = {
  steelOptions: RowData[]
  accessoryOptions: RowData[]
  macOptions: string[]
  cuongDoOptions: string[]
  macThepOptions: string[]
  donKepOptions: Array<{ value: string; label: string }>
  initialValues?: Record<string, string>
  readOnly?: boolean
  showSourceField?: boolean
  codePreviewOverride?: string
}

export function DmCocTemplateFields({
  steelOptions,
  accessoryOptions,
  macOptions,
  cuongDoOptions,
  macThepOptions,
  donKepOptions,
  initialValues,
  readOnly = false,
  showSourceField = false,
  codePreviewOverride,
}: TemplateFieldsProps) {
  const [doNgoai, setDoNgoai] = useState(initialValues?.do_ngoai ?? '')
  const [chieuDay, setChieuDay] = useState(initialValues?.chieu_day ?? '')
  const [macThep, setMacThep] = useState(initialValues?.mac_thep ?? '')
  const [cuongDo, setCuongDo] = useState(normalizeCuongDo(initialValues?.cuong_do ?? initialValues?.loai_coc))
  const [macBeTong, setMacBeTong] = useState(initialValues?.mac_be_tong ?? '')

  const loaiCocPreview = useMemo(
    () => buildLoaiCocPreview(cuongDo, macThep, doNgoai, chieuDay),
    [chieuDay, cuongDo, doNgoai, macThep]
  )
  const maCocPreview = useMemo(
    () => codePreviewOverride?.trim() || buildMaCocPreview(macBeTong, macThep, doNgoai, chieuDay),
    [chieuDay, codePreviewOverride, doNgoai, macBeTong, macThep]
  )
  const accessoryGroups = useMemo(() => {
    const matBich: RowData[] = []
    const mangXong: RowData[] = []
    const tapVuong: RowData[] = []
    const muiCoc: RowData[] = []

    for (const item of accessoryOptions) {
      const kind = inferAccessoryKind(item)
      if (kind === 'MAT_BICH') matBich.push(item)
      else if (kind === 'MANG_XONG') mangXong.push(item)
      else if (kind === 'TAM_VUONG') tapVuong.push(item)
      else if (kind === 'MUI_COC_LIEN' || kind === 'MUI_COC_ROI') muiCoc.push(item)
    }

    return {
      matBich,
      mangXong,
      tapVuong,
      muiCoc,
    }
  }, [accessoryOptions])

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <PreviewField label="Loại cọc sẽ tạo" value={loaiCocPreview} />
        <PreviewField label="Mã cọc dự kiến" value={maCocPreview} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Field label="Nguồn mẫu" className={showSourceField ? undefined : 'hidden'}>
        <select
          name="template_scope"
          defaultValue={initialValues?.template_scope ?? 'FACTORY'}
          disabled={readOnly || !showSourceField}
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        >
          <option value="FACTORY">Nhà máy</option>
          <option value="CUSTOM">Khách phát sinh</option>
        </select>
      </Field>
      <Field label="ĐK ngoài (mm)">
        <input
          type="text"
          inputMode="numeric"
          name="do_ngoai"
          required
          value={doNgoai}
          onChange={(event) => setDoNgoai(event.target.value)}
          readOnly={readOnly}
          placeholder="Nhập ĐK ngoài -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <Field label="Mác thép">
        <select
          name="mac_thep"
          required
          value={macThep}
          onChange={(event) => setMacThep(event.target.value)}
          disabled={readOnly}
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        >
          <option value="">-- Chọn mác thép -- bắt buộc</option>
          {macThepOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cường độ">
        <select
          name="cuong_do"
          required
          value={cuongDo}
          onChange={(event) => setCuongDo(event.target.value)}
          disabled={readOnly}
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        >
          <option value="">-- Chọn cường độ -- bắt buộc</option>
          {cuongDoOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Thành cọc (mm)">
        <input
          type="text"
          inputMode="numeric"
          name="chieu_day"
          required
          value={chieuDay}
          onChange={(event) => setChieuDay(event.target.value)}
          readOnly={readOnly}
          placeholder="Nhập thành cọc -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <Field label="Mác BT">
        <select
          name="mac_be_tong"
          required
          value={macBeTong}
          onChange={(event) => setMacBeTong(event.target.value)}
          disabled={readOnly}
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        >
          <option value="">-- Chọn mác bê tông -- bắt buộc</option>
          {macOptions.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>
      <NvlSelectField label="Thép PC" name="pc_nvl_id" options={steelOptions} defaultValue={initialValues?.pc_nvl_id ?? ''} required readOnly={readOnly} />
      <Field label="Số thanh PC">
        <input
          type="text"
          inputMode="numeric"
          name="pc_nos"
          required
          defaultValue={initialValues?.pc_nos ?? ''}
          readOnly={readOnly}
          placeholder="Nhập số thanh PC -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <NvlSelectField label="Thép đai (mm)" name="dai_nvl_id" options={steelOptions} defaultValue={initialValues?.dai_nvl_id ?? ''} required readOnly={readOnly} />
      <Field label="Đơn/kép">
        <select name="don_kep_factor" required defaultValue={initialValues?.don_kep_factor ?? ''} disabled={readOnly} className="app-input w-full rounded-xl px-3 py-3 text-sm">
          <option value="">-- Chọn đơn/kép -- bắt buộc</option>
          {donKepOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <NvlSelectField label="Thép buộc (mm)" name="buoc_nvl_id" options={steelOptions} defaultValue={initialValues?.buoc_nvl_id ?? ''} required readOnly={readOnly} />
      <Field label="A1_mm">
        <input
          type="text"
          inputMode="numeric"
          name="a1_mm"
          required
          defaultValue={initialValues?.a1_mm ?? ''}
          readOnly={readOnly}
          placeholder="Nhập A1_mm -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <Field label="A2_mm">
        <input type="text" inputMode="numeric" name="a2_mm" defaultValue={initialValues?.a2_mm ?? '0'} readOnly={readOnly} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
      </Field>
      <Field label="A3_mm">
        <input
          type="text"
          inputMode="numeric"
          name="a3_mm"
          required
          defaultValue={initialValues?.a3_mm ?? ''}
          readOnly={readOnly}
          placeholder="Nhập A3_mm -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <Field label="PctA1">
        <input
          type="text"
          inputMode="decimal"
          step="0.001"
          name="p1_pct"
          required
          defaultValue={initialValues?.p1_pct ?? ''}
          readOnly={readOnly}
          placeholder="Nhập PctA1 -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <Field label="PctA2">
        <input type="text" inputMode="decimal" step="0.001" name="p2_pct" defaultValue={initialValues?.p2_pct ?? '0'} readOnly={readOnly} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
      </Field>
      <Field label="PctA3">
        <input
          type="text"
          inputMode="decimal"
          step="0.001"
          name="p3_pct"
          required
          defaultValue={initialValues?.p3_pct ?? ''}
          readOnly={readOnly}
          placeholder="Nhập PctA3 -- bắt buộc"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <NvlSelectField label="Mặt bích" name="mat_bich_nvl_id" options={accessoryGroups.matBich} defaultValue={initialValues?.mat_bich_nvl_id ?? ''} required readOnly={readOnly} />
      <NvlSelectField label="Măng xông" name="mang_xong_nvl_id" options={accessoryGroups.mangXong} defaultValue={initialValues?.mang_xong_nvl_id ?? ''} required readOnly={readOnly} />
      <NvlSelectField label="Táp vuông" name="tap_nvl_id" options={accessoryGroups.tapVuong} defaultValue={initialValues?.tap_nvl_id ?? ''} required readOnly={readOnly} />
      <NvlSelectField label="Mũi cọc" name="mui_coc_nvl_id" options={accessoryGroups.muiCoc} defaultValue={initialValues?.mui_coc_nvl_id ?? ''} required readOnly={readOnly} />
      <Field label="Khối lượng kg/md">
        <input
          type="text"
          inputMode="decimal"
          step="0.001"
          name="khoi_luong_kg_md"
          defaultValue={initialValues?.khoi_luong_kg_md ?? ''}
          readOnly={readOnly}
          placeholder="Thông số tham khảo"
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
      </Field>
      <Field label="Ghi chú" className="xl:col-span-4">
        <textarea name="ghi_chu" rows={3} defaultValue={initialValues?.ghi_chu ?? ''} readOnly={readOnly} className="app-input w-full rounded-xl px-3 py-3 text-sm" />
      </Field>
      </div>
    </div>
  )
}

function NvlSelectField({
  label,
  name,
  options,
  defaultValue,
  required = false,
  readOnly = false,
}: {
  label: string
  name: string
  options: RowData[]
  defaultValue: string
  required?: boolean
  readOnly?: boolean
}) {
  const optionMap = useMemo(
    () =>
      options.map((item) => ({
        id: String(item.nvl_id ?? ''),
        label: String(item.ten_hang ?? ''),
      })),
    [options]
  )
  const initialLabel = optionMap.find((item) => item.id === defaultValue)?.label ?? ''
  const [query, setQuery] = useState(initialLabel)
  const [selectedId, setSelectedId] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [showAllOptions, setShowAllOptions] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  const filteredOptions = useMemo(() => {
    if (showAllOptions) return optionMap.slice(0, 12)
    const keyword = normalizeAccessorySearch(query)
    if (!keyword) return optionMap.slice(0, 12)
    return optionMap.filter((item) => normalizeAccessorySearch(item.label).includes(keyword)).slice(0, 12)
  }, [optionMap, query, showAllOptions])

  return (
    <Field label={label}>
      <input type="hidden" name={name} value={selectedId} />
      <div ref={containerRef} className="relative">
        <input
          type="text"
          value={query}
          required={required}
          readOnly={readOnly}
          placeholder="Tìm hoặc chọn vật tư -- bắt buộc"
          onFocus={() => {
            if (readOnly) return
            setShowAllOptions(true)
            setOpen(true)
          }}
          onChange={(event) => {
            if (readOnly) return
            const nextValue = event.target.value
            setQuery(nextValue)
            setShowAllOptions(false)
            const exactMatch = optionMap.find(
              (item) => normalizeAccessorySearch(item.label) === normalizeAccessorySearch(nextValue)
            )
            setSelectedId(exactMatch?.id ?? '')
            setOpen(true)
          }}
          className="app-input w-full rounded-xl px-3 py-3 text-sm"
        />
        {open && !readOnly ? (
          <div
            className="absolute z-20 mt-2 max-h-60 w-full overflow-auto rounded-xl border shadow-lg"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            {filteredOptions.length === 0 ? (
              <div className="app-muted px-3 py-2 text-sm">Không có vật tư phù hợp.</div>
            ) : (
              filteredOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    setQuery(item.label)
                    setSelectedId(item.id)
                    setShowAllOptions(false)
                    setOpen(false)
                  }}
                  className="block w-full px-3 py-2 text-left text-sm transition hover:app-primary-soft"
                >
                  {item.label}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Field>
  )
}

function normalizeCuongDo(value: string | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized.startsWith('PHC')) return 'PHC'
  if (normalized.startsWith('PC')) return 'PC'
  return normalized
}

type AccessoryKind = 'MAT_BICH' | 'MANG_XONG' | 'MUI_COC_ROI' | 'MUI_COC_LIEN' | 'TAM_VUONG' | ''

function normalizeAccessorySearch(value: string) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function inferAccessoryKind(item: RowData): AccessoryKind {
  const source = `${String(item.ma_nvl ?? '')} ${String(item.ten_hang ?? '')}`.toUpperCase()
  if (source.includes('PK-MB') || source.includes('MẶT BÍCH') || source.includes('MAT BICH')) return 'MAT_BICH'
  if (source.includes('PK-MX') || source.includes('MĂNG XÔNG') || source.includes('MANG XONG')) return 'MANG_XONG'
  if (source.includes('PK-MCR') || source.includes('MŨI CỌC RỜI') || source.includes('MUI COC ROI')) return 'MUI_COC_ROI'
  if (source.includes('PK-MCL') || source.includes('MŨI CỌC LIỀN') || source.includes('MUI COC LIEN')) return 'MUI_COC_LIEN'
  if (source.includes('PK-TV') || source.includes('TẤM VUÔNG') || source.includes('TAM VUONG')) return 'TAM_VUONG'
  return ''
}

function normalizeMacThep(value: string | undefined) {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['A', 'B', 'C'].includes(normalized)) return normalized
  const fromLoai = normalized.match(/-\s*([ABC])\d+/)
  return fromLoai?.[1] ?? ''
}

function buildLoaiCocPreview(
  cuongDo: string | undefined,
  macThep: string | undefined,
  doNgoai: string | undefined,
  chieuDay: string | undefined
) {
  const normalizedCuongDo = normalizeCuongDo(cuongDo)
  const normalizedMacThep = normalizeMacThep(macThep)
  const diameter = String(doNgoai ?? '').trim()
  const thickness = String(chieuDay ?? '').trim()
  if (!normalizedCuongDo || !normalizedMacThep || !diameter || !thickness) return '-'
  return `${normalizedCuongDo} - ${normalizedMacThep}${diameter} - ${thickness}`
}

function buildMaCocPreview(
  macBeTong: string | undefined,
  macThep: string | undefined,
  doNgoai: string | undefined,
  chieuDay: string | undefined
) {
  const mac = String(macBeTong ?? '').trim()
  const normalizedMacThep = normalizeMacThep(macThep)
  const diameter = String(doNgoai ?? '').trim()
  const thickness = String(chieuDay ?? '').trim()
  if (!mac || !normalizedMacThep || !diameter || !thickness) return '-'
  return `M${mac} - ${normalizedMacThep}${diameter} - ${thickness} - ?`
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={className ?? ''}>
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  )
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span className="mb-2 block text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        {label}
      </span>
      <div
        className="rounded-xl px-3 py-3 text-sm font-semibold"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-primary) 24%, var(--color-border))',
          backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
          color: 'var(--color-primary)',
          minHeight: '52px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {value || '-'}
      </div>
    </label>
  )
}

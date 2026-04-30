import { computeBocTachPreview } from '@/lib/boc-tach/calc'
import type {
  BocTachDetailPayload,
  BocTachPreview,
  BocTachReferenceData,
  MaterialReference,
} from '@/lib/boc-tach/types'

export type QuoteEstimateSummary = {
  bocId: string
  loaiCoc: string
  macBeTong: string
  phuongThucVanChuyen: BocTachDetailPayload['header']['phuong_thuc_van_chuyen']
  tongMd: number
  donGiaVonMd: number
  donGiaBanChuaVatMd: number
  donGiaBanDaVatMd: number
  tongGiaChuaVat: number
  tongGiaDaVat: number
  tongVat: number
  profitPct: number
  vatPct: number
  preview: BocTachPreview
  payload: BocTachDetailPayload
}

function sumBy<T>(items: T[], iteratee: (item: T) => number) {
  return items.reduce((acc, item) => acc + iteratee(item), 0)
}

function resolveConcreteLabel(payload: BocTachDetailPayload) {
  const grade = String(payload.header.mac_be_tong || '').trim()
  return grade ? `Bê tông M${grade}` : 'Bê tông'
}

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function resolveTargetDiameter(payload: BocTachDetailPayload) {
  const direct = Number(payload.header.do_ngoai || payload.header.do_mm || 0)
  if (Number.isFinite(direct) && direct > 0) return direct

  const pileType = String(payload.header.loai_coc || '')
  const explicitMatch = pileType.match(/(?:A|D|Ø|Φ)\s*(\d+(?:[.,]\d+)?)/iu)
  if (explicitMatch) {
    const parsed = Number(explicitMatch[1].replace(',', '.'))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const looseDigits = pileType.match(/\d+(?:[.,]\d+)?/g)
  if (!looseDigits || looseDigits.length === 0) return 0
  const parsed = Number(looseDigits[0].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function accessoryKindFromName(value: string | null | undefined) {
  const normalized = normalizeText(value)
  if (normalized.includes('MAT BICH')) return 'mat_bich'
  if (normalized.includes('MANG XONG') || normalized.includes('MANGXONG')) return 'mang_xong'
  if (normalized.includes('MUI COC')) return 'mui_coc'
  if (
    normalized.includes('TAP') ||
    normalized.includes('TAM VUONG') ||
    normalized.includes('TAMVUONG') ||
    normalized.includes('TAP VUONG') ||
    normalized.includes('TAPVUONG')
  ) {
    return 'tap'
  }
  return null
}

function buildMaterialPriceMap(materials: MaterialReference[]) {
  return new Map(materials.map((item) => [item.nvl_id, Number(item.don_gia_hien_hanh || 0)]))
}

function resolveSteelLabel(
  payload: BocTachDetailPayload,
  refs: BocTachReferenceData,
  kind: 'pc' | 'dai' | 'buoc'
) {
  const normalizedKind = kind.toUpperCase()
  const selected = payload.items.find((item) => {
    if (item.loai_nvl !== 'THEP') return false
    const normalizedName = normalizeText(item.ten_nvl)
    if (kind === 'pc') return normalizedName.includes('PC')
    if (kind === 'dai') return normalizedName.includes('DAI')
    return normalizedName.includes('BUOC')
  })
  if (selected?.ten_nvl) return selected.ten_nvl
  const diameter =
    kind === 'pc'
      ? Number(payload.header.pc_dia_mm || 0)
      : kind === 'dai'
        ? Number(payload.header.dai_dia_mm || 0)
        : Number(payload.header.buoc_dia_mm || 0)
  const matched = refs.materials.find((item) => {
    if (normalizeText(item.nhom_hang) !== 'THEP') return false
    const normalizedName = normalizeText(item.ten_hang)
    return normalizedName.includes(normalizedKind) && normalizedName.includes(String(diameter))
  })
  return matched?.ten_hang || ''
}

function resolveAccessoryLabel(
  payload: BocTachDetailPayload,
  refs: BocTachReferenceData,
  kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap'
) {
  const selected = payload.items.find((item) => {
    if (item.loai_nvl !== 'PHU_KIEN') return false
    return accessoryKindFromName(item.ten_nvl) === kind
  })
  if (selected?.ten_nvl) return selected.ten_nvl
  return ''
}

function computeProfitPct(payload: BocTachDetailPayload, refs: BocTachReferenceData, totalMd: number) {
  const targetDiameter = resolveTargetDiameter(payload)
  const matchedRules = refs.profitRules
    .filter((item) => Number(item.duong_kinh_mm || 0) === targetDiameter)
    .sort((left, right) => left.min_md - right.min_md)
  if (matchedRules.length === 0) return 0
  const exactRule =
    [...matchedRules].reverse().find((item) => totalMd >= Number(item.min_md || 0)) ?? matchedRules[0]
  return Number(exactRule.loi_nhuan_pct || 0)
}

function computeOtherCostPerMd(payload: BocTachDetailPayload, refs: BocTachReferenceData) {
  const targetDiameter = resolveTargetDiameter(payload)
  const matched = refs.otherCostsByDiameter.find(
    (item) => Number(item.duong_kinh_mm || 0) === targetDiameter
  )
  return Number(matched?.tong_chi_phi_vnd_md || 0)
}

export function buildQuoteEstimateSummary(
  payload: BocTachDetailPayload,
  refs: BocTachReferenceData
): QuoteEstimateSummary {
  const preview = computeBocTachPreview(payload, refs)
  const materialPriceMap = buildMaterialPriceMap(refs.materials)

  const concreteTotalAmount = preview.concrete_mix_materials.reduce((acc, item) => {
    return acc + item.qty * Number(materialPriceMap.get(item.nvl_id) || 0)
  }, 0)
  const concreteUnitPrice =
    preview.concrete_total_m3 > 0 ? concreteTotalAmount / preview.concrete_total_m3 : 0

  const selectedAccessoryIds = {
    mat_bich:
      payload.items.find((item) => item.loai_nvl === 'PHU_KIEN' && accessoryKindFromName(item.ten_nvl) === 'mat_bich')
        ?.nvl_id || '',
    mang_xong:
      payload.items.find((item) => item.loai_nvl === 'PHU_KIEN' && accessoryKindFromName(item.ten_nvl) === 'mang_xong')
        ?.nvl_id || '',
    mui_coc:
      payload.items.find((item) => item.loai_nvl === 'PHU_KIEN' && accessoryKindFromName(item.ten_nvl) === 'mui_coc')
        ?.nvl_id || '',
    tap:
      payload.items.find((item) => item.loai_nvl === 'PHU_KIEN' && accessoryKindFromName(item.ten_nvl) === 'tap')
        ?.nvl_id || '',
  }

  const mainRows = [
    { key: 'main:concrete', label: resolveConcreteLabel(payload), qty: preview.concrete_total_m3, price: concreteUnitPrice },
    {
      key: 'main:pc',
      label: resolveSteelLabel(payload, refs, 'pc'),
      qty: preview.pc_total_kg,
      price:
        Number(
          materialPriceMap.get(
            payload.items.find((item) => item.loai_nvl === 'THEP' && normalizeText(item.ten_nvl).includes('PC'))?.nvl_id ||
              ''
          ) || 0
        ),
    },
    {
      key: 'main:dai',
      label: resolveSteelLabel(payload, refs, 'dai'),
      qty: preview.dai_total_kg,
      price:
        Number(
          materialPriceMap.get(
            payload.items.find((item) => item.loai_nvl === 'THEP' && normalizeText(item.ten_nvl).includes('DAI'))?.nvl_id ||
              ''
          ) || 0
        ),
    },
    {
      key: 'main:buoc',
      label: resolveSteelLabel(payload, refs, 'buoc'),
      qty: preview.thep_buoc_kg,
      price:
        Number(
          materialPriceMap.get(
            payload.items.find((item) => item.loai_nvl === 'THEP' && normalizeText(item.ten_nvl).includes('BUOC'))?.nvl_id ||
              ''
          ) || 0
        ),
    },
  ].filter((item) => item.qty > 0)

  const accessoryRows = [
    { key: 'pk:mat_bich', label: resolveAccessoryLabel(payload, refs, 'mat_bich'), qty: preview.phu_kien.mat_bich, price: Number(materialPriceMap.get(selectedAccessoryIds.mat_bich) || 0) },
    { key: 'pk:mang_xong', label: resolveAccessoryLabel(payload, refs, 'mang_xong'), qty: preview.phu_kien.mang_xong, price: Number(materialPriceMap.get(selectedAccessoryIds.mang_xong) || 0) },
    { key: 'pk:mui_coc', label: resolveAccessoryLabel(payload, refs, 'mui_coc'), qty: preview.phu_kien.mui_coc, price: Number(materialPriceMap.get(selectedAccessoryIds.mui_coc) || 0) },
    { key: 'pk:tap', label: resolveAccessoryLabel(payload, refs, 'tap'), qty: preview.phu_kien.tap, price: Number(materialPriceMap.get(selectedAccessoryIds.tap) || 0) },
  ].filter((item) => item.qty > 0)

  const auxiliaryRows = preview.auxiliary_materials
    .filter((item) => item.qty > 0)
    .map((item) => ({
      key: `aux:${item.nvl_id}`,
      label: item.ten_nvl,
      qty: item.qty,
      price: Number(materialPriceMap.get(item.nvl_id) || 0),
    }))

  const allMaterialRows = [...mainRows, ...accessoryRows, ...auxiliaryRows]
  const totalMaterialCost = sumBy(allMaterialRows, (item) => item.qty * item.price)
  const totalMd = Number(payload.header.total_md || preview.segment_snapshots.reduce((acc, seg) => acc + seg.len_m * seg.so_luong_doan, 0))
  const otherCostAmount = totalMd * computeOtherCostPerMd(payload, refs)
  const transportAmount = Number(preview.van_chuyen.phi_van_chuyen || 0)
  const subtotal = totalMaterialCost + otherCostAmount + transportAmount
  const savedProfitPct = Number(payload.header.profit_pct || 0)
  const computedProfitPct = computeProfitPct(payload, refs, totalMd)
  const appliedProfitPct = savedProfitPct > 0 ? savedProfitPct : computedProfitPct
  const profitAmount = subtotal * (appliedProfitPct / 100)
  const tongGiaChuaVat = subtotal + profitAmount
  const savedVatPct = Number(payload.header.tax_pct || 0)
  const computedVatPct = Number(refs.vatConfig.coc_vat_pct || 0)
  const appliedVatPct = savedVatPct > 0 ? savedVatPct : computedVatPct
  const tongVat = tongGiaChuaVat * (appliedVatPct / 100)
  const tongGiaDaVat = tongGiaChuaVat + tongVat
  const donGiaVonMd = totalMd > 0 ? subtotal / totalMd : 0
  const donGiaBanChuaVatMd = totalMd > 0 ? tongGiaChuaVat / totalMd : 0
  const donGiaBanDaVatMd = totalMd > 0 ? tongGiaDaVat / totalMd : 0
  const profitPct =
    donGiaVonMd > 0 ? ((donGiaBanChuaVatMd - donGiaVonMd) / donGiaVonMd) * 100 : appliedProfitPct
  const vatPct =
    donGiaBanChuaVatMd > 0 ? ((donGiaBanDaVatMd - donGiaBanChuaVatMd) / donGiaBanChuaVatMd) * 100 : appliedVatPct

  return {
    bocId: String(payload.bocId || ''),
    loaiCoc: payload.header.loai_coc,
    macBeTong: payload.header.mac_be_tong,
    phuongThucVanChuyen: payload.header.phuong_thuc_van_chuyen,
    tongMd: totalMd,
    donGiaVonMd,
    donGiaBanChuaVatMd,
    donGiaBanDaVatMd,
    tongGiaChuaVat,
    tongGiaDaVat,
    tongVat,
    profitPct,
    vatPct,
    preview,
    payload,
  }
}

export function getTransportQuoteCopy(mode: BocTachDetailPayload['header']['phuong_thuc_van_chuyen'], projectLabel: string) {
  switch (mode) {
    case 'ROAD_NO_CRANE':
      return [
        'Giá trên không bao gồm: Chi phí làm mặt bằng, chi phí cẩu hạ, chi phí dời cọc, chi phí thí nghiệm uốn, phá hủy, dọc trục, mối nối, hóa vật liệu,.. và các chi phí thí nghiệm tại phòng thí nghiệm độc lập.',
        `Giá trên bao gồm chi phí vận chuyển đến công trình tại ${projectLabel}. (Bảo đảm xe vận chuyển giao hàng có tải trọng từ 30 đến 33 tấn/chuyến hàng).`,
      ]
    case 'ROAD_WITH_CRANE':
      return [
        'Giá trên không bao gồm: Chi phí làm mặt bằng, chi phí dời cọc, chi phí thí nghiệm uốn, phá hủy, dọc trục, mối nối, hóa vật liệu,.. và các chi phí thí nghiệm tại phòng thí nghiệm độc lập.',
        `Giá trên bao gồm chi phí vận chuyển, cẩu hạ xuống đến công trình tại ${projectLabel}. (Bảo đảm xe vận chuyển giao hàng có tải trọng từ 30 đến 33 tấn/chuyến hàng).`,
      ]
    case 'WATERWAY':
      return [
        'Giá trên không bao gồm: Chi phí làm mặt bằng, cẩu hạ, chi phí dời cọc, chi phí thí nghiệm uốn, phá hủy, dọc trục, mối nối, hóa vật liệu,.. và các chi phí thí nghiệm tại phòng thí nghiệm độc lập.',
        'Giá trên bao gồm: chi phí vận chuyển đến cập mạn công trình bằng đường thuỷ. Bên mua đảm bảo đường thuỷ, bến cảng cho phép tàu theo tải trọng được yêu cầu tiếp cận.',
      ]
    case 'OTHER':
    default:
      return [
        'Giá trên không bao gồm: Chi phí làm mặt bằng, chi phí vận chuyển và cẩu hạ, chi phí dời cọc, chi phí thí nghiệm uốn, phá hủy, dọc trục, mối nối, hóa vật liệu,.. và các chi phí thí nghiệm tại phòng thí nghiệm độc lập.',
        'Địa điểm nhận hàng: lô E, khu công nghiệp Long Đức, phường Long Đức, tỉnh Vĩnh Long.',
      ]
  }
}

import type {
  AuxiliaryMaterialPreview,
  AuxiliaryMaterialReference,
  BocTachDetailPayload,
  BocTachItemInput,
  BocTachPreview,
  BocTachReferenceData,
  BocTachSegmentInput,
  ConcreteMixMaterialPreview,
  ConcreteMixReference,
  PileTemplateReference,
  SegmentNvlSnapshot,
  TechPreview,
} from '@/lib/boc-tach/types'

const PI = Math.PI
const FIXED_SEGMENT_ORDER = ['MUI', 'THAN_1', 'THAN_2', 'THAN_3', 'THAN_4', 'THAN_5'] as const

function round3(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0
}

function createEmptySegment(ten_doan: string): BocTachSegmentInput {
  return {
    ten_doan,
    len_m: 0,
    cnt: 0,
    so_luong_doan: 0,
    the_tich_m3: 0,
    v1: 0,
    v2: 0,
    v3: 0,
    mui_segments: ten_doan === 'MUI' ? 0 : 0,
    dai_kep_chi_a1: true,
    a1_mm: 0,
    a2_mm: 0,
    a3_mm: 0,
    p1_pct: 0,
    p2_pct: 0,
    p3_pct: 0,
    don_kep_factor: 1,
  }
}

const ROAD_TRANSPORT_PROFILE = {
  maxKg: 30000,
  widthM: 2.35,
  heightM: 2.5,
  lengthM: 12,
} as const

function sumBy<T>(rows: T[], fn: (row: T) => number): number {
  return rows.reduce((acc, row) => acc + fn(row), 0)
}

function normalizeConcreteGradeKey(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
}

function extractConcreteGradeNumber(value: string | null | undefined): number | null {
  const digits = String(value || '').match(/\d+(?:[.,]\d+)?/g)
  if (!digits || digits.length === 0) return null
  const normalized = Number(digits[digits.length - 1].replace(',', '.'))
  return Number.isFinite(normalized) ? normalized : null
}

function matchesConcreteGrade(left: string, right: string): boolean {
  const leftKey = normalizeConcreteGradeKey(left)
  const rightKey = normalizeConcreteGradeKey(right)
  if (leftKey === rightKey) return true

  const leftNo = extractConcreteGradeNumber(leftKey)
  const rightNo = extractConcreteGradeNumber(rightKey)
  if (leftNo == null || rightNo == null) return false
  return leftNo === rightNo
}

function normalizeConcreteMixVariant(value: string | null | undefined): string {
  const normalized = normalizeText(value).replace(/\s+/g, '_')
  return normalized || 'FULL_XI_TRO_XI'
}

function roundRingCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function parseMaterialDiameter(value: string): number {
  const normalized = normalizeText(value)
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function findMaterialByLabel(
  materials: Array<{ nvl_id: string; ten_hang: string; dvt?: string; nhom_hang?: string }>,
  label: string | null | undefined
) {
  const target = normalizeText(label || '')
  if (!target) return null
  return materials.find((item) => normalizeText(item.ten_hang) === target) || null
}

function findSteelMaterialByDiameter(
  materials: Array<{ nvl_id: string; ten_hang: string; dvt?: string; nhom_hang?: string }>,
  kind: 'pc' | 'dai' | 'buoc',
  diameter: number | null | undefined
) {
  const target = Number(diameter || 0)
  if (!Number.isFinite(target) || target <= 0) return null
  const token = kind === 'pc' ? 'PC' : kind === 'dai' ? 'DAI' : 'BUOC'
  return (
    materials.find((item) => {
      const normalizedName = normalizeText(item.ten_hang)
      const normalizedGroup = normalizeText(item.nhom_hang || '')
      return (
        normalizedGroup === 'THEP' &&
        normalizedName.includes(token) &&
        parseMaterialDiameter(item.ten_hang) === target
      )
    }) || null
  )
}

function accessoryKindFromName(value: string | null | undefined) {
  const normalized = normalizeText(value || '')
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

function resolveAccessoryKindForItem(
  item: BocTachDetailPayload['items'][number],
  materials: BocTachReferenceData['materials']
) {
  if (item.loai_nvl !== 'PHU_KIEN') return null
  const kindFromName = accessoryKindFromName(item.ten_nvl)
  if (kindFromName) return kindFromName
  if (!item.nvl_id) return null
  const material = materials.find((row) => row.nvl_id === item.nvl_id)
  return material ? accessoryKindFromName(material.ten_hang) : null
}

function hasAccessorySelection(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap'
) {
  return items.some((item) => resolveAccessoryKindForItem(item, materials) === kind)
}

function calcSegmentConcrete(seg: BocTachSegmentInput, doMm: number, tMm: number): number {
  const di = doMm - 2 * tMm
  const sM2 = (PI * (doMm ** 2 - di ** 2)) / 4 * 1e-6
  return sM2 * seg.len_m * getSegmentCount(seg)
}

function getSegmentCount(seg: BocTachSegmentInput): number {
  const bySegmentField = Number(seg.so_luong_doan || 0)
  if (bySegmentField > 0) return bySegmentField
  return Number(seg.cnt || 0)
}

function getSegmentStepRatio(seg: BocTachSegmentInput, key: 'p1_pct' | 'p2_pct' | 'p3_pct'): number {
  const raw = Number(seg[key] || 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return raw > 1 ? raw / 100 : raw
}

function deriveRingCount(seg: BocTachSegmentInput) {
  const lenMm = Number(seg.len_m || 0) * 1000
  const p1 = getSegmentStepRatio(seg, 'p1_pct')
  const p2 = getSegmentStepRatio(seg, 'p2_pct')
  const p3Raw = getSegmentStepRatio(seg, 'p3_pct')
  const p3 = p3Raw > 0 ? p3Raw : Math.max(0, 1 - 2 * p1 - 2 * p2)

  const a1 = Number(seg.a1_mm || 0)
  const a2 = Number(seg.a2_mm || 0)
  const a3 = Number(seg.a3_mm || 0)

  const fallbackV1 = Number(seg.v1 || 0)
  const fallbackV2 = Number(seg.v2 || 0)
  const fallbackV3 = Number(seg.v3 || 0)

  const hasStructuredFormula = a1 > 0 || a2 > 0 || a3 > 0 || p1 > 0 || p2 > 0 || p3 > 0
  const hasA1Formula = hasStructuredFormula || a1 > 0 || p1 > 0
  const hasA2Formula = hasStructuredFormula || a2 > 0 || p2 > 0
  const hasA3Formula = hasStructuredFormula || a3 > 0 || p3 > 0

  const baseV1 = hasA1Formula
    ? a1 > 0 && p1 > 0
      ? roundRingCount((2 * p1 * lenMm) / a1 + 2)
      : 0
    : fallbackV1
  const derivedV2 = hasA2Formula
    ? a2 > 0 && p2 > 0
      ? roundRingCount((2 * p2 * lenMm) / a2)
      : 0
    : fallbackV2
  const derivedV3 = hasA3Formula
    ? a3 > 0 && p3 > 0
      ? roundRingCount((lenMm - 2 * p1 * lenMm - 2 * p2 * lenMm) / a3)
      : 0
    : fallbackV3

  const donKepFactor = Math.max(1, Number(seg.don_kep_factor || 1))
  const derivedV1 = baseV1 * donKepFactor
  const tong_vong_dai = derivedV1 + derivedV2 + derivedV3

  return {
    v1: derivedV1,
    v2: derivedV2,
    v3: derivedV3,
    tong_vong_dai,
  }
}

function resolveConcreteMixRows(
  refs: BocTachReferenceData,
  macBeTong: string,
  variant: string
): ConcreteMixReference[] {
  void variant
  const gradeMatches = refs.concreteMixes.filter((row) => matchesConcreteGrade(row.mac_be_tong, macBeTong))
  const defaultVariantRows = gradeMatches.filter(
    (row) => normalizeConcreteMixVariant(row.variant) === 'FULL_XI_TRO_XI'
  )
  if (defaultVariantRows.length > 0) {
    return defaultVariantRows
  }
  return gradeMatches
}

function buildConcreteMixPreview(
  concreteM3: number,
  rows: ConcreteMixReference[]
): ConcreteMixMaterialPreview[] {
  return rows.map((row) => ({
    nvl_id: row.nvl_id,
    ten_nvl: row.ten_nvl,
    dvt: row.dvt,
    dinh_muc_m3: round3(row.dinh_muc_m3),
    qty: round3(concreteM3 * row.dinh_muc_m3),
  }))
}

function aggregateConcreteMixPreview(
  snapshots: SegmentNvlSnapshot[]
): ConcreteMixMaterialPreview[] {
  const bucket = new Map<string, ConcreteMixMaterialPreview>()

  for (const snapshot of snapshots) {
    for (const item of snapshot.cap_phoi_items) {
      const key = `${item.nvl_id}:${item.dvt}`
      const prev = bucket.get(key)
      if (prev) {
        prev.qty = round3(prev.qty + item.qty)
        continue
      }
      bucket.set(key, { ...item })
    }
  }

  return Array.from(bucket.values()).sort((a, b) => a.ten_nvl.localeCompare(b.ten_nvl))
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function matchesAuxiliaryGroup(
  row: AuxiliaryMaterialReference,
  payload: BocTachDetailPayload
): boolean {
  const group = normalizeText(row.nhom_d || '')
  if (!group || group === 'ALL' || group === '*') return true

  const doNgoai = Math.round(Number(payload.header.do_ngoai || payload.header.do_mm || 0))
  const chieuDay = Math.round(Number(payload.header.chieu_day || payload.header.t_mm || 0))
  const diameterThicknessKey = normalizeText(
    doNgoai > 0 && chieuDay > 0 ? `${doNgoai}|${chieuDay}` : ''
  )
  const diameterOnlyKey = normalizeText(doNgoai > 0 ? String(doNgoai) : '')
  const legacyPair = parseLegacyAuxiliaryGroup(group)

  if (diameterThicknessKey && group === diameterThicknessKey) return true
  if (
    legacyPair &&
    legacyPair.doNgoai === doNgoai &&
    legacyPair.chieuDay === chieuDay
  ) {
    return true
  }
  if (diameterOnlyKey && group === diameterOnlyKey) return true

  return false
}

function parseLegacyAuxiliaryGroup(value: string) {
  const match = value.match(/(?:PC|PHC)\s*-\s*[ABC](\d+)\s*-\s*(\d+)/i)
  if (!match) return null
  const doNgoai = Number(match[1] || 0)
  const chieuDay = Number(match[2] || 0)
  if (!Number.isFinite(doNgoai) || doNgoai <= 0 || !Number.isFinite(chieuDay) || chieuDay <= 0) {
    return null
  }
  return { doNgoai, chieuDay }
}

function buildAuxiliaryPreview(
  seg: BocTachSegmentInput,
  payload: BocTachDetailPayload,
  refs: BocTachReferenceData
): AuxiliaryMaterialPreview[] {
  const totalMd = Number(seg.len_m || 0) * getSegmentCount(seg)
  if (totalMd <= 0) return []

  return refs.auxiliaryRates
    .filter((row) => matchesAuxiliaryGroup(row, payload) && Number(row.dinh_muc || 0) > 0)
    .map((row) => ({
      nvl_id: row.nvl_id,
      ten_nvl: row.ten_nvl,
      nhom_d: row.nhom_d,
      dvt: row.dvt,
      dinh_muc: round3(row.dinh_muc),
      qty: round3(row.dinh_muc * totalMd),
    }))
}

function aggregateAuxiliaryPreview(
  snapshots: SegmentNvlSnapshot[]
): AuxiliaryMaterialPreview[] {
  const bucket = new Map<string, AuxiliaryMaterialPreview>()

  for (const snapshot of snapshots) {
    for (const item of snapshot.auxiliary_items) {
      if (Number(item.dinh_muc || 0) <= 0 || Number(item.qty || 0) <= 0) {
        continue
      }
      const key = `${item.nvl_id}:${item.dvt}:${item.nhom_d}`
      const prev = bucket.get(key)
      if (prev) {
        prev.qty = round3(prev.qty + item.qty)
        continue
      }
      bucket.set(key, { ...item })
    }
  }

  return Array.from(bucket.values()).sort((a, b) => a.ten_nvl.localeCompare(b.ten_nvl))
}

export function applyPileTemplate(
  payload: BocTachDetailPayload,
  template: PileTemplateReference,
  refs?: Pick<BocTachReferenceData, 'materials'>
): BocTachDetailPayload {
  const nextItems = payload.items.filter(
    (item) => item.loai_nvl !== 'PHU_KIEN' && item.loai_nvl !== 'THEP'
  )
  const materials = refs?.materials ?? []
  const materialMap = new Map(materials.map((item) => [item.nvl_id, item]))
  const pcMaterial =
    (template.pc_nvl_id ? materialMap.get(template.pc_nvl_id) : null) ??
    findMaterialByLabel(materials, template.pc_label) ??
    findSteelMaterialByDiameter(materials, 'pc', template.pc_dia_mm)
  const daiMaterial =
    (template.dai_nvl_id ? materialMap.get(template.dai_nvl_id) : null) ??
    findMaterialByLabel(materials, template.dai_label) ??
    findSteelMaterialByDiameter(materials, 'dai', template.dai_dia_mm)
  const buocMaterial =
    (template.buoc_nvl_id ? materialMap.get(template.buoc_nvl_id) : null) ??
    findMaterialByLabel(materials, template.buoc_label) ??
    findSteelMaterialByDiameter(materials, 'buoc', template.buoc_dia_mm)
  const steelCandidates = [
    { material: pcMaterial, dvtFallback: 'kg' },
    { material: daiMaterial, dvtFallback: 'kg' },
    { material: buocMaterial, dvtFallback: 'kg' },
  ]
  for (const candidate of steelCandidates) {
    if (!candidate.material) continue
    nextItems.push({
      nvl_id: candidate.material.nvl_id,
      ten_nvl: candidate.material.ten_hang,
      loai_nvl: 'THEP',
      so_luong: 0,
      dvt: candidate.material.dvt || candidate.dvtFallback,
      don_gia: 0,
    })
  }
  const accessoryCandidates = [
    (template.mat_bich_nvl_id ? materialMap.get(template.mat_bich_nvl_id) : null) ??
      findMaterialByLabel(materials, template.mat_bich_label),
    (template.mang_xong_nvl_id ? materialMap.get(template.mang_xong_nvl_id) : null) ??
      findMaterialByLabel(materials, template.mang_xong_label),
    (template.tap_nvl_id ? materialMap.get(template.tap_nvl_id) : null) ??
      findMaterialByLabel(materials, template.tap_label),
    (template.mui_coc_nvl_id ? materialMap.get(template.mui_coc_nvl_id) : null) ??
      findMaterialByLabel(materials, template.mui_coc_label),
  ]

  for (const material of accessoryCandidates) {
    if (!material) continue
    nextItems.push({
      nvl_id: material.nvl_id,
      ten_nvl: material.ten_hang,
      loai_nvl: 'PHU_KIEN',
      so_luong: 0,
      dvt: material.dvt || 'cai',
      don_gia: 0,
    })
  }

  const normalizedSegments = FIXED_SEGMENT_ORDER.map((segmentName) => {
    const existingSegment = payload.segments.find((segment) => segment.ten_doan === segmentName)
    return existingSegment ?? createEmptySegment(segmentName)
  })

  return {
    ...payload,
    header: {
      ...payload.header,
      ma_coc: template.ma_coc || payload.header.ma_coc,
      loai_coc: template.loai_coc || payload.header.loai_coc,
      mac_be_tong: template.mac_be_tong || payload.header.mac_be_tong,
      cap_phoi_variant: payload.header.cap_phoi_variant,
      do_ngoai: template.do_ngoai ?? payload.header.do_ngoai,
      chieu_day: template.chieu_day ?? payload.header.chieu_day,
      kg_md: template.kg_md ?? payload.header.kg_md,
      do_mm: template.do_ngoai ?? payload.header.do_mm,
      t_mm: template.chieu_day ?? payload.header.t_mm,
      loai_thep: pcMaterial?.ten_hang || payload.header.loai_thep,
      pc_dia_mm:
        template.pc_dia_mm ??
        (pcMaterial ? parseMaterialDiameter(pcMaterial.ten_hang) : undefined) ??
        payload.header.pc_dia_mm,
      pc_nos: template.pc_nos ?? payload.header.pc_nos,
      dai_dia_mm:
        template.dai_dia_mm ??
        (daiMaterial ? parseMaterialDiameter(daiMaterial.ten_hang) : undefined) ??
        payload.header.dai_dia_mm,
      buoc_dia_mm:
        template.buoc_dia_mm ??
        (buocMaterial ? parseMaterialDiameter(buocMaterial.ten_hang) : undefined) ??
        payload.header.buoc_dia_mm,
      dtam_mm: template.dtam_mm ?? payload.header.dtam_mm,
    },
    segments: normalizedSegments.map((segment) => ({
      ...segment,
      a1_mm: template.a1_mm ?? segment.a1_mm ?? 0,
      a2_mm: template.a2_mm ?? segment.a2_mm ?? 0,
      a3_mm: template.a3_mm ?? segment.a3_mm ?? 0,
      p1_pct: template.p1_pct ?? segment.p1_pct ?? 0,
      p2_pct: template.p2_pct ?? segment.p2_pct ?? 0,
      p3_pct: template.p3_pct ?? segment.p3_pct ?? 0,
      don_kep_factor: template.don_kep_factor ?? segment.don_kep_factor ?? 1,
    })),
    items: nextItems,
  }
}

function calcSegmentSnapshot(
  seg: BocTachSegmentInput,
  payload: BocTachDetailPayload,
  refs: BocTachReferenceData
): SegmentNvlSnapshot {
  const h = payload.header
  const doMm = h.do_ngoai || h.do_mm
  const tMm = h.chieu_day || h.t_mm
  const segmentCount = getSegmentCount(seg)

  const concrete_m3 = calcSegmentConcrete(seg, doMm, tMm)

  const kgPerMPC = 7.85 * PI * h.pc_dia_mm ** 2 / 4 / 1000
  const pc_kg = kgPerMPC * seg.len_m * h.pc_nos * segmentCount

  const kgPerMDai = 7.85 * PI * h.dai_dia_mm ** 2 / 4 / 1000
  const ringLenM = PI * (h.dtam_mm + h.pc_dia_mm + h.dai_dia_mm) / 1000
  const kgPerRing = kgPerMDai * ringLenM
  const ringMetrics = deriveRingCount(seg)
  const ringCount = ringMetrics.tong_vong_dai
  const dai_kg = kgPerRing * ringCount * segmentCount

  const kgPerMBuoc = 7.85 * PI * h.buoc_dia_mm ** 2 / 4 / 1000
  const thep_buoc_kg = h.pc_nos * 3 * 2 * kgPerMBuoc * segmentCount

  const hasMuiCocSelection = hasAccessorySelection(payload.items, refs.materials, 'mui_coc')
  const muiCount =
    hasMuiCocSelection && segmentCount > 0 && Number(seg.len_m || 0) > 0
      ? Number(seg.mui_segments || 0)
      : 0
  const hasTapSelection = hasAccessorySelection(payload.items, refs.materials, 'tap')
  const mat_bich = 2 * segmentCount
  const mang_xong = 2 * segmentCount
  const mui_coc = muiCount
  const tap = hasTapSelection ? muiCount : 0
  const capPhoiRows = resolveConcreteMixRows(refs, h.mac_be_tong, h.cap_phoi_variant)
  const cap_phoi_items = buildConcreteMixPreview(concrete_m3, capPhoiRows)
  const auxiliary_items = buildAuxiliaryPreview(seg, payload, refs)

  return {
    ten_doan: seg.ten_doan,
    len_m: Number(seg.len_m || 0),
    so_luong_doan: segmentCount,
    v1: ringMetrics.v1,
    v2: ringMetrics.v2,
    v3: ringMetrics.v3,
    tong_vong_dai: ringMetrics.tong_vong_dai,
    concrete_m3: round3(concrete_m3),
    pc_kg: round3(pc_kg),
    dai_kg: round3(dai_kg),
    thep_buoc_kg: round3(thep_buoc_kg),
    mat_bich,
    mang_xong,
    mui_coc,
    tap,
    tong_phu_kien: round3(mat_bich + mang_xong + mui_coc + tap),
    cap_phoi_items,
    auxiliary_items,
  }
}

export function calcTechPreview(payload: BocTachDetailPayload): TechPreview {
  const h = payload.header
  const doMm = h.do_ngoai || h.do_mm
  const tMm = h.chieu_day || h.t_mm
  const fMm = h.pc_dia_mm
  const nos = h.pc_nos
  const di_mm = doMm - 2 * tMm
  const dp_mm = di_mm + tMm
  const d_mm = dp_mm
  const sigma_cu = h.sigma_cu
  const sigma_bt = 0.1 * h.sigma_cu
  const sigma_cp = h.sigma_cu * h.r
  const sigma_t = 0.1 * sigma_cp
  const sigma_pu = 1420
  const sigma_py = 1275
  const ep = 200000
  const es = 0.00015
  const y = 2
  const k = 0.025
  const ec = 4500 * Math.sqrt(Math.max(h.sigma_cu, 0))
  const ecp = ec * (0.4 + 0.6 * h.r)
  const n1 = ep / Math.max(ecp, 1)
  const n = ep / Math.max(ec, 1)
  const ao = (PI / 4) * (doMm ** 2 - di_mm ** 2)
  const ap = nos * (PI * fMm ** 2) / 4
  const ac = ao - ap
  const ic = (PI / 64) * (doMm ** 4 - di_mm ** 4)
  const is = ap * (dp_mm / 2) ** 2
  const ie = ic + n * is
  const ze = (2 * ie) / Math.max(doMm, 1)
  const sigma_pi = Math.min(0.9 * sigma_pu, 0.7 * sigma_py)
  const sigma_pt = ((1 - k / 2) * sigma_pi) / (1 + n1 * (ap / Math.max(ac, 1)))
  const sigma_cpt = (sigma_pt * ap) / Math.max(ac, 1)
  const d_sig_py =
    (n * y * sigma_cpt + ep * es) /
    (1 + n * (sigma_cpt / Math.max(sigma_pt, 1e-9)) * (1 + 0.5 * y))
  const d_sig_r = (k / 2) * sigma_pt
  const sigma_pe = sigma_pt - d_sig_py - d_sig_r
  const sigma_ce = (sigma_pe * ap) / Math.max(ac, 1)
  const ra_l_kn =
    sigma_cu < 80
      ? ((sigma_cu - sigma_ce) * ao) / 4 / 1000
      : (((sigma_cu / 3.5) - sigma_ce / 4) * ao) / 1000
  const ra_s_kn = 2 * ra_l_kn
  const ra_l = ra_l_kn / 9.81
  const ra_s = ra_s_kn / 9.81
  const mcr_knm = (ze * (sigma_bt + sigma_ce)) / 1_000_000
  const mcr = mcr_knm / 9.81

  return {
    do_mm: round3(doMm),
    t_mm: round3(tMm),
    f_mm: round3(fMm),
    nos: round3(nos),
    di_mm: round3(di_mm),
    dp_mm: round3(dp_mm),
    d_mm: round3(d_mm),
    sigma_cu: round3(sigma_cu),
    sigma_bt: round3(sigma_bt),
    sigma_cp: round3(sigma_cp),
    sigma_t: round3(sigma_t),
    sigma_pu: round3(sigma_pu),
    sigma_py: round3(sigma_py),
    ep: round3(ep),
    es: round3(es),
    y: round3(y),
    k: round3(k),
    ec: round3(ec),
    ecp: round3(ecp),
    n1: round3(n1),
    n: round3(n),
    ao: round3(ao),
    ap: round3(ap),
    ac: round3(ac),
    ic: round3(ic),
    is: round3(is),
    ie: round3(ie),
    ze: round3(ze),
    sigma_pi: round3(sigma_pi),
    sigma_pt: round3(sigma_pt),
    sigma_cpt: round3(sigma_cpt),
    d_sig_py: round3(d_sig_py),
    d_sig_r: round3(d_sig_r),
    sigma_pe: round3(sigma_pe),
    sigma_ce: round3(sigma_ce),
    ra_l_kn: round3(ra_l_kn),
    ra_s_kn: round3(ra_s_kn),
    ra_l: round3(ra_l),
    ra_s: round3(ra_s),
    mcr_knm: round3(mcr_knm),
    mcr: round3(mcr),
  }
}

function buildOneTimSegmentLengths(payload: BocTachDetailPayload) {
  return payload.segments
    .flatMap((segment) => {
      const count = Math.max(0, Number(segment.cnt || 0))
      const length = Number(segment.len_m || 0)
      if (count <= 0 || length <= 0) return [] as number[]
      return Array.from({ length: count }, () => length)
    })
    .sort((left, right) => right - left)
}

function formatTransportValue(value: number, suffix = '') {
  const rounded = round3(value)
  if (!Number.isFinite(rounded)) return `0${suffix}`
  return `${String(rounded)}${suffix}`
}

function deriveMdPerTimFromSegments(payload: BocTachDetailPayload) {
  return round3(
    payload.segments.reduce((acc, segment) => {
      const count = Math.max(0, Number(segment.cnt || 0))
      const length = Number(segment.len_m || 0)
      if (count <= 0 || length <= 0) return acc
      return acc + count * length
    }, 0)
  )
}

function deriveTotalMdFromSegments(payload: BocTachDetailPayload) {
  return round3(
    payload.segments.reduce((acc, segment) => {
      return acc + Number(segment.len_m || 0) * Number(segment.so_luong_doan || 0)
    }, 0)
  )
}

function packSegmentLengths(lengths: number[], slotCount: number, slotLengthM: number) {
  if (slotCount <= 0 || slotLengthM <= 0) return null
  const slots = Array.from({ length: slotCount }, () => slotLengthM)

  for (const length of lengths) {
    if (length <= 0 || length > slotLengthM) return null
    let placed = false
    for (let index = 0; index < slots.length; index += 1) {
      if (slots[index] + 1e-9 >= length) {
        slots[index] -= length
        placed = true
        break
      }
    }
    if (!placed) return null
  }

  return slots
}

function computeRoadMdPerTrip(payload: BocTachDetailPayload) {
  const doMm = Number(payload.header.do_ngoai || payload.header.do_mm || 0)
  const kgPerMd = Number(payload.header.kg_md || 0)
  const mdPerTim = deriveMdPerTimFromSegments(payload)
  if (doMm <= 0 || kgPerMd <= 0 || mdPerTim <= 0) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'ĐK ngoài', value: formatTransportValue(doMm, ' mm') },
        { label: 'Khối lượng', value: formatTransportValue(kgPerMd, ' kg/md') },
        { label: 'Md/tim', value: formatTransportValue(mdPerTim) },
        { label: 'Kết luận', value: 'Thiếu dữ liệu đầu vào để tính tự động' },
      ],
    }
  }

  const diameterM = doMm / 1000
  const base = Math.floor(ROAD_TRANSPORT_PROFILE.widthM / diameterM)
  if (base <= 0 || ROAD_TRANSPORT_PROFILE.heightM < diameterM) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'ĐK ngoài', value: formatTransportValue(doMm, ' mm') },
        { label: 'Cọc đáy/1 hàng', value: String(base) },
        { label: 'Chiều cao xe', value: formatTransportValue(ROAD_TRANSPORT_PROFILE.heightM, ' m') },
        { label: 'Kết luận', value: 'Kích thước cọc vượt khả năng xếp xe' },
      ],
    }
  }

  const layerHeight = (Math.sqrt(3) / 2) * diameterM
  const layersByHeight =
    1 + Math.floor((ROAD_TRANSPORT_PROFILE.heightM - diameterM) / Math.max(layerHeight, 0.0001))
  const layers = Math.min(base, Math.max(0, layersByHeight))
  if (layers <= 0) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'Cọc đáy/1 hàng', value: String(base) },
        { label: 'Số tầng theo cao', value: String(layersByHeight) },
        { label: 'Số tầng dùng thực tế', value: String(layers) },
        { label: 'Kết luận', value: 'Không đủ tầng xếp cọc' },
      ],
    }
  }

  const slotCount = Math.floor((layers * (2 * base - (layers - 1))) / 2)
  if (slotCount <= 0) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'Số tầng dùng thực tế', value: String(layers) },
        { label: 'Tổng slot', value: String(slotCount) },
        { label: 'Kết luận', value: 'Không tạo được slot xếp cọc' },
      ],
    }
  }

  const mdCapByWeight = Math.floor(ROAD_TRANSPORT_PROFILE.maxKg / kgPerMd)
  if (mdCapByWeight <= 0) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'Tải trọng xe', value: formatTransportValue(ROAD_TRANSPORT_PROFILE.maxKg, ' kg') },
        { label: 'Khối lượng', value: formatTransportValue(kgPerMd, ' kg/md') },
        { label: 'Md giới hạn theo tải', value: String(mdCapByWeight) },
        { label: 'Kết luận', value: 'Vượt tải ngay từ 1 md' },
      ],
    }
  }

  const oneTimLengths = buildOneTimSegmentLengths(payload)
  if (oneTimLengths.length === 0) {
    return {
      mdPerTrip: 0,
      details: [{ label: 'Kết luận', value: 'Chưa có đoạn cọc để tính vận chuyển' }],
    }
  }
  if (oneTimLengths.some((length) => length > ROAD_TRANSPORT_PROFILE.lengthM)) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'Chiều dài thùng', value: formatTransportValue(ROAD_TRANSPORT_PROFILE.lengthM, ' m') },
        { label: 'Đoạn dài nhất', value: formatTransportValue(Math.max(...oneTimLengths), ' m') },
        { label: 'Kết luận', value: 'Có đoạn cọc dài hơn thùng xe' },
      ],
    }
  }

  const maxEvenByWeight = Math.floor(mdCapByWeight / mdPerTim)
  let evenTim = 0
  let packedSlots: number[] | null = null

  for (let candidate = maxEvenByWeight; candidate >= 0; candidate -= 1) {
    const lengths = Array.from({ length: candidate }).flatMap(() => oneTimLengths)
    const packed = packSegmentLengths(lengths, slotCount, ROAD_TRANSPORT_PROFILE.lengthM)
    if (packed) {
      evenTim = candidate
      packedSlots = packed
      break
    }
  }

  if (!packedSlots) {
    return {
      mdPerTrip: 0,
      details: [
        { label: 'Md/tim', value: formatTransportValue(mdPerTim) },
        { label: 'Md giới hạn theo tải', value: String(mdCapByWeight) },
        { label: 'Tim chẵn tối đa theo tải', value: String(maxEvenByWeight) },
        { label: 'Kết luận', value: 'Không pack được số tim chẵn nào vào xe' },
      ],
    }
  }

  const evenMd = evenTim * mdPerTim
  const mdRemainByWeight = Math.max(0, mdCapByWeight - evenMd)
  if (mdRemainByWeight <= 0) {
    return {
      mdPerTrip: round3(evenMd),
      details: [
        { label: 'ĐK ngoài', value: formatTransportValue(doMm, ' mm') },
        { label: 'Khối lượng', value: formatTransportValue(kgPerMd, ' kg/md') },
        { label: 'Md/tim', value: formatTransportValue(mdPerTim) },
        { label: 'Tải trọng xe', value: formatTransportValue(ROAD_TRANSPORT_PROFILE.maxKg, ' kg') },
        { label: 'Md giới hạn theo tải', value: String(mdCapByWeight) },
        { label: 'Cọc đáy/1 hàng', value: String(base) },
        { label: 'Số tầng dùng thực tế', value: String(layers) },
        { label: 'Tổng slot', value: String(slotCount) },
        { label: 'Tim chẵn tối đa', value: String(evenTim) },
        { label: 'Md chẵn tim', value: formatTransportValue(evenMd) },
        { label: 'Md lẻ nhét thêm', value: '0' },
        { label: 'Md/chuyến', value: formatTransportValue(evenMd) },
      ],
    }
  }

  const remainingSlots = [...packedSlots]
  let extraMd = 0
  for (const length of oneTimLengths) {
    if (extraMd + length > mdRemainByWeight + 1e-9) continue
    for (let index = 0; index < remainingSlots.length; index += 1) {
      if (remainingSlots[index] + 1e-9 >= length) {
        remainingSlots[index] -= length
        extraMd += length
        break
      }
    }
  }

  const mdPerTrip = round3(evenMd + extraMd)
  return {
    mdPerTrip,
    details: [
      { label: 'ĐK ngoài', value: formatTransportValue(doMm, ' mm') },
      { label: 'Khối lượng', value: formatTransportValue(kgPerMd, ' kg/md') },
      { label: 'Md/tim', value: formatTransportValue(mdPerTim) },
      { label: 'Tải trọng xe', value: formatTransportValue(ROAD_TRANSPORT_PROFILE.maxKg, ' kg') },
      { label: 'Md giới hạn theo tải', value: String(mdCapByWeight) },
      { label: 'Cọc đáy/1 hàng', value: String(base) },
      { label: 'Bước xếp tam giác', value: formatTransportValue(layerHeight, ' m') },
      { label: 'Số tầng theo cao', value: String(layersByHeight) },
      { label: 'Số tầng dùng thực tế', value: String(layers) },
      { label: 'Tổng slot', value: String(slotCount) },
      { label: 'Tim chẵn tối đa', value: String(evenTim) },
      { label: 'Md chẵn tim', value: formatTransportValue(evenMd) },
      { label: 'Md còn theo tải', value: formatTransportValue(mdRemainByWeight) },
      { label: 'Md lẻ nhét thêm', value: formatTransportValue(extraMd) },
      { label: 'Md/chuyến', value: formatTransportValue(mdPerTrip) },
    ],
  }
}

export function computeBocTachPreview(
  payload: BocTachDetailPayload,
  refs: BocTachReferenceData = {
    concreteMixes: [],
    auxiliaryRates: [],
    pileTemplates: [],
    customers: [],
    projects: [],
    materials: [],
    vatConfig: {
      coc_vat_pct: 0,
      phu_kien_vat_pct: 0,
    },
    profitRules: [],
    otherCostsByDiameter: [],
  }
): BocTachPreview {
  const h = payload.header
  const segments = payload.segments
  const items = payload.items
  const derivedMdPerTim = deriveMdPerTimFromSegments(payload)
  const derivedTotalMd = deriveTotalMdFromSegments(payload)

  const segment_snapshots = segments.map((seg) => calcSegmentSnapshot(seg, payload, refs))
  const totalSegments = sumBy(segment_snapshots, (seg) => seg.so_luong_doan)
  const totalMuiSegments = sumBy(segment_snapshots, (seg) => seg.mui_coc)

  const concrete_total_m3 = sumBy(segment_snapshots, (seg) => seg.concrete_m3)
  const pc_total_kg = sumBy(segment_snapshots, (seg) => seg.pc_kg)
  const dai_total_kg = sumBy(segment_snapshots, (seg) => seg.dai_kg)
  const thep_buoc_kg = sumBy(segment_snapshots, (seg) => seg.thep_buoc_kg)

  const phu_kien = {
    mat_bich: sumBy(segment_snapshots, (seg) => seg.mat_bich),
    mang_xong: sumBy(segment_snapshots, (seg) => seg.mang_xong),
    mui_coc: totalMuiSegments,
    tap: sumBy(segment_snapshots, (seg) => seg.tap),
  }

  const dmPhuRate = Number(
    items.find((item) => item.loai_nvl === 'PHU_GIA')?.so_luong ?? 0
  )

  const dinh_muc_phu = {
    qty_per_tim: dmPhuRate * derivedMdPerTim,
    qty_total: dmPhuRate * derivedTotalMd,
  }

  const roadTransport =
    h.phuong_thuc_van_chuyen === 'WATERWAY' || h.phuong_thuc_van_chuyen === 'OTHER'
      ? null
      : computeRoadMdPerTrip(payload)
  const md_per_trip =
    h.phuong_thuc_van_chuyen === 'WATERWAY'
      ? round3(Number(h.md_per_trip_input || 0))
      : h.phuong_thuc_van_chuyen === 'OTHER'
        ? 0
        : roadTransport?.mdPerTrip ?? 0
  const so_chuyen =
    md_per_trip > 0 ? Math.ceil(derivedTotalMd / Math.max(md_per_trip, 1)) : 0
  const phi_van_chuyen =
    h.phuong_thuc_van_chuyen === 'OTHER'
      ? derivedTotalMd * Number(h.don_gia_van_chuyen || 0)
      : so_chuyen * Number(h.don_gia_van_chuyen || 0)
  const transportDetails =
    h.phuong_thuc_van_chuyen === 'WATERWAY'
      ? [
          { label: 'Md/chuyến nhập tay', value: formatTransportValue(Number(h.md_per_trip_input || 0)) },
          { label: 'Tổng md đơn hàng', value: formatTransportValue(derivedTotalMd) },
          { label: 'Số chuyến', value: String(so_chuyen) },
          { label: 'Chi phí VC tổng', value: `${String(round3(phi_van_chuyen))} VND` },
        ]
      : h.phuong_thuc_van_chuyen === 'OTHER'
        ? [
            { label: 'Đơn giá VC/md', value: `${String(round3(Number(h.don_gia_van_chuyen || 0)))} VND/md` },
            { label: 'Tổng md đơn hàng', value: formatTransportValue(derivedTotalMd) },
            { label: 'Chi phí VC tổng', value: `${String(round3(phi_van_chuyen))} VND` },
          ]
        : roadTransport?.details ?? []

  const tong_gia_nvl = sumBy(items, (item) => item.so_luong * item.don_gia)
  const tong_gia_pk =
    phu_kien.mat_bich + phu_kien.mang_xong + phu_kien.mui_coc + phu_kien.tap
  const tong_du_toan = tong_gia_nvl + tong_gia_pk + phi_van_chuyen

  const tech = calcTechPreview(payload)
  const concrete_mix_materials = aggregateConcreteMixPreview(segment_snapshots)
  const auxiliary_materials = aggregateAuxiliaryPreview(segment_snapshots)

  return {
    concrete_total_m3: round3(concrete_total_m3),
    pc_total_kg: round3(pc_total_kg),
    dai_total_kg: round3(dai_total_kg),
    thep_buoc_kg: round3(thep_buoc_kg),
    total_segments: round3(totalSegments),
    total_mui_segments: round3(totalMuiSegments),
    phu_kien,
    dinh_muc_phu: {
      qty_per_tim: round3(dinh_muc_phu.qty_per_tim),
      qty_total: round3(dinh_muc_phu.qty_total),
    },
    van_chuyen: {
      md_per_trip,
      so_chuyen,
      phi_van_chuyen: round3(phi_van_chuyen),
      mode:
        h.phuong_thuc_van_chuyen === 'WATERWAY'
          ? 'MANUAL_WATERWAY'
          : h.phuong_thuc_van_chuyen === 'OTHER'
            ? Number(h.don_gia_van_chuyen || 0) > 0
              ? 'MANUAL_OTHER_PER_MD'
              : 'NONE'
            : 'AUTO_ROAD',
      details: transportDetails,
    },
    tong_gia_nvl: round3(tong_gia_nvl),
    tong_gia_pk: round3(tong_gia_pk),
    tong_du_toan: round3(tong_du_toan),
    segment_snapshots,
    concrete_mix_materials,
    auxiliary_materials,
    tech,
  }
}

export function createDefaultPayload(): BocTachDetailPayload {
  return {
    header: {
      da_id: '',
      kh_id: '',
      ma_coc: '',
      loai_coc: '',
      do_ngoai: 0,
      chieu_day: 0,
      kg_md: 0,
      mac_be_tong: '',
      cap_phoi_variant: 'FULL_XI_TRO_XI',
      ten_boc_tach: '',
      loai_thep: '',
      phuong_thuc_van_chuyen: 'ROAD_WITH_CRANE',
      trang_thai: 'NHAP',
      do_mm: 0,
      t_mm: 0,
      pc_dia_mm: 0,
      pc_nos: 0,
      dai_dia_mm: 0,
      buoc_dia_mm: 0,
      dtam_mm: 0,
      sigma_cu: 80,
      sigma_pu: 1420,
      sigma_py: 1275,
      r: 0.7,
      k: 0.025,
      ep: 200000,
      md_per_tim: 0,
      total_md: 0,
      md_per_trip_input: 0,
      don_gia_van_chuyen: 0,
    },
    segments: FIXED_SEGMENT_ORDER.map((segmentName) => createEmptySegment(segmentName)),
    items: [
      {
        nvl_id: '',
        ten_nvl: 'Be tong',
        loai_nvl: 'CAP_PHOI_BT',
        so_luong: 0,
        dvt: 'm3',
        don_gia: 0,
      },
    ],
  }
}

export function sanitizeItems(items: BocTachItemInput[]): BocTachItemInput[] {
  return items
    .map((item) => ({
      ...item,
      nvl_id: String(item.nvl_id || '').trim(),
      ten_nvl: String(item.ten_nvl || '').trim(),
      so_luong: Number(item.so_luong || 0),
      don_gia: Number(item.don_gia || 0),
    }))
    .filter((item) => item.nvl_id)
}

export function sanitizeSegments(segments: BocTachSegmentInput[]): BocTachSegmentInput[] {
  return segments.map((seg) => ({
    ...seg,
    len_m: Number(seg.len_m || 0),
    cnt: Number(seg.cnt || 0),
    so_luong_doan: Number(seg.so_luong_doan || 0),
    the_tich_m3: Number(seg.the_tich_m3 || 0),
    v1: Number(seg.v1 || 0),
    v2: Number(seg.v2 || 0),
    v3: Number(seg.v3 || 0),
    mui_segments: Number(seg.mui_segments || 0),
    dai_kep_chi_a1: Boolean(seg.dai_kep_chi_a1),
    a1_mm: Number(seg.a1_mm || 0),
    a2_mm: Number(seg.a2_mm || 0),
    a3_mm: Number(seg.a3_mm || 0),
    p1_pct: Number(seg.p1_pct || 0),
    p2_pct: Number(seg.p2_pct || 0),
    p3_pct: Number(seg.p3_pct || 0),
    don_kep_factor: Number(seg.don_kep_factor || 1),
  }))
}

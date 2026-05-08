'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProtectedSession } from '@/components/auth/protected-session-provider'
import {
  fetchBocTachReferenceData,
  submitBocTachMutation,
  submitReopenBocTach,
} from '@/lib/boc-tach/client-api'
import {
  applyPileTemplate,
  computeBocTachPreview,
  createDefaultPayload,
  sanitizeItems,
  sanitizeSegments,
} from '@/lib/boc-tach/calc'
import type {
  BocTachPreview,
  BocTachDetailPayload,
  BocTachReferenceData,
  BocTachSegmentInput,
  SegmentNvlSnapshot,
  TechPreview,
} from '@/lib/boc-tach/types'
import { isAdminRole, isQlsxRole } from '@/lib/auth/roles'

type TabKey = 'tong-hop' | 'chi-tiet' | 'du-toan' | 'thong-so'

type CostRow = {
  key: string
  label: string
  dvt: string
  qty: number
  price: number
  amount: number
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'tong-hop', label: 'Tổng hợp vật tư' },
  { key: 'chi-tiet', label: 'Chiết tính từng đoạn' },
  { key: 'du-toan', label: 'Dự toán giá bán' },
  { key: 'thong-so', label: 'Thông số kỹ thuật' },
]

const FIXED_SEGMENT_ORDER = ['MUI', 'THAN_1', 'THAN_2', 'THAN_3', 'THAN_4', 'THAN_5']
const ACCESSORY_NONE_VALUE = '__NONE__'

function normalizeRefs(refs?: BocTachReferenceData): BocTachReferenceData {
  return {
    concreteMixes: refs?.concreteMixes ?? [],
    auxiliaryRates: refs?.auxiliaryRates ?? [],
    pileTemplates: refs?.pileTemplates ?? [],
    customers: refs?.customers ?? [],
    projects: refs?.projects ?? [],
    materials: refs?.materials ?? [],
    hasFullReferenceData: refs?.hasFullReferenceData ?? false,
    vatConfig: refs?.vatConfig ?? { coc_vat_pct: 0, phu_kien_vat_pct: 0 },
    profitRules: refs?.profitRules ?? [],
    otherCostsByDiameter: refs?.otherCostsByDiameter ?? [],
  }
}

function formatTemplateDisplayName(template: BocTachReferenceData['pileTemplates'][number]) {
  return String(template.ma_coc || template.label || '').trim()
}

function createEmptyPreview(): BocTachPreview {
  return {
    concrete_total_m3: 0,
    pc_total_kg: 0,
    dai_total_kg: 0,
    thep_buoc_kg: 0,
    total_segments: 0,
    total_mui_segments: 0,
    phu_kien: { mat_bich: 0, mang_xong: 0, mui_coc: 0, tap: 0 },
    dinh_muc_phu: { qty_per_tim: 0, qty_total: 0 },
    van_chuyen: { md_per_trip: 0, so_chuyen: 0, phi_van_chuyen: 0, mode: 'NONE', details: [] },
    tong_gia_nvl: 0,
    tong_gia_pk: 0,
    tong_du_toan: 0,
    segment_snapshots: [],
    concrete_mix_materials: [],
    auxiliary_materials: [],
    tech: {
      do_mm: 0, t_mm: 0, f_mm: 0, nos: 0, di_mm: 0, dp_mm: 0, d_mm: 0,
      sigma_cu: 0, sigma_bt: 0, sigma_cp: 0, sigma_t: 0, sigma_pu: 0, sigma_py: 0,
      ep: 0, es: 0, y: 0, k: 0, ec: 0, ecp: 0, n1: 0, n: 0, ao: 0, ap: 0, ac: 0,
      ic: 0, is: 0, ie: 0, ze: 0, sigma_pi: 0, sigma_pt: 0, sigma_cpt: 0,
      d_sig_py: 0, d_sig_r: 0, sigma_pe: 0, sigma_ce: 0, ra_l_kn: 0, ra_s_kn: 0,
      ra_l: 0, ra_s: 0, mcr_knm: 0, mcr: 0,
    },
  }
}

function hasMeaningfulInput(payload: BocTachDetailPayload) {
  return Boolean(
    payload.header.da_id ||
      payload.header.kh_id ||
      payload.header.loai_coc ||
      payload.header.mac_be_tong ||
      payload.items.length > 0 ||
      payload.segments.some((segment) => Number(segment.len_m || 0) > 0 || Number(segment.so_luong_doan || segment.cnt || 0) > 0)
  )
}

export function BocTachDetailClient(props: {
  bocId: string
  initialPayload?: BocTachDetailPayload
  initialLocked?: boolean
  refs: BocTachReferenceData
  viewerRole: string
}) {
  const router = useRouter()
  const { profile } = useProtectedSession()
  const initialPayload =
    props.initialPayload ?? {
      ...createDefaultPayload(),
      bocId: props.bocId === 'new' ? undefined : props.bocId,
    }
  const [tab, setTab] = useState<TabKey>('tong-hop')
  const [payload, setPayload] = useState<BocTachDetailPayload>(initialPayload)
  const [pileCount, setPileCount] = useState(() => derivePileCount(initialPayload.segments))
  const [loading, setLoading] = useState(false)
  const [loadingReferenceData, setLoadingReferenceData] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refsState, setRefsState] = useState<BocTachReferenceData>(() => normalizeRefs(props.refs))
  const [hasStartedInteracting, setHasStartedInteracting] = useState(() =>
    props.bocId !== 'new' || hasMeaningfulInput(initialPayload)
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [profitPct, setProfitPct] = useState(() => String(initialPayload.header.profit_pct || 0))
  const [taxPct, setTaxPct] = useState(() => String(initialPayload.header.tax_pct || 0))
  const [profitPctTouched, setProfitPctTouched] = useState(false)
  const [taxPctTouched, setTaxPctTouched] = useState(false)
  const [manuallyUnlocked, setManuallyUnlocked] = useState(false)
  const [showSegmentIntermediate, setShowSegmentIntermediate] = useState(false)
  const [returnReasonCode, setReturnReasonCode] = useState(
    () => initialPayload.header.qlsx_ly_do_code || ''
  )
  const [returnReasonText, setReturnReasonText] = useState(
    () => initialPayload.header.qlsx_ly_do_text || ''
  )
  const [autoDtam, setAutoDtam] = useState(() =>
    initialPayload.header.dtam_mm <= 0 ||
    initialPayload.header.dtam_mm === initialPayload.header.do_ngoai - initialPayload.header.chieu_day
  )
  const activeRole = props.viewerRole || profile.role
  const qlsxViewer = isQlsxRole(activeRole)
  const adminViewer = isAdminRole(activeRole)
  const locked =
    (qlsxViewer && payload.header.trang_thai !== 'TRA_LAI') ||
    (!manuallyUnlocked && props.initialLocked) ||
    (!adminViewer && payload.header.trang_thai === 'DA_DUYET_QLSX')
  const refs = useMemo(() => normalizeRefs(refsState), [refsState])
  const shouldComputePreview = props.bocId !== 'new' || hasStartedInteracting
  const preview = useMemo(
    () => (shouldComputePreview ? computeBocTachPreview(payload, refs) : createEmptyPreview()),
    [payload, refs, shouldComputePreview]
  )
  const currentSaveSnapshot = useMemo(
    () =>
      buildDraftSnapshot(
        payload,
        buildDerivedPileType(payload.header.loai_coc, payload.header.do_ngoai, payload.header.chieu_day)
      ),
    [payload]
  )
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() =>
    props.bocId === 'new'
      ? ''
      : buildDraftSnapshot(
          initialPayload,
          buildDerivedPileType(
            initialPayload.header.loai_coc,
            initialPayload.header.do_ngoai,
            initialPayload.header.chieu_day
          )
        )
  )
  const normalizedConcreteGrade = normalizeConcreteGradeOption(payload.header.mac_be_tong)
  const materialPriceMap = useMemo(
    () =>
      new Map(
        refs.materials.map((item) => [item.nvl_id, Number(item.don_gia_hien_hanh || 0)])
      ),
    [refs.materials]
  )
  const accessoryOptions = useMemo(
    () =>
      refs.materials
        .filter((item) => normalizeGroup(item.nhom_hang) === 'PHU_KIEN')
        .map((item) => ({ value: item.nvl_id, label: item.ten_hang })),
    [refs.materials]
  )
  const steelPcOptions = useMemo(
    () =>
      refs.materials
        .filter(
          (item) =>
            normalizeGroup(item.nhom_hang) === 'THEP' &&
            normalizeText(item.ten_hang).includes('PC')
        )
        .map((item) => ({ value: item.nvl_id, label: item.ten_hang })),
    [refs.materials]
  )
  const steelDaiOptions = useMemo(
    () =>
      refs.materials
        .filter(
          (item) =>
            normalizeGroup(item.nhom_hang) === 'THEP' &&
            normalizeText(item.ten_hang).includes('DAI')
        )
        .map((item) => ({ value: item.nvl_id, label: item.ten_hang })),
    [refs.materials]
  )
  const steelBuocOptions = useMemo(
    () =>
      refs.materials
        .filter(
          (item) =>
            normalizeGroup(item.nhom_hang) === 'THEP' &&
            normalizeText(item.ten_hang).includes('BUOC')
        )
        .map((item) => ({ value: item.nvl_id, label: item.ten_hang })),
    [refs.materials]
  )
  const concreteGradeOptions = useMemo(() => {
    const values = new Set<string>()
    refs.concreteMixes.forEach((mix) => {
      if (normalizeConcreteMixVariant(mix.variant) !== 'FULL_XI_TRO_XI') return
      const value = normalizeConcreteGradeOption(mix.mac_be_tong)
      if (value) values.add(value)
    })
    return Array.from(values)
      .sort((left, right) => Number(left || 0) - Number(right || 0))
      .map((value) => ({ value, label: value }))
  }, [refs.concreteMixes])

  const selectedProject =
    refs.projects.find((item) => item.da_id === payload.header.da_id) ?? null
  const selectedCustomer =
    refs.customers.find((item) => item.kh_id === payload.header.kh_id) ?? null
  const factoryPileTemplates = useMemo(
    () => refs.pileTemplates.filter((item) => item.template_scope !== 'CUSTOM'),
    [refs.pileTemplates]
  )
  const selectedAccessoryIds = useMemo(
    () => ({
      mat_bich: resolveAccessorySelectionId(payload.items, refs.materials, 'mat_bich'),
      mang_xong: resolveAccessorySelectionId(payload.items, refs.materials, 'mang_xong'),
      mui_coc: resolveAccessorySelectionId(payload.items, refs.materials, 'mui_coc'),
      tap: resolveAccessorySelectionId(payload.items, refs.materials, 'tap'),
    }),
    [payload.items, refs.materials]
  )
  const selectedSteelIds = useMemo(
    () => ({
      pc: resolveSteelSelectionId(payload.items, refs.materials, 'pc', payload.header.loai_thep, payload.header.pc_dia_mm),
      dai: resolveSteelSelectionId(payload.items, refs.materials, 'dai', '', payload.header.dai_dia_mm),
      buoc: resolveSteelSelectionId(payload.items, refs.materials, 'buoc', '', payload.header.buoc_dia_mm),
    }),
    [payload.items, refs.materials, payload.header.loai_thep, payload.header.pc_dia_mm, payload.header.dai_dia_mm, payload.header.buoc_dia_mm]
  )
  const selectedConcreteGradeLabel = useMemo(
    () =>
      concreteGradeOptions.find((item) => item.value === normalizedConcreteGrade)?.label ||
      payload.header.mac_be_tong,
    [concreteGradeOptions, normalizedConcreteGrade, payload.header.mac_be_tong]
  )
  const selectedSteelLabels = useMemo(
    () => ({
      pc:
        steelPcOptions.find((item) => item.value === selectedSteelIds.pc)?.label ||
        payload.header.loai_thep ||
        payload.items.find((item) => item.nvl_id === selectedSteelIds.pc)?.ten_nvl ||
        '',
      dai:
        steelDaiOptions.find((item) => item.value === selectedSteelIds.dai)?.label ||
        payload.items.find((item) => item.nvl_id === selectedSteelIds.dai)?.ten_nvl ||
        '',
      buoc:
        steelBuocOptions.find((item) => item.value === selectedSteelIds.buoc)?.label ||
        payload.items.find((item) => item.nvl_id === selectedSteelIds.buoc)?.ten_nvl ||
        '',
    }),
    [
      payload.header.loai_thep,
      payload.items,
      selectedSteelIds.buoc,
      selectedSteelIds.dai,
      selectedSteelIds.pc,
      steelBuocOptions,
      steelDaiOptions,
      steelPcOptions,
    ]
  )

  const timCount = useMemo(() => {
    const counts = payload.segments
      .map((segment) => Number(segment.so_luong_doan || segment.cnt || 0))
      .filter((value) => value > 0)
    if (counts.length === 0) return 0
    return Math.min(...counts)
  }, [payload.segments])

  const mdPerTim = useMemo(() => {
    if (timCount <= 0) return Number(payload.header.md_per_tim || 0)
    return Number(
      payload.segments.reduce((acc, segment) => {
        const qty = Number(segment.so_luong_doan || segment.cnt || 0)
        const perTim = qty > 0 ? qty / timCount : 0
        return acc + Number(segment.len_m || 0) * perTim
      }, 0).toFixed(3)
    )
  }, [payload.segments, timCount, payload.header.md_per_tim])

  const totalMd = useMemo(() => {
    return Number(
      payload.segments.reduce((acc, segment) => {
        return acc + Number(segment.len_m || 0) * Number(segment.so_luong_doan || segment.cnt || 0)
      }, 0).toFixed(3)
    )
  }, [payload.segments])

  const fixedSegments = useMemo(
    () =>
      FIXED_SEGMENT_ORDER.map((name) => {
        const found = payload.segments.find((segment) => segment.ten_doan === name)
        const perTim = found ? derivePerTimCount(found, pileCount) : 0
        return (
          found ?? {
            ten_doan: name,
            len_m: 0,
            cnt: perTim,
            so_luong_doan: perTim * pileCount,
            the_tich_m3: 0,
            v1: 0,
            v2: 0,
            v3: 0,
            mui_segments: name === 'MUI' ? pileCount : 0,
            dai_kep_chi_a1: true,
            a1_mm: 0,
            a2_mm: 0,
            a3_mm: 0,
            p1_pct: 0,
            p2_pct: 0,
            p3_pct: 0,
            don_kep_factor: 1,
          }
        )
      }),
    [payload.segments, pileCount]
  )

  const activeSegmentSnapshots = useMemo(
    () =>
      preview.segment_snapshots.filter(
        (snapshot) =>
          Number(snapshot.so_luong_doan || 0) > 0 && Number(snapshot.len_m || 0) > 0
      ),
    [preview.segment_snapshots]
  )

  const sharedSegmentConfig = useMemo(() => {
    const anchor = fixedSegments[0]
    return {
      a1_mm: Number(anchor?.a1_mm || 0),
      a2_mm: Number(anchor?.a2_mm || 0),
      a3_mm: Number(anchor?.a3_mm || 0),
      p1_pct: Number(anchor?.p1_pct || 0),
      p2_pct: Number(anchor?.p2_pct || 0),
      p3_pct: Number(anchor?.p3_pct || 0),
    }
  }, [fixedSegments])

  const defaultProfitPct = useMemo(() => {
    const targetDiameter = Number(payload.header.do_ngoai || payload.header.do_mm || 0)
    const matchedRules = refs.profitRules
      .filter((item) => Number(item.duong_kinh_mm || 0) === targetDiameter)
      .sort((left, right) => left.min_md - right.min_md)

    if (matchedRules.length === 0) return 0
    const exactRule =
      [...matchedRules]
        .reverse()
        .find((item) => totalMd >= Number(item.min_md || 0)) ?? matchedRules[0]
    return Number(exactRule.loi_nhuan_pct || 0)
  }, [payload.header.do_ngoai, payload.header.do_mm, refs.profitRules, totalMd])

  const otherCostPerMd = useMemo(() => {
    const targetDiameter = Number(payload.header.do_ngoai || payload.header.do_mm || 0)
    if (!Number.isFinite(targetDiameter) || targetDiameter <= 0) return 0
    const matched = refs.otherCostsByDiameter.find(
      (item) => Number(item.duong_kinh_mm || 0) === targetDiameter
    )
    return Number(matched?.tong_chi_phi_vnd_md || 0)
  }, [payload.header.do_ngoai, payload.header.do_mm, refs.otherCostsByDiameter])
  const hasPersistedDraft = props.bocId !== 'new' || Boolean(payload.bocId)
  const hasUnsavedChanges = hasPersistedDraft
    ? currentSaveSnapshot !== lastSavedSnapshot
    : currentSaveSnapshot !== ''
  const canEditWorkflow =
    adminViewer || payload.header.trang_thai === 'NHAP' || payload.header.trang_thai === 'TRA_LAI'
  const canSaveDraft =
    !qlsxViewer &&
    canEditWorkflow &&
    !loading &&
    (!hasPersistedDraft || hasUnsavedChanges)
  const canSend =
    !qlsxViewer &&
    !loading &&
    hasPersistedDraft &&
    !hasUnsavedChanges &&
    (payload.header.trang_thai === 'NHAP' || payload.header.trang_thai === 'TRA_LAI')
  const canSoftReopen =
    !loading &&
    !qlsxViewer &&
    payload.header.trang_thai === 'DA_GUI'
  const canAdminReopenApproved =
    !loading &&
    adminViewer &&
    payload.header.trang_thai === 'DA_DUYET_QLSX'

  const hasChosenTemplate =
    props.bocId !== 'new' ? Boolean(payload.header.loai_coc) : Boolean(selectedTemplateId)

  const derivedLoaiCoc = useMemo(() => {
    return buildDerivedPileType(payload.header.loai_coc, payload.header.do_ngoai, payload.header.chieu_day)
  }, [payload.header.loai_coc, payload.header.do_ngoai, payload.header.chieu_day])
  const reviewReasons = useMemo(
    () => [
      { value: 'WRONG_INPUT', label: 'Sai thông số đầu vào' },
      { value: 'WRONG_MATERIAL', label: 'Sai vật tư / phụ kiện' },
      { value: 'WRONG_FORMULA', label: 'Sai công thức / định mức' },
      { value: 'MISSING_DATA', label: 'Thiếu dữ liệu' },
      { value: 'OTHER', label: 'Lý do khác' },
    ],
    []
  )
  const canReview =
    (qlsxViewer || adminViewer) &&
    payload.header.trang_thai === 'DA_GUI' &&
    Boolean(payload.bocId)
  const visibleTabs = useMemo(() => {
    if (qlsxViewer) {
      return TABS.filter((item) => item.key === 'tong-hop' || item.key === 'chi-tiet')
    }
    return TABS
  }, [qlsxViewer])

  useEffect(() => {
    if (!taxPctTouched && Number(refs.vatConfig.coc_vat_pct || 0) > 0) {
      setTaxPct(String(refs.vatConfig.coc_vat_pct))
    }
  }, [refs.vatConfig.coc_vat_pct, taxPctTouched])

  useEffect(() => {
    if (!profitPctTouched) {
      setProfitPct(String(defaultProfitPct))
    }
  }, [defaultProfitPct, profitPctTouched])

  useEffect(() => {
    if (!autoDtam) return
    if (!hasChosenTemplate) return
    const nextDtam = Math.max(
      0,
      Number(payload.header.do_ngoai || 0) - Number(payload.header.chieu_day || 0)
    )
    if (Number(payload.header.dtam_mm || 0) !== nextDtam) {
      setPayload((prev) => ({
        ...prev,
        header: {
          ...prev.header,
          dtam_mm: nextDtam,
        },
      }))
    }
  }, [
    autoDtam,
    hasChosenTemplate,
    payload.header.do_ngoai,
    payload.header.chieu_day,
    payload.header.dtam_mm,
  ])

  useEffect(() => {
    if (!visibleTabs.some((item) => item.key === tab)) {
      setTab(visibleTabs[0]?.key ?? 'tong-hop')
    }
  }, [tab, visibleTabs])

  useEffect(() => {
    if (props.bocId !== 'new') return
    if (qlsxViewer) return
    if (!hasStartedInteracting) return
    if (refs.hasFullReferenceData) return
    if (loadingReferenceData) return

    let cancelled = false

    async function loadFullReferenceData() {
      setLoadingReferenceData(true)
      try {
        const data = await fetchBocTachReferenceData()
        if (!cancelled && data.data) {
          setRefsState(normalizeRefs(data.data))
        }
      } catch (err) {
        if (!cancelled) {
          setError((current) =>
            current || (err instanceof Error ? err.message : 'Không tải được dữ liệu giá bóc tách.')
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingReferenceData(false)
        }
      }
    }

    void loadFullReferenceData()

    return () => {
      cancelled = true
    }
  }, [hasStartedInteracting, loadingReferenceData, props.bocId, qlsxViewer, refs.hasFullReferenceData])

  function markInteracted() {
    if (props.bocId === 'new') {
      setHasStartedInteracting(true)
    }
  }

  const mainMaterialRows = useMemo<CostRow[]>(() => {
    const concreteTotalAmount = preview.concrete_mix_materials.reduce((acc, item) => {
      return acc + item.qty * Number(materialPriceMap.get(item.nvl_id) || 0)
    }, 0)
    const concreteUnitPrice =
      preview.concrete_total_m3 > 0 ? concreteTotalAmount / preview.concrete_total_m3 : 0
    const rows: Array<{ key: string; label: string; dvt: string; qty: number }> = [
      {
        key: `main:${payload.header.mac_be_tong}`,
        label: selectedConcreteGradeLabel ? `Bê tông M${selectedConcreteGradeLabel}` : '',
        dvt: 'm3',
        qty: preview.concrete_total_m3,
      },
      {
        key: 'main:pc',
        label: selectedSteelLabels.pc || payload.header.loai_thep || '',
        dvt: 'kg',
        qty: preview.pc_total_kg,
      },
      {
        key: 'main:dai',
        label: selectedSteelLabels.dai,
        dvt: 'kg',
        qty: preview.dai_total_kg,
      },
      {
        key: 'main:buoc',
        label: selectedSteelLabels.buoc,
        dvt: 'kg',
        qty: preview.thep_buoc_kg,
      },
    ]

    return rows.map((row) => {
      let defaultPrice = 0
      if (row.key.startsWith('main:') && row.key === `main:${payload.header.mac_be_tong}`) {
        defaultPrice = concreteUnitPrice
      } else if (row.key === 'main:pc') {
        defaultPrice = Number(materialPriceMap.get(selectedSteelIds.pc) || 0)
      } else if (row.key === 'main:dai') {
        defaultPrice = Number(materialPriceMap.get(selectedSteelIds.dai) || 0)
      } else if (row.key === 'main:buoc') {
        defaultPrice = Number(materialPriceMap.get(selectedSteelIds.buoc) || 0)
      }
      const price = defaultPrice
      return { ...row, price, amount: row.qty * price }
    }).filter((row) => row.qty > 0)
  }, [materialPriceMap, payload.header, preview, selectedConcreteGradeLabel, selectedSteelIds, selectedSteelLabels])

  const accessoryRows = useMemo<CostRow[]>(() => {
    const accessoryLabelMap = {
      mat_bich: resolveAccessoryLabel(
        payload.items,
        refs.materials,
        'mat_bich',
        `Mat bich - D${payload.header.do_ngoai}x200x10`
      ),
      mang_xong: resolveAccessoryLabel(
        payload.items,
        refs.materials,
        'mang_xong',
        `Mang xong - D${payload.header.do_ngoai}x200x10`
      ),
      mui_coc: resolveAccessoryLabel(
        payload.items,
        refs.materials,
        'mui_coc',
        `Mui coc - D${payload.header.do_ngoai}x200x10`
      ),
      tap: resolveAccessoryLabel(
        payload.items,
        refs.materials,
        'tap',
        `Tap vuong - D${payload.header.do_ngoai}x200x10`
      ),
    }
    const rows = [
      { key: 'pk:mat_bich', label: accessoryLabelMap.mat_bich, dvt: 'cai', qty: preview.phu_kien.mat_bich },
      { key: 'pk:mang_xong', label: accessoryLabelMap.mang_xong, dvt: 'cai', qty: preview.phu_kien.mang_xong },
      { key: 'pk:mui_coc', label: accessoryLabelMap.mui_coc, dvt: 'cai', qty: preview.phu_kien.mui_coc },
      { key: 'pk:tap', label: accessoryLabelMap.tap, dvt: 'cai', qty: preview.phu_kien.tap },
    ]
      .filter((row) => row.qty > 0)
      .map((row) => {
        const selectedId =
          row.key === 'pk:mat_bich'
            ? selectedAccessoryIds.mat_bich
            : row.key === 'pk:mang_xong'
              ? selectedAccessoryIds.mang_xong
              : row.key === 'pk:mui_coc'
                ? selectedAccessoryIds.mui_coc
                : selectedAccessoryIds.tap
        const defaultPrice = Number(materialPriceMap.get(selectedId) || 0)
        const price = defaultPrice
        return { ...row, price, amount: row.qty * price }
      })

    return rows
  }, [payload.items, payload.header.do_ngoai, preview.phu_kien, refs.materials, selectedAccessoryIds, materialPriceMap])

  const auxiliaryRows = useMemo<CostRow[]>(() => {
    return preview.auxiliary_materials
      .filter((item) => item.qty > 0)
      .map((item) => {
      const key = `aux:${item.nvl_id}`
      const defaultPrice = Number(materialPriceMap.get(item.nvl_id) || 0)
      const price = defaultPrice
      return {
        key,
        label: item.ten_nvl,
        dvt: item.dvt,
        qty: item.qty,
        price,
        amount: item.qty * price,
      }
      })
  }, [preview.auxiliary_materials, materialPriceMap])

  const allMaterialRows = useMemo(
    () => [...mainMaterialRows, ...accessoryRows, ...auxiliaryRows],
    [mainMaterialRows, accessoryRows, auxiliaryRows]
  )

  const totalMaterialCost = sumRows(allMaterialRows)
  const otherCostAmount = totalMd * Number(otherCostPerMd || 0)
  const subtotal = totalMaterialCost + otherCostAmount
  const profitAmount = subtotal * (Number(profitPct || 0) / 100)
  const preTaxAmount = subtotal + profitAmount
  const vatAmount = preTaxAmount * (Number(taxPct || 0) / 100)
  const finalAmount = preTaxAmount + vatAmount
  const donGiaVonPerMd = totalMd > 0 ? subtotal / totalMd : 0
  const salePriceExVatPerMd = totalMd > 0 ? preTaxAmount / totalMd : 0
  const salePriceInVatPerMd = totalMd > 0 ? finalAmount / totalMd : 0

  async function submitAction(action: 'save' | 'send' | 'cancel' | 'approve' | 'return') {
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (action === 'send') {
        if (!hasPersistedDraft) {
          throw new Error('Cần Lưu nháp hồ sơ trước khi Gửi QLSX.')
        }
        if (hasUnsavedChanges) {
          throw new Error('Bạn vừa chỉnh sửa dữ liệu. Hãy Lưu nháp lại trước khi Gửi QLSX.')
        }
      }
      if (action === 'return' && !returnReasonCode && !returnReasonText.trim()) {
        throw new Error('Cần chọn hoặc nhập lý do trả lại chỉnh sửa.')
      }

      if (!['cancel', 'approve', 'return'].includes(action)) {
        if (!payload.header.da_id || !payload.header.kh_id) {
          throw new Error('Can chon du an va khach hang')
        }
        if (!payload.header.loai_coc || !payload.header.mac_be_tong) {
          throw new Error('Can chon loai coc va mac be tong')
        }
        if (payload.segments.length < 1) {
          throw new Error('Can it nhat 1 doan coc')
        }
      }

      const normalizedPayload: BocTachDetailPayload = {
        ...payload,
        header: {
          ...payload.header,
          loai_coc: derivedLoaiCoc,
          md_per_tim: mdPerTim,
          total_md: totalMd,
          profit_pct: Number(profitPct || 0),
          tax_pct: Number(taxPct || 0),
          qlsx_ly_do_code:
            action === 'return' ? returnReasonCode : payload.header.qlsx_ly_do_code,
          qlsx_ly_do_text:
            action === 'return' ? returnReasonText.trim() : payload.header.qlsx_ly_do_text,
        },
      }

      const data = await submitBocTachMutation({
        bocId: props.bocId,
        action,
        payload: normalizedPayload,
      })

      const nextStatus =
        action === 'send'
          ? 'DA_GUI'
          : action === 'approve'
            ? 'DA_DUYET_QLSX'
            : action === 'return'
              ? 'TRA_LAI'
          : action === 'cancel'
            ? 'HUY'
            : 'NHAP'
      const syncedPayload: BocTachDetailPayload = {
        ...normalizedPayload,
        bocId: data.data?.headerId || normalizedPayload.bocId,
        header: {
          ...normalizedPayload.header,
          trang_thai: nextStatus,
        },
      }

      setPayload(syncedPayload)
      setLastSavedSnapshot(buildDraftSnapshot(syncedPayload, syncedPayload.header.loai_coc))
      setProfitPctTouched(false)
      setTaxPctTouched(false)

      if (action === 'send') {
        setMessage('Da gui QLSX de duyet du toan')
      } else if (action === 'approve') {
        setMessage('QLSX đã duyệt dự toán.')
      } else if (action === 'return') {
        setMessage('QLSX đã trả lại dự toán để chỉnh sửa.')
      } else if (action === 'cancel') {
        setMessage('Da huy boc tach')
      } else {
        setMessage('Da luu nhap du toan')
      }

      if (data.data?.headerId && props.bocId === 'new') {
        router.replace(`/boc-tach/boc-tach-nvl/${data.data.headerId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xử lý được')
    } finally {
      setLoading(false)
    }
  }

  async function reopenEstimate() {
    if (props.bocId === 'new') return

    setLoading(true)
    setError('')
    setMessage('')
    try {
      await submitReopenBocTach({ bocId: props.bocId })
      setPayload((current) => ({
        ...current,
        header: {
          ...current.header,
          trang_thai: 'NHAP',
          qlsx_ly_do_code: '',
          qlsx_ly_do_text: '',
        },
      }))
      setReturnReasonCode('')
      setReturnReasonText('')
      setManuallyUnlocked(true)
      setMessage('Đã mở lại bóc tách. Có thể chỉnh sửa và gửi lại khi sẵn sàng.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không mở lại được bóc tách.')
    } finally {
      setLoading(false)
    }
  }

  function updateHeader<K extends keyof BocTachDetailPayload['header']>(
    key: K,
    value: BocTachDetailPayload['header'][K]
  ) {
    markInteracted()
    setPayload((prev) => ({
      ...prev,
      header: { ...prev.header, [key]: value },
    }))
  }

  function updateSegmentByName(name: string, patch: Partial<BocTachSegmentInput>) {
    markInteracted()
    setPayload((prev) => {
      const existingIndex = prev.segments.findIndex((segment) => segment.ten_doan === name)
      const base =
        existingIndex >= 0
          ? prev.segments[existingIndex]
          : {
              ten_doan: name,
              len_m: 0,
              cnt: 0,
              so_luong_doan: 0,
              the_tich_m3: 0,
              v1: 0,
              v2: 0,
              v3: 0,
              mui_segments: name === 'MUI' ? pileCount : 0,
              dai_kep_chi_a1: true,
              a1_mm: 0,
              a2_mm: 0,
              a3_mm: 0,
              p1_pct: 0,
              p2_pct: 0,
              p3_pct: 0,
              don_kep_factor: 1,
            }
      const next = { ...base, ...patch, ten_doan: name }

      if (existingIndex >= 0) {
        return {
          ...prev,
          segments: prev.segments.map((segment, segIndex) =>
            segIndex === existingIndex ? next : segment
          ),
        }
      }

      return {
        ...prev,
        segments: [...prev.segments, next],
      }
    })
  }

  function handlePileCountChange(value: number) {
    markInteracted()
    const nextPileCount = Math.max(0, value)
    setPileCount(nextPileCount)
    setPayload((prev) => ({
      ...prev,
      segments: prev.segments.map((segment) => {
        const perTim = derivePerTimCount(segment, pileCount || nextPileCount || 1)
        return {
          ...segment,
          cnt: perTim,
          so_luong_doan: perTim * nextPileCount,
          mui_segments: segment.ten_doan === 'MUI' ? nextPileCount : 0,
        }
      }),
    }))
  }

  function handleProjectChange(projectId: string) {
    markInteracted()
    const project = refs.projects.find((item) => item.da_id === projectId)
    setPayload((prev) => ({
      ...prev,
      header: {
        ...prev.header,
        da_id: projectId,
        kh_id: project?.kh_id || prev.header.kh_id,
      },
    }))
  }

  function updateAccessorySelection(kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap', nvlId: string) {
    markInteracted()
    setPayload((prev) => {
      const nextItems = prev.items.filter(
        (item) => resolveAccessoryKindForItem(item, refs.materials) !== kind
      )
      if (!nvlId || nvlId === ACCESSORY_NONE_VALUE) {
        return { ...prev, items: nextItems }
      }
      const material = refs.materials.find((item) => item.nvl_id === nvlId)
      if (!material) return prev
      nextItems.push({
        nvl_id: material.nvl_id,
        ten_nvl: material.ten_hang,
        loai_nvl: 'PHU_KIEN',
        so_luong: 0,
        dvt: material.dvt || 'cai',
        don_gia: 0,
      })
      return { ...prev, items: nextItems }
    })
  }

  function updateAllSegments(patch: Partial<BocTachSegmentInput>) {
    markInteracted()
    for (const segment of fixedSegments) {
      updateSegmentByName(segment.ten_doan, patch)
    }
  }

  function updateSteelSelection(kind: 'pc' | 'dai' | 'buoc', nvlId: string) {
    markInteracted()
    const material = refs.materials.find((item) => item.nvl_id === nvlId)
    if (!material) return
    const diameter = parseMaterialDiameter(material.ten_hang)
    setPayload((prev) => {
      const nextItems = prev.items.filter((item) => {
        if (item.loai_nvl !== 'THEP') return true
        const normalized = normalizeText(item.ten_nvl)
        if (kind === 'pc') return !normalized.includes('PC')
        if (kind === 'dai') return !normalized.includes('DAI')
        return !normalized.includes('BUOC')
      })
      nextItems.push({
        nvl_id: material.nvl_id,
        ten_nvl: material.ten_hang,
        loai_nvl: 'THEP',
        so_luong: 0,
        dvt: material.dvt || 'kg',
        don_gia: 0,
      })

      return {
        ...prev,
        header: {
          ...prev.header,
          loai_thep: kind === 'pc' ? material.ten_hang : prev.header.loai_thep,
          pc_dia_mm: kind === 'pc' ? diameter || prev.header.pc_dia_mm : prev.header.pc_dia_mm,
          dai_dia_mm: kind === 'dai' ? diameter || prev.header.dai_dia_mm : prev.header.dai_dia_mm,
          buoc_dia_mm:
            kind === 'buoc' ? diameter || prev.header.buoc_dia_mm : prev.header.buoc_dia_mm,
        },
        items: nextItems,
      }
    })
  }

  function handleResetFactory() {
    markInteracted()
    const base = createDefaultPayload()
    const template = refs.pileTemplates.find((item) => item.template_id === selectedTemplateId)
    const nextPayload = template ? applyPileTemplate(base, template, refs) : base
    const nextDtam =
      template && template.dtam_mm && template.dtam_mm > 0
        ? template.dtam_mm
        : Math.max(
            0,
            Number(template?.do_ngoai ?? nextPayload.header.do_ngoai ?? 0) -
              Number(template?.chieu_day ?? nextPayload.header.chieu_day ?? 0)
          )
    setPayload((prev) => ({
      ...nextPayload,
      bocId: prev.bocId,
      header: {
        ...nextPayload.header,
        da_id: prev.header.da_id,
        kh_id: prev.header.kh_id,
        dtam_mm: nextDtam,
        ten_boc_tach: prev.header.ten_boc_tach,
      },
    }))
    setPileCount(derivePileCount(nextPayload.segments))
    setAutoDtam(true)
    setMessage('Da reset ve thong so mac dinh nha may')
    setError('')
  }

  return (
    <div className="space-y-6">
      <section className="app-surface rounded-2xl p-6">
        <h3 className="text-2xl font-semibold">Nhập dữ liệu</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SearchSelectField
            label="Chọn dự án"
            value={payload.header.da_id}
            disabled={locked}
            options={refs.projects.map((project) => ({
              value: project.da_id,
              label: [project.ma_da, project.ten_da].filter(Boolean).join(' - '),
            }))}
            onChange={handleProjectChange}
            placeholder="-- chọn dự án --"
          />
          <ReadOnlyField
            label="Chọn khách hàng"
            value={
              selectedProject
                ? [selectedCustomer?.ma_kh, selectedCustomer?.ten_kh]
                    .filter(Boolean)
                    .join(' - ')
                : '-- chọn dự án trước --'
            }
          />
          <ReadOnlyField label="Mã khách hàng" value={selectedCustomer?.ma_kh || payload.header.kh_id} />
          <ReadOnlyField label="Thông tin khách hàng" value={selectedCustomer?.thong_tin || selectedCustomer?.ten_kh || ''} />
          <ReadOnlyField label="Mã dự án" value={selectedProject?.ma_da || payload.header.da_id} />
          <ReadOnlyField label="Tên dự án" value={selectedProject?.ten_da || ''} />
          <ReadOnlyField label="Vị trí công trình" value={sanitizeProjectLocation(selectedProject?.vi_tri_cong_trinh || '')} />
        </div>

        <div className="mt-8">
          <SearchSelectField
            label="Mã cọc"
            value={selectedTemplateId}
            disabled={locked}
            options={factoryPileTemplates
              .map((template) => ({
                value: template.template_id,
                label: formatTemplateDisplayName(template),
              }))
              .filter((option) => Boolean(option.label))}
            onChange={(value) => {
              markInteracted()
              setSelectedTemplateId(value)
              const template = factoryPileTemplates.find((item) => item.template_id === value)
              if (!template) return
              const nextPayload = applyPileTemplate(payload, template, refs)
              const nextDtam =
                template.dtam_mm && template.dtam_mm > 0
                  ? template.dtam_mm
                  : Math.max(
                      0,
                      Number(template.do_ngoai ?? nextPayload.header.do_ngoai ?? 0) -
                        Number(template.chieu_day ?? nextPayload.header.chieu_day ?? 0)
                    )
              setPayload({
                ...nextPayload,
                header: {
                  ...nextPayload.header,
                  mac_be_tong: normalizeConcreteGradeOption(nextPayload.header.mac_be_tong),
                  dtam_mm: nextDtam,
                },
              })
              setPileCount(derivePileCount(nextPayload.segments))
              setAutoDtam(true)
              setMessage(`Đã nạp bộ thông số mặc định: ${formatTemplateDisplayName(template)}`)
              setError('')
            }}
            placeholder="-- chọn mã cọc --"
          />
        </div>

        <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
          <h4 className="text-2xl font-semibold">Thông số cọc</h4>
          <p className="app-muted mt-2 text-sm">
            Các ô có dạng <span className="font-semibold">-- chọn ... --</span> là dropdown tìm kiếm.
            Các ô số còn lại là nhập tay và đều có thể chỉnh lại theo bản vẽ khách.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
          <NumberField
            label="ĐK ngoài (mm)"
            value={payload.header.do_ngoai}
            blank={!hasChosenTemplate}
            disabled={locked}
            onChange={(value) => {
              updateHeader('do_ngoai', value)
              updateHeader('do_mm', value)
              if (autoDtam) {
                updateHeader('dtam_mm', Math.max(0, value - Number(payload.header.chieu_day || 0)))
              }
            }}
          />
          <NumberField
            label="Thành cọc (mm)"
            value={payload.header.chieu_day}
            blank={!hasChosenTemplate}
            disabled={locked}
            onChange={(value) => {
              updateHeader('chieu_day', value)
              updateHeader('t_mm', value)
              if (autoDtam) {
                updateHeader('dtam_mm', Math.max(0, Number(payload.header.do_ngoai || 0) - value))
              }
            }}
          />
          <NumberField
            label="Khối lượng (kg/md)"
            value={payload.header.kg_md}
            blank={!hasChosenTemplate}
            disabled={locked}
            step="0.001"
            onChange={(value) => updateHeader('kg_md', value)}
          />
          <SearchSelectField
            label="Mác bê tông"
            value={normalizedConcreteGrade}
            disabled={locked}
            options={concreteGradeOptions}
            onChange={(value) => updateHeader('mac_be_tong', value)}
            placeholder="-- chọn mác bê tông --"
          />
          <SearchSelectField
            label="Thép PC"
            value={selectedSteelIds.pc}
            disabled={locked}
            options={steelPcOptions}
            onChange={(value) => updateSteelSelection('pc', value)}
            placeholder="-- chọn thép PC --"
          />
          <NumberField label="Số thanh PC" value={payload.header.pc_nos} blank={!hasChosenTemplate} disabled={locked} onChange={(value) => updateHeader('pc_nos', value)} />
          <SearchSelectField
            label="Thép đai"
            value={selectedSteelIds.dai}
            disabled={locked}
            options={steelDaiOptions}
            onChange={(value) => updateSteelSelection('dai', value)}
            placeholder="-- chọn thép đai --"
          />
          <SearchSelectField
            label="Thép buộc"
            value={selectedSteelIds.buoc}
            disabled={locked}
            options={steelBuocOptions}
            onChange={(value) => updateSteelSelection('buoc', value)}
            placeholder="-- chọn thép buộc --"
          />
          <NumberField label="A1 (mm)" value={sharedSegmentConfig.a1_mm} blank={!hasChosenTemplate} disabled={locked} onChange={(value) => updateAllSegments({ a1_mm: value })} />
          <NumberField label="A2 (mm)" value={sharedSegmentConfig.a2_mm} blank={!hasChosenTemplate} disabled={locked} onChange={(value) => updateAllSegments({ a2_mm: value })} />
          <NumberField label="A3 (mm)" value={sharedSegmentConfig.a3_mm} blank={!hasChosenTemplate} disabled={locked} onChange={(value) => updateAllSegments({ a3_mm: value })} />
          <NumberField label="PctA1" value={sharedSegmentConfig.p1_pct} blank={!hasChosenTemplate} disabled={locked} step="0.01" onChange={(value) => updateAllSegments({ p1_pct: value })} />
          <NumberField label="PctA2" value={sharedSegmentConfig.p2_pct} blank={!hasChosenTemplate} disabled={locked} step="0.01" onChange={(value) => updateAllSegments({ p2_pct: value })} />
          <div className="space-y-4">
            <NumberField label="PctA3" value={sharedSegmentConfig.p3_pct} blank={!hasChosenTemplate} disabled={locked} step="0.01" onChange={(value) => updateAllSegments({ p3_pct: value })} />
            <div className="flex justify-start md:justify-end">
              <button
                type="button"
                disabled={loading || locked}
                onClick={handleResetFactory}
                className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
              >
                Reset về mặc định nhà máy
              </button>
            </div>
          </div>
          </div>
        </div>

        <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-2xl font-semibold">Phụ kiện</h4>
              <p className="app-muted mt-2 text-sm">Chỉ hiện đúng cỡ theo ĐK ngoài tương ứng.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <SearchSelectField
              label="Mặt bích"
              value={selectedAccessoryIds.mat_bich}
              disabled={locked}
              options={accessoryOptions}
              onChange={(value) => updateAccessorySelection('mat_bich', value)}
              placeholder="-- chọn mặt bích --"
            />
            <SearchSelectField
              label="Măng xông"
              value={selectedAccessoryIds.mang_xong}
              disabled={locked}
              options={accessoryOptions}
              onChange={(value) => updateAccessorySelection('mang_xong', value)}
              placeholder="-- chọn măng xông --"
            />
            <SearchSelectField
              label="Mũi cọc"
              value={selectedAccessoryIds.mui_coc}
              disabled={locked}
              options={accessoryOptions}
              onChange={(value) => updateAccessorySelection('mui_coc', value)}
              placeholder="-- chọn mũi cọc --"
            />
            <SearchSelectField
              label="Táp vuông"
              value={selectedAccessoryIds.tap || ACCESSORY_NONE_VALUE}
              disabled={locked}
              options={[
                { value: ACCESSORY_NONE_VALUE, label: 'Không sử dụng' },
                ...accessoryOptions,
              ]}
              onChange={(value) => updateAccessorySelection('tap', value)}
              placeholder="-- chọn táp vuông --"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-4 border-t pt-6 md:grid-cols-3" style={{ borderColor: 'var(--color-border)' }}>
          <NumberField label="Số tim (cọc)" value={pileCount} disabled={locked} onChange={handlePileCountChange} />
          <div className="space-y-3">
            <NumberField
              label="Đơn/kép (vòng)"
              value={fixedSegments[0]?.don_kep_factor || 1}
              disabled={locked}
              onChange={(value) => updateAllSegments({ don_kep_factor: value })}
            />
            <ToggleCheck
              label="Chỉ áp dụng đai kép cho đoạn A1"
              checked={fixedSegments[0]?.dai_kep_chi_a1 ?? true}
              disabled={locked}
              onChange={(value) => updateAllSegments({ dai_kep_chi_a1: value })}
            />
          </div>
          <div className="space-y-3">
            <NumberField
              label="ĐK tâm thép (mm)"
              value={payload.header.dtam_mm}
              disabled={locked || autoDtam}
              onChange={(value) => updateHeader('dtam_mm', value)}
            />
            <ToggleCheck
              label="Tự tính dtam = ĐK ngoài - Thành cọc"
              checked={autoDtam}
              disabled={locked}
              onChange={(value) => {
                setAutoDtam(value)
                if (value) {
                  updateHeader('dtam_mm', Math.max(0, Number(payload.header.do_ngoai || 0) - Number(payload.header.chieu_day || 0)))
                }
              }}
            />
          </div>
        </div>
      </section>

      <section className="app-surface rounded-2xl p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold">Đoạn cọc</h3>
            <p className="app-muted mt-2 text-sm">Nếu không dùng đoạn nào, để “Số đoạn/tim” = 0.</p>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                <th className="px-4 py-3 font-semibold">Đoạn</th>
                <th className="px-4 py-3 font-semibold">Số đoạn/tim</th>
                <th className="px-4 py-3 font-semibold">Chiều dài (m)</th>
              </tr>
            </thead>
            <tbody>
              {fixedSegments.map((segment) => {
                const perTim = derivePerTimCount(segment, pileCount || 1)
                return (
              <tr key={segment.ten_doan} className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
                    <td className="px-4 py-3 text-sm font-semibold">{friendlySegmentName(segment.ten_doan)}</td>
                    <td className="px-4 py-3 text-right">
                      <InlineTableNumberField
                        value={perTim}
                        disabled={locked}
                        onChange={(value) =>
                          updateSegmentByName(segment.ten_doan, {
                            cnt: value,
                            so_luong_doan: value * pileCount,
                            mui_segments: segment.ten_doan === 'MUI' ? pileCount : 0,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <InlineTableNumberField
                        value={segment.len_m}
                        disabled={locked}
                        onChange={(value) => updateSegmentByName(segment.ten_doan, { len_m: value })}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {!qlsxViewer ? (
        <section className="app-surface rounded-2xl p-6">
          <h3 className="text-2xl font-semibold">Vận chuyển</h3>
          <div className="mt-5 grid gap-4 border-t pt-6 md:grid-cols-2" style={{ borderColor: 'var(--color-border)' }}>
            <SearchSelectField
              label="Phương thức vận chuyển"
              value={payload.header.phuong_thuc_van_chuyen}
              disabled={locked}
              options={[
                { value: 'ROAD_WITH_CRANE', label: 'Đường bộ có cẩu' },
                { value: 'ROAD_NO_CRANE', label: 'Đường bộ không cẩu' },
                { value: 'WATERWAY', label: 'Đường thủy' },
                { value: 'OTHER', label: 'Không vận chuyển' },
              ]}
              onChange={(value) => updateHeader('phuong_thuc_van_chuyen', value as BocTachDetailPayload['header']['phuong_thuc_van_chuyen'])}
              placeholder="-- chọn --"
            />
            <NumberField
              label={
                payload.header.phuong_thuc_van_chuyen === 'OTHER'
                  ? 'Đơn giá vận chuyển/md (VND)'
                  : 'Đơn giá/chuyến (VND)'
              }
              value={payload.header.don_gia_van_chuyen}
              disabled={locked}
              onChange={(value) => updateHeader('don_gia_van_chuyen', value)}
            />
            {payload.header.phuong_thuc_van_chuyen === 'WATERWAY' ? (
              <NumberField
                label="Md/chuyến (tự nhập)"
                value={payload.header.md_per_trip_input}
                disabled={locked}
                onChange={(value) => updateHeader('md_per_trip_input', value)}
              />
            ) : payload.header.phuong_thuc_van_chuyen === 'OTHER' ? (
              <ReadOnlyField
                label="Md áp phí"
                value={String(totalMd)}
              />
            ) : (
              <ReadOnlyField label="Md/chuyến (phần mềm tự tính)" value={String(preview.van_chuyen.md_per_trip)} />
            )}
            <Field label="Ghi chú vận chuyển" value={payload.header.ten_boc_tach} disabled={locked} onChange={(value) => updateHeader('ten_boc_tach', value)} />
          </div>
          <p className="app-muted mt-3 text-sm">
            Đường bộ: phần mềm tự tính md/chuyến theo đường kính, kg/md và bộ đoạn cọc. Đường thủy: nhập md/chuyến + đơn giá/chuyến. Không vận chuyển: có thể nhập thêm đơn giá vận chuyển/md; để trống hoặc 0 thì xem như khách vào tận xưởng lấy hàng.
          </p>
        </section>
      ) : null}

      <section className="app-surface rounded-2xl p-3">
        <div className="flex flex-wrap gap-2">
          {visibleTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                markInteracted()
                setTab(item.key)
              }}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === item.key ? 'app-primary' : 'app-outline'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {tab === 'tong-hop' ? (
        <section className="space-y-6">
          <SummaryPanel title="Tổng hợp">
            <SummaryStat label="Tổng md" value={formatNumber(totalMd)} />
            <SummaryStat label="Md/tim" value={formatNumber(mdPerTim)} />
            <SummaryStat label="Tổng số tim" value={String(pileCount)} />
          </SummaryPanel>

          {!qlsxViewer ? (
            <SummaryPanel title="Vận chuyển">
              <SummaryStat label="Phương thức" value={transportMethodLabel(payload.header.phuong_thuc_van_chuyen)} />
              <SummaryStat label="Đơn giá/chuyến" value={`${formatMoney(payload.header.don_gia_van_chuyen)} VND`} />
              <SummaryStat label="Md/chuyến áp dụng" value={String(preview.van_chuyen.md_per_trip)} />
              <SummaryStat label="Số chuyến" value={String(preview.van_chuyen.so_chuyen)} />
              <SummaryStat label="Chi phí VC tổng" value={`${formatMoney(preview.van_chuyen.phi_van_chuyen)} VND`} />
              <SummaryStat label="Chi phí VC/md" value={`${formatMoney(totalMd > 0 ? preview.van_chuyen.phi_van_chuyen / totalMd : 0)} VND/md`} />
              {preview.van_chuyen.details.length > 0 ? (
                <div className="col-span-full pt-2">
                  <ExpandableTechTable
                    title="Thông số trung gian vận chuyển"
                    rows={preview.van_chuyen.details.map((item) => ({
                      description: item.label,
                      unit: '',
                      symbol: '',
                      value: item.value,
                    }))}
                  />
                </div>
              ) : null}
            </SummaryPanel>
          ) : null}

          <ReportTableSection
            title="Vật tư chính"
            headers={['Tên vật liệu', 'ĐVT', 'Khối lượng']}
            rows={mainMaterialRows.map((row) => [row.label, row.dvt, formatNumber(row.qty)])}
          />
          <ReportTableSection
            title="Phụ kiện"
            headers={['Tên vật liệu', 'ĐVT', 'Khối lượng']}
            rows={accessoryRows.map((row) => [row.label, row.dvt, formatNumber(row.qty)])}
          />
          <ReportTableSection
            title="Vật tư phụ"
            headers={['Tên vật liệu', 'ĐVT', 'Khối lượng']}
            rows={auxiliaryRows.map((row) => [row.label, row.dvt, formatNumber(row.qty)])}
          />
        </section>
      ) : null}

      {tab === 'chi-tiet' ? (
        <section className="space-y-6">
          <SectionToggleBar
            title="Thông số trung gian (đối chiếu Sheet)"
            open={showSegmentIntermediate}
            onToggle={() => setShowSegmentIntermediate((prev) => !prev)}
          />
          {showSegmentIntermediate ? (
            <IntermediateSummaryTable rows={buildSegmentIntermediateRows(payload, preview)} />
          ) : null}
          {activeSegmentSnapshots.map((snapshot) => (
            <SegmentCard key={snapshot.ten_doan} snapshot={snapshot} />
          ))}
        </section>
      ) : null}

      {tab === 'du-toan' ? (
        <section className="space-y-6">
          {!refs.hasFullReferenceData ? (
            <section className="rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
              {loadingReferenceData
                ? 'Đang nạp dữ liệu giá, thuế và lợi nhuận...'
                : 'Dữ liệu giá, thuế và lợi nhuận sẽ nạp khi bạn bắt đầu thao tác.'}
            </section>
          ) : null}
          <PricingTable
            title="Chi phí nguyên vật liệu"
            rows={allMaterialRows}
          />

          <EstimateSideCosts
            disabled={locked}
            totalMd={totalMd}
            otherCostPerMd={otherCostPerMd}
            transportMode={payload.header.phuong_thuc_van_chuyen}
            shippingPrice={payload.header.don_gia_van_chuyen}
            shippingTrips={preview.van_chuyen.so_chuyen}
            shippingAmount={preview.van_chuyen.phi_van_chuyen}
          />

          <EstimateSummaryCard
            profitPct={profitPct}
            taxPct={taxPct}
            disabled={locked}
            onProfitPctChange={(value) => {
              setProfitPct(value)
              setProfitPctTouched(true)
            }}
            onTaxPctChange={(value) => {
              setTaxPct(value)
              setTaxPctTouched(true)
            }}
            subtotal={subtotal}
            donGiaVonPerMd={donGiaVonPerMd}
            salePriceExVatPerMd={salePriceExVatPerMd}
            salePriceInVatPerMd={salePriceInVatPerMd}
            preTaxAmount={preTaxAmount}
            finalAmount={finalAmount}
          />
        </section>
      ) : null}

      {tab === 'thong-so' ? (
        <section className="space-y-6">
          <TechnicalOverviewCard
            tech={preview.tech}
            ratio={payload.header.r}
            disabled={locked}
            onRatioChange={(value) => updateHeader('r', value)}
            onRecalculate={() => setPayload((prev) => ({ ...prev }))}
          />
          <ExpandableTechTable
            title="I. Thông số (Input + trung gian)"
            rows={buildTechInputRows(payload, preview)}
            defaultOpen
          />
          <ExpandableTechTable
            title="II. Kết quả (Output chính)"
            rows={buildTechOutputRows(preview.tech)}
          />
        </section>
      ) : null}

      <section className="app-surface rounded-2xl p-6">
        {payload.header.trang_thai === 'TRA_LAI' && (payload.header.qlsx_ly_do_code || payload.header.qlsx_ly_do_text) ? (
          <section
            className="mb-5 rounded-2xl border px-4 py-4 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'color-mix(in srgb, var(--color-primary) 4%, white)',
            }}
          >
            <p className="font-semibold">QLSX đã trả lại hồ sơ để chỉnh sửa</p>
            <p className="app-muted mt-2">
              Lý do:{' '}
              {reviewReasons.find((item) => item.value === payload.header.qlsx_ly_do_code)?.label ||
                payload.header.qlsx_ly_do_code ||
                '-'}
            </p>
            {payload.header.qlsx_ly_do_text ? (
              <p className="app-muted mt-1">Ghi chú thêm: {payload.header.qlsx_ly_do_text}</p>
            ) : null}
          </section>
        ) : null}

        {canReview ? (
          <section
            className="mb-5 rounded-2xl border px-4 py-4"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h4 className="text-base font-semibold">QLSX duyệt bóc tách</h4>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <SearchSelectField
                label="Lý do trả lại"
                value={returnReasonCode}
                disabled={loading}
                options={reviewReasons}
                onChange={setReturnReasonCode}
                placeholder="-- chọn lý do --"
              />
              <Field
                label="Ghi chú thêm"
                value={returnReasonText}
                disabled={loading}
                onChange={setReturnReasonText}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => submitAction('return')}
                className="app-accent-soft rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
              >
                Trả lại chỉnh sửa
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => submitAction('approve')}
                className="app-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
              >
                Duyệt QLSX
              </button>
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {!qlsxViewer ? (
            <>
              {canSoftReopen || canAdminReopenApproved ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void reopenEstimate()}
                  className="app-outline rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
                >
                  {canAdminReopenApproved ? 'Admin mở lại bóc tách' : 'Mở lại bóc tách'}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canSaveDraft}
                onClick={() => submitAction('save')}
                className="app-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
              >
                Lưu nháp
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => submitAction('send')}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                Gửi QLSX
              </button>
            </>
          ) : null}
          <span className="app-muted text-sm">
            Trạng thái: <span className="font-semibold">{formatStatusLabel(payload.header.trang_thai)}</span>
          </span>
        </div>

        {error ? <p className="mt-3 text-sm" style={{ color: 'var(--color-accent)' }}>{error}</p> : null}
        {message ? <p className="mt-3 text-sm" style={{ color: 'var(--color-primary)' }}>{message}</p> : null}
        {!qlsxViewer && !locked && hasPersistedDraft && !hasUnsavedChanges ? (
          <p className="app-muted mt-3 text-sm">
            Hồ sơ này đã được <span className="font-semibold">Lưu nháp</span>. Chỉnh sửa dữ liệu nếu bạn muốn cập nhật lại.
          </p>
        ) : null}
        {!qlsxViewer && !locked && !canSend ? (
          <p className="app-muted mt-3 text-sm">
            Muốn gửi QLSX, hồ sơ phải được <span className="font-semibold">Lưu nháp</span> ở bản mới nhất.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function SegmentCard(props: { snapshot: SegmentNvlSnapshot }) {
  const segmentName = friendlySegmentName(props.snapshot.ten_doan)
  const rows = [
    ['1', 'Thép PC', 'kg', formatNumber(props.snapshot.pc_kg)],
    ['2', 'Thép đai', 'kg', formatNumber(props.snapshot.dai_kg)],
    ['3', 'Thép buộc', 'kg', formatNumber(props.snapshot.thep_buoc_kg)],
    ['4', 'Bê tông', 'm3', formatNumber(props.snapshot.concrete_m3)],
    ['5', 'Mặt bích', 'cái', formatNumber(props.snapshot.mat_bich)],
    ['6', 'Măng xông', 'cái', formatNumber(props.snapshot.mang_xong)],
    ['7', 'Mũi cọc', 'cái', formatNumber(props.snapshot.mui_coc)],
    ['8', 'Táp vuông', 'cái', formatNumber(props.snapshot.tap)],
    ...props.snapshot.auxiliary_items.map((item, index) => [
      String(index + 9),
      item.ten_nvl,
      item.dvt,
      formatNumber(item.qty),
    ]),
  ].filter((row) => Number(row[3].replace(/\./g, '').replace(',', '.')) > 0)

  return (
    <section className="app-surface rounded-2xl p-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Chiều dài:</span>
        <SegmentPill label={`${formatNumber(props.snapshot.len_m)} m`} />
        <span className="app-muted text-base">•</span>
        <SegmentPill label={`${formatNumber(props.snapshot.so_luong_doan)} đoạn/tim`} />
        <span className="app-muted text-base">•</span>
        <SegmentPill label={`Tổng md: ${formatNumber(roundTo(props.snapshot.len_m * props.snapshot.so_luong_doan, 3))}`} accent />
        <span className="app-muted text-base">•</span>
        <SegmentPill label={segmentName} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
              {['STT', 'Tên vật liệu', 'ĐVT', 'Khối lượng'].map((header) => (
                <th key={header} className="px-4 py-3 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={`${props.snapshot.ten_doan}-${rowIndex}`}
                className="border-t"
                style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}
              >
                <td className="px-4 py-3 font-semibold">{row[0]}</td>
                <td className="px-4 py-3 font-semibold">{row[1]}</td>
                <td className="px-4 py-3">{row[2]}</td>
                <td className="px-4 py-3 text-right font-semibold">{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PricingTable(props: {
  title: string
  rows: CostRow[]
}) {
  return (
    <section className="app-surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold">{props.title}</h3>
      <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[11%]" />
            <col className="w-[19%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
              <th className="px-4 py-3 text-xs font-bold tracking-[0.16em] uppercase text-slate-500">Tên vật liệu</th>
              <th className="px-4 py-3 text-xs font-bold tracking-[0.16em] uppercase text-slate-500">ĐVT</th>
              <th className="px-4 py-3 text-right text-xs font-bold tracking-[0.16em] uppercase text-slate-500">Khối lượng</th>
              <th className="px-4 py-3 text-right text-xs font-bold tracking-[0.16em] uppercase text-slate-500">Đơn giá</th>
              <th className="px-4 py-3 text-right text-xs font-bold tracking-[0.16em] uppercase text-slate-500">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-5 app-muted">Chưa có dữ liệu chi phí nguyên vật liệu.</td>
              </tr>
            ) : null}
            {props.rows.map((row) => (
              <tr key={row.key} className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
                <td className="px-4 py-3 font-semibold">{row.label}</td>
                <td className="px-4 py-3">{row.dvt}</td>
                <td className="px-4 py-3 text-right">{formatNumber(row.qty)}</td>
                <td className="px-4 py-3 text-right">{formatMoney(row.price)}</td>
                <td className="px-4 py-3 text-right font-bold">{formatMoney(row.amount)}</td>
              </tr>
            ))}
            <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className="px-4 py-4 text-lg font-semibold" colSpan={4}>Tổng chi phí NVL</td>
              <td className="px-4 py-4 text-right text-lg font-bold">{formatMoney(sumRows(props.rows))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SummaryPanel(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="app-surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold">{props.title}</h3>
      <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        {props.children}
      </div>
    </section>
  )
}

function SummaryStat(props: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b px-6 py-4 text-sm last:border-b-0" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
      <span className="font-medium app-muted">{props.label}</span>
      <span className="text-right text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{props.value}</span>
    </div>
  )
}

function TableCard(props: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <section className="app-surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold">{props.title}</h3>
      <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[66%]" />
            <col className="w-[10%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
              {props.headers.map((header, index) => (
                <th
                  key={header}
                  className={`px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase ${
                    index === 0 ? 'text-left' : 'text-right'
                  }`}
                  style={{ color: 'color-mix(in srgb, var(--color-text) 58%, white)' }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.length === 0 ? (
              <tr>
                <td className="px-4 py-4 app-muted" colSpan={props.headers.length}>Chưa có dữ liệu.</td>
              </tr>
            ) : (
              props.rows.map((row, rowIndex) => (
                <tr key={`${props.title}-${rowIndex}`} className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${rowIndex}-${cellIndex}`}
                      className={`px-4 py-3 ${
                        cellIndex === 0 ? 'font-medium' : 'text-right'
                      } ${cellIndex === row.length - 1 ? 'font-semibold' : ''}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ReportTableSection(props: { title: string; headers: string[]; rows: string[][] }) {
  return <TableCard {...props} />
}

function EstimateSideCosts(props: {
  disabled?: boolean
  totalMd: number
  otherCostPerMd: number
  transportMode: BocTachDetailPayload['header']['phuong_thuc_van_chuyen']
  shippingPrice: number
  shippingTrips: number
  shippingAmount: number
}) {
  return (
    <section className="app-surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold">Chi phí khác + vận chuyển</h3>
      <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[11%]" />
            <col className="w-[19%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
              {['Khoản mục', 'ĐVT', 'Khối lượng', 'Đơn giá', 'Thành tiền'].map((header) => (
                <th
                  key={header}
                  className={`px-4 py-3 text-xs font-bold tracking-[0.16em] uppercase text-slate-500 ${
                    header === 'Khoản mục' ? 'text-left' : 'text-right'
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
              <td className="px-4 py-3 font-semibold">Chi phí khác</td>
              <td className="px-4 py-3 text-right">vnd/md</td>
              <td className="px-4 py-3 text-right">{formatNumber(props.totalMd)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(props.otherCostPerMd)}</td>
              <td className="px-4 py-3 text-right font-semibold">
                {formatMoney(props.totalMd * Number(props.otherCostPerMd || 0))}
              </td>
            </tr>
            <tr className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
              <td className="px-4 py-3 font-semibold">Vận chuyển</td>
              <td className="px-4 py-3 text-right">{props.transportMode === 'OTHER' ? 'vnd/md' : 'VND'}</td>
              <td className="px-4 py-3 text-right">{props.transportMode === 'OTHER' ? formatNumber(props.totalMd) : props.shippingTrips}</td>
              <td className="px-4 py-3 text-right">{formatMoney(props.shippingPrice)}</td>
              <td className="px-4 py-3 text-right font-semibold">{formatMoney(props.shippingAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EstimateSummaryCard(props: {
  disabled?: boolean
  profitPct: string
  taxPct: string
  onProfitPctChange: (value: string) => void
  onTaxPctChange: (value: string) => void
  subtotal: number
  donGiaVonPerMd: number
  salePriceExVatPerMd: number
  salePriceInVatPerMd: number
  preTaxAmount: number
  finalAmount: number
}) {
  return (
    <section className="app-surface rounded-2xl p-6">
      <h3 className="text-lg font-semibold">Tổng hợp chi phí</h3>
      <section className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center border-b px-6 py-4 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
          <span className="font-semibold app-muted">Tổng chi phí</span>
          <span className="text-right text-base font-semibold">{formatMoney(props.subtotal)}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center border-b px-6 py-4 text-sm" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
          <span className="font-semibold app-muted">Đơn giá vốn/md</span>
          <span className="text-right text-base font-semibold">{formatMoney(props.donGiaVonPerMd)}</span>
        </div>
        <div className="grid gap-4 border-b px-6 py-4 text-sm md:grid-cols-[minmax(0,1fr)_164px_220px] md:items-center" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
          <span className="font-semibold app-muted">Đơn giá bán chưa VAT</span>
          <PercentInput
            value={props.profitPct}
            disabled={props.disabled}
            onChange={props.onProfitPctChange}
            ariaLabel="Lợi nhuận (%)"
          />
          <span className="text-right text-base font-semibold">{formatMoney(props.salePriceExVatPerMd)}</span>
        </div>
        <div className="grid gap-4 px-6 py-4 text-sm md:grid-cols-[minmax(0,1fr)_164px_220px] md:items-center">
          <span className="font-semibold app-muted">Đơn giá VAT</span>
          <PercentInput
            value={props.taxPct}
            disabled={props.disabled}
            onChange={props.onTaxPctChange}
            ariaLabel="VAT (%)"
          />
          <span className="text-right text-base font-semibold">{formatMoney(props.salePriceInVatPerMd)}</span>
        </div>
      </section>
      <p className="mt-4 text-sm font-semibold">
        Tổng giá chưa VAT: {formatMoney(props.preTaxAmount)} · Tổng giá đã VAT: {formatMoney(props.finalAmount)}
      </p>
    </section>
  )
}

function TechnicalOverviewCard(props: {
  tech: TechPreview
  ratio: number
  disabled?: boolean
  onRatioChange: (value: number) => void
  onRecalculate: () => void
}) {
  const primaryRows = [
    {
      stt: '1',
      label: 'Khả năng chịu nén dọc trục dài hạn',
      dvt: 'tấn',
      value: props.tech.ra_l,
    },
    {
      stt: '2',
      label: 'Khả năng chịu nén dọc trục ngắn hạn',
      dvt: 'tấn',
      value: props.tech.ra_s,
    },
    {
      stt: '3',
      label: 'Moment kháng uốn nứt cọc',
      dvt: '(t.m)',
      value: props.tech.mcr,
    },
  ]

  return (
    <section className="app-surface rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">Thông số kỹ thuật</h3>
          <div className="mt-4 space-y-2">
            <label className="text-sm font-semibold" htmlFor="tech-ratio-input">
              Tỷ lệ cường độ tại truyền lực (σcp/σcu)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="tech-ratio-input"
                type="number"
                step="0.01"
                value={Number.isFinite(props.ratio) ? String(props.ratio) : '0.7'}
                disabled={props.disabled}
                onChange={(event) => props.onRatioChange(Number(event.target.value || 0))}
                className="app-input w-full max-w-[280px] rounded-xl border px-4 py-3 text-base outline-none"
                style={{ borderColor: 'var(--color-border)' }}
              />
              <button
                type="button"
                onClick={props.onRecalculate}
                className="app-outline rounded-xl px-4 py-3 text-sm font-semibold transition"
                disabled={props.disabled}
              >
                Tính lại
              </button>
            </div>
            <p className="app-muted text-sm">Mặc định 0.70. Chỉnh xong bấm “Tính lại”.</p>
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
              {['STT', 'Hệ số', 'Đơn vị', 'Giá trị'].map((header) => (
                <th key={header} className={`px-4 py-3 text-sm font-semibold ${header === 'Giá trị' ? 'text-right' : 'text-left'}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {primaryRows.map((row) => (
              <tr key={row.stt} className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
                <td className="px-4 py-3">{row.stt}</td>
                <td className="px-4 py-3">{row.label}</td>
                <td className="px-4 py-3">{row.dvt}</td>
                <td className="px-4 py-3 text-right font-semibold">{formatNumber(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type TechTableRow = {
  description: string
  unit: string
  symbol: string
  value: string
}

function ExpandableTechTable(props: { title: string; rows: TechTableRow[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen))

  return (
    <details open={open} className="app-surface rounded-2xl px-6 py-4">
      <summary
        className="cursor-pointer list-none text-sm font-semibold"
        onClick={(event) => {
          event.preventDefault()
          setOpen((prev) => !prev)
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span>{props.title}</span>
          <span className="app-muted text-sm font-semibold">{open ? 'Thu gọn lại' : 'Bấm mở rộng'}</span>
        </div>
      </summary>
      {open ? (
        <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[50%]" />
              <col className="w-[14%]" />
              <col className="w-[16%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead>
              <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                {[
                  { key: 'Descriptions', align: 'text-left' },
                  { key: 'Unit', align: 'text-left' },
                  { key: 'Symbol', align: 'text-left' },
                  { key: 'Value', align: 'text-right' },
                ].map((header) => (
                  <th
                    key={header.key}
                    className={`px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase ${header.align}`}
                    style={{ color: 'color-mix(in srgb, var(--color-text) 58%, white)' }}
                  >
                    {header.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={`${row.description}-${row.symbol}-${row.unit}`} className="border-t" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
                  <td className="px-4 py-3">{row.description}</td>
                  <td className="px-4 py-3">{row.unit || ' '}</td>
                  <td className="px-4 py-3">{row.symbol}</td>
                  <td className="px-4 py-3 text-right font-semibold">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </details>
  )
}

function SectionToggleBar(props: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border bg-white px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
      <button type="button" onClick={props.onToggle} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{props.title}</span>
        <span className="app-muted text-sm font-semibold">{props.open ? 'Thu gọn lại' : 'Bấm mở rộng'}</span>
      </button>
    </div>
  )
}

function IntermediateSummaryTable(props: { rows: Array<[string, string, string]> }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-white" style={{ borderColor: 'var(--color-border)' }}>
      <table className="w-full table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[62%]" />
          <col className="w-[12%]" />
          <col className="w-[26%]" />
        </colgroup>
        <tbody>
          {props.rows.map((row) => (
            <tr key={`${row[0]}-${row[2]}`} className="border-t first:border-t-0" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
              <td className="px-4 py-3">{row[0]}</td>
              <td className="px-4 py-3">{row[1]}</td>
              <td className="px-4 py-3 text-right font-semibold">{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SegmentPill(props: { label: string; accent?: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-4 py-2 text-base font-semibold"
      style={{
        borderColor: props.accent
          ? 'color-mix(in srgb, #34c759 36%, white)'
          : 'color-mix(in srgb, var(--color-border) 82%, white)',
        backgroundColor: props.accent
          ? 'color-mix(in srgb, #34c759 12%, white)'
          : 'white',
        color: props.accent
          ? 'color-mix(in srgb, #1c7f43 88%, var(--color-text))'
          : 'color-mix(in srgb, var(--color-text) 80%, white)',
      }}
    >
      {props.label}
    </span>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  type?: 'text' | 'number'
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="app-muted block">{props.label}</span>
      <input
        type={props.type || 'text'}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        className="app-input w-full rounded-xl px-3 py-2"
      />
    </label>
  )
}

function PercentInput(props: {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  ariaLabel: string
}) {
  return (
    <div className="relative w-full">
      <input
        type="text"
        inputMode="decimal"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        aria-label={props.ariaLabel}
        className="app-input h-9 w-full rounded-lg px-3 py-2 pr-8 text-right"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm app-muted">
        %
      </span>
    </div>
  )
}

function NumberField(props: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  step?: string
  blank?: boolean
}) {
  const normalizedValue =
    props.blank && Number(props.value || 0) === 0 ? '' : Number.isFinite(props.value) ? String(props.value) : '0'
  const [draft, setDraft] = useState(normalizedValue)
  const [focused, setFocused] = useState(false)

  return (
    <label className="space-y-1 text-sm">
      <span className="app-muted block">{props.label}</span>
      <input
        type="text"
        inputMode={props.step ? 'decimal' : 'numeric'}
        value={focused ? draft : normalizedValue}
        disabled={props.disabled}
        onFocus={() => {
          setDraft(normalizedValue)
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
          const trimmed = draft.trim()
          if (!trimmed) {
            props.onChange(0)
            return
          }
          const parsed = Number(trimmed)
          props.onChange(Number.isFinite(parsed) ? parsed : 0)
        }}
        onChange={(e) => {
          const nextValue = e.target.value
          setDraft(nextValue)
          if (!nextValue.trim()) {
            props.onChange(0)
            return
          }
          if (props.step) {
            if (/^-?\d*(?:[.,]\d*)?$/.test(nextValue)) {
              const parsed = Number(nextValue.replace(',', '.'))
              if (Number.isFinite(parsed)) props.onChange(parsed)
            }
            return
          }
          if (/^-?\d*$/.test(nextValue)) {
            const parsed = Number(nextValue)
            if (Number.isFinite(parsed)) props.onChange(parsed)
          }
        }}
        className="app-input w-full rounded-xl px-3 py-2"
      />
    </label>
  )
}

function SearchSelectField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  placeholder?: string
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const selectedOption = props.options.find((option) => option.value === props.value) ?? null
  const [searchText, setSearchText] = useState('')
  const [open, setOpen] = useState(false)
  const displayValue = selectedOption?.label || ''

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setSearchText('')
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const filteredOptions = useMemo(() => {
    const keyword = normalizeText(searchText)
    if (!keyword) return props.options
    return props.options.filter((option) => normalizeText(option.label).includes(keyword))
  }, [props.options, searchText])

  function commitSelection(nextValue: string) {
    const option = props.options.find((item) => item.value === nextValue) ?? null
    props.onChange(option?.value || '')
    setSearchText('')
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} className="relative space-y-1 text-sm">
      <span className="app-muted block">{props.label}</span>
      <div className="relative">
        <input
          type="text"
          value={displayValue}
          readOnly
          disabled={props.disabled}
          placeholder={props.placeholder || '-- chọn --'}
          onFocus={() => {
            if (props.disabled) return
            setSearchText('')
            setOpen(true)
          }}
          onClick={() => {
            if (props.disabled) return
            setSearchText('')
            setOpen(true)
          }}
          className="app-input w-full rounded-xl px-3 py-2 pr-10"
        />
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => {
            if (props.disabled) return
            setOpen((prev) => {
              const nextOpen = !prev
              if (!nextOpen) setSearchText('')
              return nextOpen
            })
          }}
          className="absolute inset-y-0 right-3 my-auto text-sm app-muted disabled:opacity-40"
          aria-label={`Mở danh sách ${props.label}`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && !props.disabled ? (
        <div
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-xl border bg-white shadow-lg"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="border-b p-2" style={{ borderColor: 'color-mix(in srgb, var(--color-border) 72%, white)' }}>
            <input
              type="text"
              value={searchText}
              placeholder="Gõ để tìm..."
              onChange={(event) => setSearchText(event.target.value)}
              className="app-input w-full rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={`${option.value}-${option.label}`}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitSelection(option.value)}
                className={`block w-full px-3 py-2 text-left text-sm transition ${
                  option.value === props.value ? 'font-semibold' : ''
                }`}
                style={{
                  backgroundColor:
                    option.value === props.value
                      ? 'color-mix(in srgb, var(--color-primary) 10%, white)'
                      : 'white',
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm app-muted">Không tìm thấy kết quả phù hợp.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function transportMethodLabel(
  value: BocTachDetailPayload['header']['phuong_thuc_van_chuyen']
) {
  switch (value) {
    case 'ROAD_WITH_CRANE':
      return 'Đường bộ có cẩu'
    case 'ROAD_NO_CRANE':
      return 'Đường bộ không cẩu'
    case 'WATERWAY':
      return 'Đường thủy'
    default:
      return 'Không vận chuyển'
  }
}

function normalizeConcreteGradeOption(value: string | number | null | undefined) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const match = raw.match(/\d+(?:[.,]\d+)?/g)
  if (!match || match.length === 0) return ''
  const numeric = Number(match[match.length - 1].replace(',', '.'))
  if (!Number.isFinite(numeric) || numeric < 100 || numeric > 2000) return ''
  return String(Math.round(numeric))
}

function normalizeConcreteMixVariant(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
}

function ReadOnlyField(props: { label: string; value: string }) {
  return (
    <div className="space-y-1 text-sm">
      <span className="app-muted block">{props.label}</span>
      <div className="app-input min-h-11 rounded-xl px-3 py-2">{props.value || '-'}</div>
    </div>
  )
}

function ToggleCheck(props: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="inline-flex items-center gap-3 text-sm font-semibold">
      <input
        type="checkbox"
        disabled={props.disabled}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-5 w-5 rounded border"
      />
      <span>{props.label}</span>
    </label>
  )
}

function InlineTableNumberField(props: {
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={Number.isFinite(props.value) ? props.value : 0}
      disabled={props.disabled}
      onChange={(e) => props.onChange(Number(e.target.value || 0))}
      className="app-input w-full rounded-xl px-3 py-3 text-right text-base"
    />
  )
}

function extractSteelGradeFromPileType(value: string) {
  const normalized = String(value || '').trim().toUpperCase()
  const match = normalized.match(/-\s*([ABC])\d+/)
  return match?.[1] ?? ''
}

function extractCuongDoFromPileType(value: string) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized.startsWith('PHC')) return 'PHC'
  if (normalized.startsWith('PC')) return 'PC'
  return ''
}

function buildDerivedPileType(currentLoaiCoc: string, doNgoai: number, chieuDay: number) {
  const cuongDo = extractCuongDoFromPileType(currentLoaiCoc)
  const steelGrade = extractSteelGradeFromPileType(currentLoaiCoc)
  if (!cuongDo || !steelGrade || Number(doNgoai || 0) <= 0 || Number(chieuDay || 0) <= 0) {
    return currentLoaiCoc
  }
  return `${cuongDo} - ${steelGrade}${Number(doNgoai)} - ${Number(chieuDay)}`
}

function normalizeText(value: string) {
  return value
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function normalizeGroup(value: string) {
  return normalizeText(value).replace(/\s+/g, '_')
}

function accessoryKindFromName(value: string) {
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

function resolveAccessorySelectionId(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap'
) {
  const matchedItem = findLastAccessoryItem(items, materials, kind)
  if (matchedItem?.nvl_id) return matchedItem.nvl_id

  return ''
}

function resolveAccessoryLabel(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap',
  fallback: string
) {
  const matchedItem = findLastAccessoryItem(items, materials, kind)
  if (matchedItem?.ten_nvl) return matchedItem.ten_nvl

  if (matchedItem?.nvl_id) {
    const material = materials.find((row) => row.nvl_id === matchedItem.nvl_id)
    if (material?.ten_hang) return material.ten_hang
  }

  return fallback
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

function findLastAccessoryItem(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap'
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (resolveAccessoryKindForItem(item, materials) === kind) {
      return item
    }
  }
  return null
}

function parseMaterialDiameter(value: string) {
  const match = normalizeText(value).match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function resolveSteelSelectionId(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'pc' | 'dai' | 'buoc',
  currentLabel: string,
  diameter: number
) {
  const fromItems = items.find((item) => {
    if (item.loai_nvl !== 'THEP') return false
    const normalized = normalizeText(item.ten_nvl)
    if (kind === 'pc') return normalized.includes('PC')
    if (kind === 'dai') return normalized.includes('DAI')
    return normalized.includes('BUOC')
  })
  if (fromItems?.nvl_id) return fromItems.nvl_id

  const normalizedLabel = normalizeText(currentLabel)
  const exactByLabel = materials.find((item) => {
    const normalizedName = normalizeText(item.ten_hang)
    return (
      normalizeGroup(item.nhom_hang) === 'THEP' &&
      normalizedLabel.length > 0 &&
      normalizedName === normalizedLabel
    )
  })
  if (exactByLabel) return exactByLabel.nvl_id

  const kindToken = kind === 'pc' ? 'PC' : kind === 'dai' ? 'DAI' : 'BUOC'
  const byDiameter = materials.find((item) => {
    const normalizedName = normalizeText(item.ten_hang)
    return (
      normalizeGroup(item.nhom_hang) === 'THEP' &&
      normalizedName.includes(kindToken) &&
      parseMaterialDiameter(item.ten_hang) === Number(diameter || 0)
    )
  })
  return byDiameter?.nvl_id || ''
}

function sumRows(rows: CostRow[]) {
  return rows.reduce((acc, row) => acc + row.amount, 0)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(value || 0))
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0))
}

function sanitizeProjectLocation(value: string) {
  return String(value || '')
    .replaceAll('[VI_TRI_CONG_TRINH]:', '')
    .replaceAll('[KHU_VUC]:', '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*([^,]+),\s*\1$/u, ', $1')
    .trim()
}

function formatStatusLabel(value: string) {
  switch (value) {
    case 'DA_GUI':
      return 'Đã gửi QLSX'
    case 'TRA_LAI':
      return 'Trả lại chỉnh sửa'
    case 'DA_DUYET_QLSX':
      return 'Đã duyệt QLSX'
    case 'HUY':
      return 'Hủy'
    case 'NHAP':
    default:
      return 'Nháp'
  }
}

function buildDraftSnapshot(payload: BocTachDetailPayload, derivedLoaiCoc: string) {
  return JSON.stringify({
    header: {
      ...payload.header,
      loai_coc: derivedLoaiCoc,
    },
    items: sanitizeItems(payload.items),
    segments: sanitizeSegments(payload.segments),
  })
}

function roundTo(value: number, fractionDigits: number) {
  return Number(value.toFixed(fractionDigits))
}

function friendlySegmentName(value: string) {
  if (value === 'MUI') return 'Mũi'
  if (value.startsWith('THAN_')) return value.replace('THAN_', 'Thân ')
  return value
}

function derivePileCount(segments: BocTachSegmentInput[]) {
  const quantities = segments
    .map((segment) => Number(segment.so_luong_doan || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (quantities.length === 0) return 10
  return Math.min(...quantities)
}

function derivePerTimCount(segment: BocTachSegmentInput, pileCount: number) {
  const cnt = Number(segment.cnt || 0)
  const total = Number(segment.so_luong_doan || 0)
  if (cnt > 0 && cnt !== total) return cnt
  if (pileCount > 0 && total > 0) return roundTo(total / pileCount, 3)
  return cnt > 0 ? cnt : total
}

function buildTechInputRows(payload: BocTachDetailPayload, preview: BocTachPreview): TechTableRow[] {
  return [
    { description: 'Đường kính ngoài', unit: 'mm', symbol: 'do', value: formatNumber(preview.tech.do_mm) },
    { description: 'Chiều dày cọc', unit: 'mm', symbol: 't', value: formatNumber(preview.tech.t_mm) },
    { description: 'Đường kính trong', unit: 'mm', symbol: 'di', value: formatNumber(preview.tech.di_mm) },
    { description: 'Đường kính bố trí dây thép', unit: 'mm', symbol: 'dp', value: formatNumber(preview.tech.dp_mm) },
    { description: 'Đường kính trung bình của cọc', unit: 'mm', symbol: 'd', value: formatNumber(preview.tech.d_mm) },
    { description: 'Cường độ chịu nén (mẫu trụ)', unit: 'N/mm²', symbol: 'σcu', value: formatNumber(preview.tech.sigma_cu) },
    { description: 'Tỷ lệ cường độ tại truyền lực', unit: '', symbol: 'r', value: formatNumber(payload.header.r) },
    { description: 'Cường độ tại truyền lực', unit: 'N/mm²', symbol: 'σcp', value: formatNumber(preview.tech.sigma_cp) },
    { description: 'Cường độ chịu uốn', unit: 'N/mm²', symbol: 'σbt', value: formatNumber(preview.tech.sigma_bt) },
    { description: 'Cường độ chịu kéo dọc trục', unit: 'N/mm²', symbol: 'σt', value: formatNumber(preview.tech.sigma_t) },
    { description: 'Module đàn hồi bê tông 28 ngày', unit: 'N/mm²', symbol: 'Ec', value: formatNumber(preview.tech.ec) },
    { description: 'Module đàn hồi tại truyền lực', unit: 'N/mm²', symbol: 'Ecp', value: formatNumber(preview.tech.ecp) },
    { description: 'Hệ số co ngót', unit: '', symbol: 'es', value: formatNumber(preview.tech.es) },
    { description: 'Hệ số từ biến', unit: '', symbol: 'y', value: formatNumber(preview.tech.y) },
    { description: 'Diện tích tiết diện ngang cọc', unit: 'mm²', symbol: 'Ao', value: formatNumber(preview.tech.ao) },
    { description: 'Đường kính thép chủ', unit: 'mm', symbol: 'f', value: formatNumber(preview.tech.f_mm) },
    { description: 'Số lượng thép chủ', unit: '', symbol: 'Nos', value: formatNumber(preview.tech.nos) },
    { description: 'Tổng diện tích thép chủ', unit: 'mm²', symbol: 'Ap', value: formatNumber(preview.tech.ap) },
    { description: 'Diện tích bê tông', unit: 'mm²', symbol: 'Ac', value: formatNumber(preview.tech.ac) },
    { description: 'Moment quán tính hình học', unit: 'mm⁴', symbol: 'Ic', value: formatNumber(preview.tech.ic) },
    { description: 'Moment quy đổi thép', unit: 'mm⁴', symbol: 'Is', value: formatNumber(preview.tech.is) },
    { description: 'Moment quán tính (quy đổi)', unit: 'mm⁴', symbol: 'Ie', value: formatNumber(preview.tech.ie) },
    { description: 'Moment kháng uốn', unit: 'mm³', symbol: 'Ze', value: formatNumber(preview.tech.ze) },
    { description: 'Giới hạn bền kéo thép', unit: 'N/mm²', symbol: 'σpu', value: formatNumber(preview.tech.sigma_pu) },
    { description: 'Giới hạn chảy thép', unit: 'N/mm²', symbol: 'σpy', value: formatNumber(preview.tech.sigma_py) },
    { description: 'Module đàn hồi thép', unit: 'N/mm²', symbol: 'Ep', value: formatNumber(preview.tech.ep) },
    { description: 'Hệ số chùng ứng suất', unit: '', symbol: 'k', value: formatNumber(preview.tech.k) },
    { description: 'Ứng suất căng ban đầu', unit: 'N/mm²', symbol: 'σpi', value: formatNumber(preview.tech.sigma_pi) },
    { description: 'Tỷ số module tại truyền lực', unit: '', symbol: "n'", value: formatNumber(preview.tech.n1) },
    { description: 'Ứng suất căng tính toán', unit: 'N/mm²', symbol: 'σpt', value: formatNumber(preview.tech.sigma_pt) },
    { description: 'Ứng suất căng vào bê tông', unit: 'N/mm²', symbol: 'σcpt', value: formatNumber(preview.tech.sigma_cpt) },
    { description: 'Tỷ số module giai đoạn cuối', unit: '', symbol: 'n', value: formatNumber(preview.tech.n) },
    { description: 'Hao tổn do co ngót & từ biến', unit: 'N/mm²', symbol: 'Dσpy', value: formatNumber(preview.tech.d_sig_py) },
    { description: 'Hao tổn do chùng ứng suất', unit: 'N/mm²', symbol: 'Dσr', value: formatNumber(preview.tech.d_sig_r) },
  ]
}

function buildTechOutputRows(tech: TechPreview): TechTableRow[] {
  return [
    { description: 'Ứng suất kéo hiệu quả thép', unit: 'N/mm²', symbol: 'σpe', value: formatNumber(tech.sigma_pe) },
    { description: 'Ứng suất hữu hiệu bê tông', unit: 'N/mm²', symbol: 'σce', value: formatNumber(tech.sigma_ce) },
    { description: 'Khả năng chịu nén dài hạn', unit: 'kN', symbol: 'RaL', value: formatNumber(tech.ra_l_kn) },
    { description: 'Khả năng chịu nén ngắn hạn', unit: 'kN', symbol: 'RaS', value: formatNumber(tech.ra_s_kn) },
    { description: 'Khả năng chịu nén dài hạn', unit: 'tấn', symbol: 'RaL', value: formatNumber(tech.ra_l) },
    { description: 'Khả năng chịu nén ngắn hạn', unit: 'tấn', symbol: 'RaS', value: formatNumber(tech.ra_s) },
    { description: 'Moment kháng uốn nứt', unit: 'kN.m', symbol: 'Mcr', value: formatNumber(tech.mcr_knm) },
    { description: 'Moment kháng uốn nứt', unit: '(t.m)', symbol: 'Mcr', value: formatNumber(tech.mcr) },
  ]
}

function buildSegmentIntermediateRows(
  payload: BocTachDetailPayload,
  preview: BocTachPreview
): Array<[string, string, string]> {
  const doMm = Number(payload.header.do_ngoai || payload.header.do_mm || 0)
  const tMm = Number(payload.header.chieu_day || payload.header.t_mm || 0)
  const dtamMm = Number(payload.header.dtam_mm || 0)
  const pcDiaMm = Number(payload.header.pc_dia_mm || 0)
  const daiDiaMm = Number(payload.header.dai_dia_mm || 0)
  const diMm = Math.max(0, doMm - 2 * tMm)
  const dtamUsed = dtamMm > 0 ? dtamMm : Math.max(0, doMm - tMm)

  const pcUnitKg = 7.85 * Math.PI * pcDiaMm ** 2 / 4 / 1000
  const daiUnitKg = 7.85 * Math.PI * daiDiaMm ** 2 / 4 / 1000
  const ringLengthMm = Math.PI * (dtamUsed + pcDiaMm + daiDiaMm)
  const areaM2 = (Math.PI / 4) * ((doMm / 1000) ** 2 - (diMm / 1000) ** 2)

  const rows: Array<[string, string, string]> = [
    ['Trọng lượng PC', 'kg', formatNumber(pcUnitKg)],
    ['Trọng lượng riêng thép đai', 'kg', formatNumber(daiUnitKg)],
    ['Chiều dài 1 vòng đai', 'mm', formatNumber(ringLengthMm)],
    ['S mặt cắt ngang cọc', 'm2', formatNumber(areaM2)],
  ]

  const activeSnapshots = FIXED_SEGMENT_ORDER
    .map((segmentKey) => preview.segment_snapshots.find((item) => item.ten_doan === segmentKey))
    .filter((snapshot): snapshot is SegmentNvlSnapshot => {
      if (!snapshot) return false
      return Number(snapshot.so_luong_doan || 0) > 0 && Number(snapshot.len_m || 0) > 0
    })

  activeSnapshots.forEach((snapshot, index) => {
    if (snapshot.ten_doan === 'MUI' || index === 0) {
      rows.push([`V1 mũi`, '', formatNumber(Number(snapshot.v1 || 0))])
      rows.push([`V2 mũi`, '', formatNumber(Number(snapshot.v2 || 0))])
      rows.push([`V3 mũi`, '', formatNumber(Number(snapshot.v3 || 0))])
      rows.push([`Cộng mũi`, '', formatNumber(Number(snapshot.tong_vong_dai || 0))])
      return
    }

    const segmentIndex = index
    const suffix = segmentIndex === 1 ? 'thân 1' : `nối ${segmentIndex}`
    rows.push([`V1 ${suffix}`, '', formatNumber(Number(snapshot.v1 || 0))])
    rows.push([`V2 ${suffix}`, '', formatNumber(Number(snapshot.v2 || 0))])
    rows.push([`V3 ${suffix}`, '', formatNumber(Number(snapshot.v3 || 0))])
    rows.push([`Cộng nối ${segmentIndex}`, '', formatNumber(Number(snapshot.tong_vong_dai || 0))])
  })

  return rows
}

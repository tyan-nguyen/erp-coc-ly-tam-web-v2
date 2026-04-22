'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  XuatHangPageData,
  XuatHangCreateBootstrap,
  XuatHangSourceMode,
  XuatHangStatus,
  XuatHangVoucherDetail,
} from '@/lib/xuat-hang/repository'
import { isAdminRole, isCommercialRole, isWarehouseRole } from '@/lib/auth/roles'
import { decodeQrFromImageFile } from '@/lib/qr/decode-image'
import {
  fetchXuatHangCreateBootstrap,
  fetchXuatHangVoucherDetail,
  submitConfirmXuatHangVoucher,
  submitCreateXuatHangVoucher,
  submitDeleteXuatHangVouchers,
  submitShipmentReturn,
  submitShipmentReturnRequest,
  submitShipmentSerialScan,
} from '@/lib/xuat-hang/client-api'

type StockDraftLine = {
  sourceKey: string
  itemLabel: string
  availableQty: number
  requestedQty: string
  unitPrice: string
}

type OrderSubstitutionDraft = {
  expanded: boolean
  actualSourceKey: string
  reason: string
}

type ShipmentScannedSerial = {
  serialId: string
  serialCode: string
  lineId: string
  itemLabel: string
  stockSourceKey: string
}

type ShipmentProgressStats = {
  requestedQty: number
  scannedQty: number
  remainingQty: number
}

type ShipmentInputMode = 'SELECT' | 'SCAN'
type MobileShipmentStep = 'PICK' | 'CONFIRM'
type MobileReturnStep = 'PICK' | 'CONFIRM'

type ShipmentReturnDraftRow = {
  id: string
  serialId: string
  resolutionStatus: '' | 'NHAP_DU_AN' | 'NHAP_KHACH_LE' | 'HUY'
  note: string
}

type BarcodeDetectorResult = {
  rawValue?: string
}

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

const CREATE_BOOTSTRAP_CACHE_KEY = 'xuat-hang:create-bootstrap:v1'

function readCachedCreateBootstrap() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(CREATE_BOOTSTRAP_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as {
      donHang?: XuatHangCreateBootstrap
      tonKho?: XuatHangCreateBootstrap
    }
  } catch {
    return null
  }
}

function writeCachedCreateBootstrap(mode: XuatHangSourceMode, data: XuatHangCreateBootstrap) {
  if (typeof window === 'undefined') return
  try {
    const current = readCachedCreateBootstrap() || {}
    const next = mode === 'DON_HANG' ? { ...current, donHang: data } : { ...current, tonKho: data }
    window.sessionStorage.setItem(CREATE_BOOTSTRAP_CACHE_KEY, JSON.stringify(next))
  } catch {
    // Cache is only an optimization; ignore storage errors.
  }
}

function mergeCreateBootstrap(
  current: XuatHangCreateBootstrap,
  data: XuatHangCreateBootstrap
): XuatHangCreateBootstrap {
  return {
    customers: data.customers.length ? data.customers : current.customers,
    quoteOptions: data.quoteOptions.length ? data.quoteOptions : current.quoteOptions,
    orderSources: data.orderSources.length ? data.orderSources : current.orderSources,
    stockSources: data.stockSources.length ? data.stockSources : current.stockSources,
  }
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round3(value: number) {
  const rounded = Math.round(Number(value || 0) * 1000) / 1000
  return Number.isFinite(rounded) ? rounded : 0
}

function buildExactShipmentItemKey(loaiCoc: string, tenDoan: string, chieuDaiM: number) {
  return `${String(loaiCoc || '').trim()}::${String(tenDoan || '').trim()}::${round3(Number(chieuDaiM || 0))}`
}

function deriveShipmentStockSegmentGroup(tenDoan: string) {
  const normalized = String(tenDoan || '').trim().toUpperCase()
  if (normalized === 'MUI') return 'MUI'
  if (normalized.startsWith('THAN')) return 'THAN'
  return String(tenDoan || '').trim()
}

function buildShipmentStockSourceKey(loaiCoc: string, tenDoan: string, chieuDaiM: number) {
  return `${String(loaiCoc || '').trim()}::${deriveShipmentStockSegmentGroup(tenDoan)}::${round3(Number(chieuDaiM || 0))}`
}

function computeReturnCapacity(detail: XuatHangVoucherDetail | null | undefined) {
  if (!detail) return 0

  const confirmedCountByLine = new Map<string, number>()
  for (const item of detail.confirmedSerials || []) {
    confirmedCountByLine.set(item.lineId, (confirmedCountByLine.get(item.lineId) ?? 0) + 1)
  }

  const returnedCountByLine = new Map<string, number>()
  for (const item of detail.returnedSerials || []) {
    returnedCountByLine.set(item.lineId, (returnedCountByLine.get(item.lineId) ?? 0) + 1)
  }

  return detail.lines.reduce((sum, line) => {
    const shippedCount = confirmedCountByLine.has(line.lineId)
      ? confirmedCountByLine.get(line.lineId) ?? 0
      : Math.max(0, Number(line.actualQty || 0))
    const returnedCount = returnedCountByLine.get(line.lineId) ?? 0
    return sum + Math.max(0, shippedCount - returnedCount)
  }, 0)
}

export function PhieuXuatPageClient(props: {
  pageData: XuatHangPageData
  selectedVoucherId?: string | null
  selectedVoucherDetail?: XuatHangVoucherDetail | null
  viewerRole: string
  currentMonth?: string
  detailPage?: boolean
  initialReturnPanelOpen?: boolean
  fastBackToList?: boolean
}) {
  const router = useRouter()
  const detailPage = Boolean(props.detailPage)
  const safeCurrentMonth = props.currentMonth || ''
  const commercialViewer = isCommercialRole(props.viewerRole)
  const warehouseViewer = isWarehouseRole(props.viewerRole)
  const adminViewer = isAdminRole(props.viewerRole)
  const canCreate = commercialViewer || adminViewer
  const incomingVouchers = props.pageData.vouchers
  const initialCachedBootstrap = readCachedCreateBootstrap()
  const [createBootstrap, setCreateBootstrap] = useState<XuatHangCreateBootstrap>(() =>
    mergeCreateBootstrap(
      {
        customers: props.pageData.customers,
        quoteOptions: props.pageData.quoteOptions,
        orderSources: props.pageData.orderSources,
        stockSources: props.pageData.stockSources,
      },
      {
        customers: initialCachedBootstrap?.donHang?.customers || [],
        quoteOptions: initialCachedBootstrap?.donHang?.quoteOptions || [],
        orderSources: initialCachedBootstrap?.donHang?.orderSources || [],
        stockSources: initialCachedBootstrap?.tonKho?.stockSources || [],
      }
    )
  )
  const [createBootstrapLoaded, setCreateBootstrapLoaded] = useState(
    props.pageData.customers.length > 0 ||
      props.pageData.quoteOptions.length > 0 ||
      props.pageData.orderSources.length > 0 ||
      Boolean(initialCachedBootstrap?.donHang?.orderSources?.length)
  )
  const [stockBootstrapLoaded, setStockBootstrapLoaded] = useState(
    props.pageData.stockSources.length > 0 || Boolean(initialCachedBootstrap?.tonKho?.stockSources?.length)
  )
  const [createBootstrapPending, setCreateBootstrapPending] = useState(false)
  const [expandedVoucherId, setExpandedVoucherId] = useState(() =>
    detailPage ? String(props.selectedVoucherId || '') : ''
  )
  const [expandedVoucherDetail, setExpandedVoucherDetail] = useState<XuatHangVoucherDetail | null>(() =>
    detailPage ? props.selectedVoucherDetail || null : null
  )
  const [vouchers, setVouchers] = useState(incomingVouchers)
  const [mode, setMode] = useState<XuatHangSourceMode>('DON_HANG')
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [sourceQuery, setSourceQuery] = useState('')
  const [selectedStockSourceKey, setSelectedStockSourceKey] = useState('')
  const [selectedStockQty, setSelectedStockQty] = useState('')
  const [selectedStockUnitPrice, setSelectedStockUnitPrice] = useState('')
  const [stockDraftLines, setStockDraftLines] = useState<StockDraftLine[]>([])
  const [voucherQuery, setVoucherQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<XuatHangStatus | 'ALL'>('ALL')
  const [monthFilter, setMonthFilter] = useState(safeCurrentMonth)
  const [voucherPage, setVoucherPage] = useState(1)
  const [voucherPageInput, setVoucherPageInput] = useState('1')
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<string[]>([])
  const [returnPanelVoucherId, setReturnPanelVoucherId] = useState(() =>
    detailPage && props.initialReturnPanelOpen ? String(props.selectedVoucherId || '') : ''
  )
  const [createSectionOpen, setCreateSectionOpen] = useState(false)
  const [listSectionOpen, setListSectionOpen] = useState(true)
  const [createNote, setCreateNote] = useState('')
  const [confirmNote, setConfirmNote] = useState(props.selectedVoucherDetail?.note || '')
  const [requestedBySource, setRequestedBySource] = useState<Record<string, string>>({})
  const [substitutionDraftBySource, setSubstitutionDraftBySource] = useState<Record<string, OrderSubstitutionDraft>>({})
  const [actualByLine, setActualByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries((props.selectedVoucherDetail?.lines || []).map((line) => [line.lineId, String(line.actualQty || 0)]))
  )
  const [selectedShipmentSerialByLine, setSelectedShipmentSerialByLine] = useState<Record<string, string>>({})
  const [shipmentInputMode, setShipmentInputMode] = useState<ShipmentInputMode>('SELECT')
  const [mobileShipmentStep, setMobileShipmentStep] = useState<MobileShipmentStep>('PICK')
  const [mobileExpandedShipmentLineId, setMobileExpandedShipmentLineId] = useState('')
  const [mobileSerialListOpen, setMobileSerialListOpen] = useState(false)
  const [mobileScanPanelOpen, setMobileScanPanelOpen] = useState(false)
  const [lastTouchedShipmentLineId, setLastTouchedShipmentLineId] = useState('')
  const [scannedShipmentSerials, setScannedShipmentSerials] = useState<ShipmentScannedSerial[]>([])
  const [returnDraftRows, setReturnDraftRows] = useState<ShipmentReturnDraftRow[]>([])
  const [returnInputMode, setReturnInputMode] = useState<ShipmentInputMode>('SELECT')
  const [mobileReturnStep, setMobileReturnStep] = useState<MobileReturnStep>('PICK')
  const [mobileExpandedReturnLineId, setMobileExpandedReturnLineId] = useState('')
  const [returnRequestQty, setReturnRequestQty] = useState('')
  const [returnRequestNote, setReturnRequestNote] = useState('')
  const [returnNote, setReturnNote] = useState('')
  const [returnScanError, setReturnScanError] = useState('')
  const [returnScanInfo, setReturnScanInfo] = useState('')
  const [returnManualScanValue, setReturnManualScanValue] = useState('')
  const [returnImageScanPending, setReturnImageScanPending] = useState(false)
  const [returnScannerOpen, setReturnScannerOpen] = useState(false)
  const [returnScannerStarting, setReturnScannerStarting] = useState(false)
  const [returnCameraReady, setReturnCameraReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [detailPending, setDetailPending] = useState(false)
  const [shipmentScanPending, setShipmentScanPending] = useState(false)
  const [shipmentScannerOpen, setShipmentScannerOpen] = useState(false)
  const [shipmentScannerStarting, setShipmentScannerStarting] = useState(false)
  const [shipmentCameraReady, setShipmentCameraReady] = useState(false)
  const [shipmentScanInfo, setShipmentScanInfo] = useState('')
  const [shipmentScanError, setShipmentScanError] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [hasMounted, setHasMounted] = useState(false)
  const shipmentVideoRef = useRef<HTMLVideoElement | null>(null)
  const shipmentStreamRef = useRef<MediaStream | null>(null)
  const shipmentFrameRef = useRef<number | null>(null)
  const shipmentReadyTimeoutRef = useRef<number | null>(null)
  const shipmentDetectorRef = useRef<BarcodeDetectorLike | null>(null)
  const shipmentDetectLockRef = useRef(false)
  const mobileShipmentLineRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const returnVideoRef = useRef<HTMLVideoElement | null>(null)
  const returnStreamRef = useRef<MediaStream | null>(null)
  const returnFrameRef = useRef<number | null>(null)
  const returnReadyTimeoutRef = useRef<number | null>(null)
  const returnDetectorRef = useRef<BarcodeDetectorLike | null>(null)
  const returnDetectLockRef = useRef(false)
  const detailPageRef = useRef(detailPage)
  const createBootstrapRequestKeyRef = useRef('')

  useEffect(() => {
    detailPageRef.current = detailPage
  }, [detailPage])

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    if (detailPage) return
    setListSectionOpen(true)
    setCreateSectionOpen(false)
  }, [canCreate, detailPage])

  useEffect(() => {
    if (detailPageRef.current) return
    setVouchers((current) =>
      incomingVouchers.map((incoming) => {
        const existing = current.find((item) => item.voucherId === incoming.voucherId)
        return existing?.detail && !incoming.detail
          ? {
              ...incoming,
              detail: existing.detail,
            }
          : incoming
      })
    )
  }, [incomingVouchers])

  useEffect(() => {
    if (detailPage || !canCreate) return

    let active = true
    const timerId = window.setTimeout(() => {
      const loadMode = async (targetMode: XuatHangSourceMode) => {
        const isLoaded = targetMode === 'DON_HANG' ? createBootstrapLoaded : stockBootstrapLoaded
        if (isLoaded || createBootstrapRequestKeyRef.current === targetMode) return

        createBootstrapRequestKeyRef.current = targetMode
        try {
          const result = await fetchXuatHangCreateBootstrap(targetMode)
          if (!active || !result.data) return
          writeCachedCreateBootstrap(targetMode, result.data)
          setCreateBootstrap((current) => {
			  if (!current) return current;
			  return mergeCreateBootstrap(current, result.data)
			})
          if (targetMode === 'DON_HANG') {
            setCreateBootstrapLoaded(true)
          } else {
            setStockBootstrapLoaded(true)
          }
        } catch {
          // Background preloading should never block the screen.
        } finally {
          if (createBootstrapRequestKeyRef.current === targetMode) {
            createBootstrapRequestKeyRef.current = ''
          }
        }
      }

      void loadMode('DON_HANG').then(() => loadMode('TON_KHO'))
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timerId)
    }
  }, [detailPage, canCreate, createBootstrapLoaded, stockBootstrapLoaded])

  useEffect(() => {
    if (detailPage || !canCreate || !createSectionOpen) return
    const needsOrderBootstrap = mode === 'DON_HANG' && !createBootstrapLoaded
    const needsStockBootstrap = mode === 'TON_KHO' && !stockBootstrapLoaded
    if (!needsOrderBootstrap && !needsStockBootstrap) return
    const cachedBootstrap = readCachedCreateBootstrap()
    const cachedModeBootstrap = mode === 'DON_HANG' ? cachedBootstrap?.donHang : cachedBootstrap?.tonKho
    if (cachedModeBootstrap) {
      setCreateBootstrap((current) => mergeCreateBootstrap(current, cachedModeBootstrap))
      if (mode === 'DON_HANG') {
        setCreateBootstrapLoaded(true)
      } else {
        setStockBootstrapLoaded(true)
      }
      return
    }
    if (createBootstrapRequestKeyRef.current === mode) return

    let active = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15000)
    createBootstrapRequestKeyRef.current = mode
    setCreateBootstrapPending(true)
    void fetchXuatHangCreateBootstrap(mode, { signal: controller.signal })
      .then((result) => {
        if (!active || !result.data) return
        writeCachedCreateBootstrap(mode, result.data)
        setCreateBootstrap((current) => mergeCreateBootstrap(current, result.data))
        if (mode === 'DON_HANG') {
          setCreateBootstrapLoaded(true)
        }
        if (mode === 'TON_KHO') {
          setStockBootstrapLoaded(true)
        }
      })
      .catch((err) => {
        if (!active) return
        const message =
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Dữ liệu lập phiếu xuất hàng tải quá lâu. Anh thử bấm mở lại hoặc chuyển sang tab còn lại.'
            : err instanceof Error
              ? err.message
              : 'Không tải được dữ liệu lập phiếu xuất hàng.'
        setError(message)
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (active) {
          setCreateBootstrapPending(false)
          createBootstrapRequestKeyRef.current = ''
        }
      })

    return () => {
      active = false
      window.clearTimeout(timeoutId)
      controller.abort()
      if (createBootstrapRequestKeyRef.current === mode) {
        createBootstrapRequestKeyRef.current = ''
      }
    }
  }, [
    detailPage,
    canCreate,
    createSectionOpen,
    mode,
    createBootstrapLoaded,
    stockBootstrapLoaded,
  ])

  useEffect(() => {
    if (!detailPage || !props.selectedVoucherId) return
    setExpandedVoucherId(props.selectedVoucherId)
    setExpandedVoucherDetail((current) => current || props.selectedVoucherDetail || null)
    setVouchers((current) =>
      current.length > 0
        ? current
        : props.pageData.vouchers
    )
    if (props.initialReturnPanelOpen) {
      setReturnPanelVoucherId(props.selectedVoucherId)
    }
  }, [detailPage, props.initialReturnPanelOpen, props.pageData.vouchers, props.selectedVoucherDetail, props.selectedVoucherId])

  useEffect(() => {
    if (!detailPage || !props.selectedVoucherId) return

    let active = true
    void fetchXuatHangVoucherDetail(props.selectedVoucherId)
      .then((result) => {
        if (!active || !result.data) return
        setExpandedVoucherDetail(result.data)
        setVouchers((current) =>
          current.map((row) =>
            row.voucherId === result.data?.voucherId
              ? {
                  ...row,
                  status: result.data.status,
                  requestedQtyTotal: result.data.requestedQtyTotal,
                  actualQtyTotal: result.data.actualQtyTotal,
                  detail: result.data,
                }
              : row
          )
        )
      })
      .catch(() => {
        // Keep server-provided detail if refresh call fails.
      })

    return () => {
      active = false
    }
  }, [detailPage, props.selectedVoucherId])

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => setMessage(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [message])

  useEffect(() => {
    if (!error) return
    const timeout = window.setTimeout(() => setError(''), 4500)
    return () => window.clearTimeout(timeout)
  }, [error])

  const incomingVoucherKey = incomingVouchers.map((item) => item.voucherId).join('|')
  const stateVoucherKey = vouchers.map((item) => item.voucherId).join('|')
  const vouchersForRender = !hasMounted
    ? incomingVouchers
    : incomingVoucherKey === stateVoucherKey
      ? vouchers
      : incomingVouchers

  const hydratedExpandedDetail =
    vouchersForRender.find((item) => item.voucherId === expandedVoucherId)?.detail || expandedVoucherDetail
  const hydratedReturnCapacity = useMemo(() => computeReturnCapacity(hydratedExpandedDetail), [hydratedExpandedDetail])
  const hasHydratedReturnRequest = Boolean(hydratedExpandedDetail?.returnRequest)
  const canConfirm = (warehouseViewer || adminViewer) && hydratedExpandedDetail?.status === 'CHO_XAC_NHAN'
  const showWarehouseFinanceColumns = !(warehouseViewer && !adminViewer)
  const canRequestReturn =
    (commercialViewer || adminViewer) &&
    hydratedExpandedDetail?.locked &&
    (hydratedReturnCapacity > 0 || hasHydratedReturnRequest)
  const canProcessReturn =
    (warehouseViewer || adminViewer) &&
    hydratedExpandedDetail?.locked &&
    Boolean(hydratedExpandedDetail?.returnRequest)

  useEffect(() => {
    if (!hydratedExpandedDetail?.returnRequest || hydratedExpandedDetail.returnRequest.status !== 'PENDING') return
    if (returnInputMode !== 'SELECT') return
    if (returnDraftRows.length > 0) return
    setReturnDraftRows([
      {
        id: `${Date.now()}-1`,
        serialId: '',
        resolutionStatus: '',
        note: '',
      },
    ])
  }, [hydratedExpandedDetail, returnDraftRows.length, returnInputMode])

  const selectedQuote = createBootstrap.quoteOptions.find((item) => item.quoteId === selectedQuoteId) || null
  const selectedVoucherRows = useMemo(
    () => vouchersForRender.filter((row) => selectedVoucherIds.includes(row.voucherId)),
    [selectedVoucherIds, vouchersForRender]
  )
  const deletableSelectedVoucherIds = useMemo(
    () => selectedVoucherRows.filter((row) => row.status === 'CHO_XAC_NHAN').map((row) => row.voucherId),
    [selectedVoucherRows]
  )
  const singleSelectedVoucher = selectedVoucherRows.length === 1 ? selectedVoucherRows[0] : null
  const canDeleteSelectedVoucher = commercialViewer || adminViewer
  const canOpenSelectedReturnRequest = useMemo(() => {
    if (!singleSelectedVoucher) return false
    if (singleSelectedVoucher.status === 'CHO_XAC_NHAN') return false
    const detail = singleSelectedVoucher.detail
    if (detail?.locked) {
      return computeReturnCapacity(detail) > 0 || Boolean(detail.returnRequest)
    }
    return singleSelectedVoucher.actualQtyTotal > 0 || Boolean(singleSelectedVoucher.hasReturnData)
  }, [singleSelectedVoucher])

  useEffect(() => {
    stopShipmentScanner()
    setConfirmNote(hydratedExpandedDetail?.note || '')
    setActualByLine(
      Object.fromEntries((hydratedExpandedDetail?.lines || []).map((line) => [line.lineId, String(line.actualQty || 0)]))
    )
    setSelectedShipmentSerialByLine({})
    setShipmentInputMode('SELECT')
    setMobileShipmentStep('PICK')
    setMobileExpandedShipmentLineId('')
    setMobileSerialListOpen(false)
    setMobileScanPanelOpen(false)
    setLastTouchedShipmentLineId('')
    setScannedShipmentSerials([])
    setReturnDraftRows([])
    setReturnInputMode('SELECT')
    setMobileReturnStep('PICK')
    setMobileExpandedReturnLineId('')
    setReturnRequestQty(
      String(
        hydratedExpandedDetail?.returnRequest?.requestedQtyTotal ??
          (hydratedExpandedDetail?.returnRequest?.requestedLines || []).reduce(
            (sum, item) => sum + Math.max(0, Number(item.requestedQty || 0)),
            0
          ) ??
          ''
      )
    )
    setReturnRequestNote(hydratedExpandedDetail?.returnRequest?.note || '')
    setReturnNote('')
    setReturnScanError('')
    setReturnScanInfo('')
    setReturnManualScanValue('')
    stopReturnScanner()
    setShipmentScanInfo('')
    setShipmentScanError('')
  }, [hydratedExpandedDetail])

  useEffect(() => {
    return () => {
      stopShipmentScanner()
      stopReturnScanner()
    }
  }, [])

  useEffect(() => {
    setSelectedStockSourceKey('')
    setSelectedStockQty('')
    setSelectedStockUnitPrice('')
    setStockDraftLines([])
    setSubstitutionDraftBySource({})
  }, [selectedCustomerId, mode])

  useEffect(() => {
    setRequestedBySource({})
    setSubstitutionDraftBySource({})
  }, [selectedQuoteId])

  const sourceRows = useMemo(() => {
    if (mode !== 'DON_HANG') return []
    if (!selectedQuoteId) return []
    const normalized = normalizeText(sourceQuery)
    return createBootstrap.orderSources.filter((item) => {
      if (item.quoteId !== selectedQuoteId) return false
      if (!normalized) return true
      return [item.itemLabel, item.maBaoGia, item.customerName, item.projectName, item.maOrder]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    })
  }, [createBootstrap.orderSources, mode, selectedQuoteId, sourceQuery])
  const orderShipmentSources = createBootstrap.orderSources

  const actualShipmentSourceByStockKey = useMemo(() => {
    const bucket = new Map<string, (typeof orderShipmentSources)[number]>()
    for (const item of orderShipmentSources) {
      if (item.loaiCoc === 'PHU_KIEN') continue
      const exactItemKey = buildExactShipmentItemKey(item.loaiCoc, item.tenDoan, item.chieuDaiM)
      const current = bucket.get(exactItemKey)
      if (!current || item.availableQty > current.availableQty) {
        bucket.set(exactItemKey, item)
      }
    }
    return bucket
  }, [orderShipmentSources])

  const actualShipmentSourceOptions = useMemo(
    () =>
      Array.from(actualShipmentSourceByStockKey.values()).sort((left, right) =>
        `${left.itemLabel}`.localeCompare(`${right.itemLabel}`)
      ),
    [actualShipmentSourceByStockKey]
  )

  const requestedQtyBySharedStockKey = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const row of sourceRows) {
      const requestedQty = Math.max(toNumber(requestedBySource[row.sourceKey]), 0)
      if (!requestedQty) continue
      const actualSourceKey =
        substitutionDraftBySource[row.sourceKey]?.actualSourceKey ||
        buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM)
      const actualSource = actualShipmentSourceByStockKey.get(actualSourceKey) || row
      bucket.set(actualSource.stockSourceKey, (bucket.get(actualSource.stockSourceKey) ?? 0) + requestedQty)
    }
    return bucket
  }, [actualShipmentSourceByStockKey, requestedBySource, sourceRows, substitutionDraftBySource])

  const displayAvailableBySourceKey = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const row of sourceRows) {
      const actualSourceKey =
        substitutionDraftBySource[row.sourceKey]?.actualSourceKey ||
        buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM)
      const actualSource = actualShipmentSourceByStockKey.get(actualSourceKey) || row
      const sharedRequestedQty = requestedQtyBySharedStockKey.get(actualSource.stockSourceKey) ?? 0
      const remainingQty = Math.max(round3(actualSource.availableQty - sharedRequestedQty), 0)
      bucket.set(row.sourceKey, remainingQty)
    }
    return bucket
  }, [actualShipmentSourceByStockKey, requestedQtyBySharedStockKey, sourceRows, substitutionDraftBySource])

  const effectiveAvailableBySourceKey = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const row of sourceRows) {
      const currentRequestedQty = Math.max(toNumber(requestedBySource[row.sourceKey]), 0)
      const actualSourceKey =
        substitutionDraftBySource[row.sourceKey]?.actualSourceKey ||
        buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM)
      const actualSource = actualShipmentSourceByStockKey.get(actualSourceKey) || row
      const sharedRequestedQty = requestedQtyBySharedStockKey.get(actualSource.stockSourceKey) ?? 0
      const remainingQty = Math.max(round3(actualSource.availableQty - (sharedRequestedQty - currentRequestedQty)), 0)
      bucket.set(row.sourceKey, remainingQty)
    }
    return bucket
  }, [actualShipmentSourceByStockKey, requestedBySource, requestedQtyBySharedStockKey, sourceRows, substitutionDraftBySource])

  const stockOptions = useMemo(() => {
    if (mode !== 'TON_KHO' || !selectedCustomerId) return []
    const normalized = normalizeText(sourceQuery)
    return createBootstrap.stockSources.filter((item) => {
      if (!normalized) return true
      return [item.itemLabel, item.loaiCoc, item.tenDoan, String(item.chieuDaiM)].join(' ').toLowerCase().includes(normalized)
    })
  }, [createBootstrap.stockSources, mode, selectedCustomerId, sourceQuery])

  const selectedStockSource = useMemo(
    () => createBootstrap.stockSources.find((item) => item.sourceKey === selectedStockSourceKey) || null,
    [createBootstrap.stockSources, selectedStockSourceKey]
  )

  const voucherRows = useMemo(() => {
    const normalized = normalizeText(voucherQuery)
    return vouchersForRender.filter((row) => {
      const matchStatus = statusFilter === 'ALL' || row.status === statusFilter
      if (!matchStatus) return false
      const sourceDate = row.operationDate || row.createdAt
      if (monthFilter) {
        const date = new Date(sourceDate || '')
        if (Number.isNaN(date.getTime())) return false
        const monthValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        if (monthValue !== monthFilter) return false
      }
      if (!normalized) return true
      const haystack = normalizeText(
        [row.maPhieu, row.customerName, row.projectName, row.orderLabel, formatStatusLabel(row.status)]
          .filter(Boolean)
          .join(' ')
      )
      return haystack.includes(normalized)
    })
  }, [monthFilter, vouchersForRender, statusFilter, voucherQuery])
  const sortedVoucherRows = useMemo(
    () =>
      [...voucherRows].sort((left, right) => {
        const leftCreatedTime = new Date(left.createdAt || 0).getTime()
        const rightCreatedTime = new Date(right.createdAt || 0).getTime()
        if (leftCreatedTime !== rightCreatedTime) return rightCreatedTime - leftCreatedTime
        const leftOperationTime = new Date(left.operationDate || 0).getTime()
        const rightOperationTime = new Date(right.operationDate || 0).getTime()
        if (leftOperationTime !== rightOperationTime) return rightOperationTime - leftOperationTime
        return String(right.maPhieu || '').localeCompare(String(left.maPhieu || ''))
      }),
    [voucherRows]
  )
  const detailVoucherRows = useMemo(
    () => (detailPage && props.selectedVoucherId ? sortedVoucherRows.filter((row) => row.voucherId === props.selectedVoucherId) : []),
    [detailPage, props.selectedVoucherId, sortedVoucherRows]
  )

  const monthOptions = useMemo(() => {
    const values = new Set<string>()
    if (safeCurrentMonth) values.add(safeCurrentMonth)
    for (const row of vouchersForRender) {
      const sourceDate = row.operationDate || row.createdAt
      const date = new Date(sourceDate || '')
      if (Number.isNaN(date.getTime())) continue
      values.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
    }
    return Array.from(values)
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
      .map((value) => ({
        value,
        label: formatMonthLabel(value),
      }))
  }, [vouchersForRender, safeCurrentMonth])
  

  const combinedMonthOptions = useMemo(() => {
    const values = new Set<string>()
    if (safeCurrentMonth) values.add(safeCurrentMonth)
    for (const option of monthOptions) {
      values.add(option.value)
    }
    return Array.from(values)
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
      .map((value) => ({
        value,
        label: formatMonthShortLabel(value),
      }))
  }, [monthOptions, safeCurrentMonth])

  const PAGE_SIZE = 15
  const voucherPageCount = Math.max(Math.ceil(sortedVoucherRows.length / PAGE_SIZE), 1)
  const pagedVoucherRows = useMemo(
    () => sortedVoucherRows.slice((voucherPage - 1) * PAGE_SIZE, voucherPage * PAGE_SIZE),
    [sortedVoucherRows, voucherPage]
  )
  const visibleVoucherRows = detailPage ? detailVoucherRows : pagedVoucherRows
  const scannedShipmentCountByLine = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of scannedShipmentSerials) {
      counts.set(item.lineId, (counts.get(item.lineId) ?? 0) + 1)
    }
    return counts
  }, [scannedShipmentSerials])
  const availableShipmentSerialOptionsByLine = useMemo(() => {
    const options = new Map<string, Array<{ serialId: string; serialCode: string }>>()
    const pickedSerialIds = new Set(scannedShipmentSerials.map((item) => item.serialId))
    const availableByStockSourceKey = new Map<string, Array<{ serialId: string; serialCode: string }>>()
    for (const item of hydratedExpandedDetail?.availableShipmentSerials || []) {
      if (!item.stockSourceKey || pickedSerialIds.has(item.serialId)) continue
      const current = availableByStockSourceKey.get(item.stockSourceKey) || []
      current.push({ serialId: item.serialId, serialCode: item.serialCode })
      availableByStockSourceKey.set(item.stockSourceKey, current)
    }
    for (const line of hydratedExpandedDetail?.lines || []) {
      if (!line.lineId || line.loaiCoc === 'PHU_KIEN') continue
      const groupedStockSourceKey = buildShipmentStockSourceKey(line.loaiCoc, line.tenDoan, line.chieuDaiM)
      options.set(
        line.lineId,
        availableByStockSourceKey.get(groupedStockSourceKey) || availableByStockSourceKey.get(line.stockSourceKey) || []
      )
    }
    return options
  }, [hydratedExpandedDetail, scannedShipmentSerials])
  const shipmentProgressByLine = useMemo(() => {
    const progress = new Map<string, ShipmentProgressStats>()
    for (const line of hydratedExpandedDetail?.lines || []) {
      const requestedQty = Math.max(0, Number(line.requestedQty || 0))
      const scannedQty = scannedShipmentCountByLine.get(line.lineId) ?? 0
      progress.set(line.lineId, {
        requestedQty,
        scannedQty,
        remainingQty: Math.max(0, requestedQty - scannedQty),
      })
    }
    return progress
  }, [hydratedExpandedDetail, scannedShipmentCountByLine])

  const returnedDraftCountByLine = useMemo(() => {
    const counts = new Map<string, number>()
    const confirmedById = new Map((hydratedExpandedDetail?.confirmedSerials || []).map((item) => [item.serialId, item]))
    for (const row of returnDraftRows) {
      if (!row.serialId) continue
      const confirmed = confirmedById.get(row.serialId)
      if (!confirmed) continue
      counts.set(confirmed.lineId, (counts.get(confirmed.lineId) ?? 0) + 1)
    }
    return counts
  }, [hydratedExpandedDetail, returnDraftRows])

  const returnRequestLineSummaries = useMemo(() => {
    if (!hydratedExpandedDetail?.returnRequest?.requestedLines?.length) return []
    const requestedQtyByLine = new Map(
      hydratedExpandedDetail.returnRequest.requestedLines
        .filter((item) => item.requestedQty > 0)
        .map((item) => [item.lineId, Number(item.requestedQty || 0)])
    )

    return (hydratedExpandedDetail.lines || [])
      .filter((line) => requestedQtyByLine.has(line.lineId))
      .map((line) => {
        const requestedQty = requestedQtyByLine.get(line.lineId) ?? 0
        const selectedQty = returnedDraftCountByLine.get(line.lineId) ?? 0
        return {
          lineId: line.lineId,
          itemLabel: line.itemLabel,
          requestedQty,
          selectedQty,
          remainingQty: Math.max(0, requestedQty - selectedQty),
        }
      })
      .sort((left, right) => {
        if (left.remainingQty !== right.remainingQty) return right.remainingQty - left.remainingQty
        return left.itemLabel.localeCompare(right.itemLabel)
      })
  }, [hydratedExpandedDetail, returnedDraftCountByLine])

  const returnRequestedQtyTotal = useMemo(
    () =>
      round3(
        hydratedExpandedDetail?.returnRequest?.requestedQtyTotal ??
          (hydratedExpandedDetail?.returnRequest?.requestedLines || []).reduce(
            (sum, item) => sum + Math.max(0, Number(item.requestedQty || 0)),
            0
          )
      ),
    [hydratedExpandedDetail]
  )
  const returnSelectedQtyTotal = useMemo(
    () => returnDraftRows.filter((item) => item.serialId).length,
    [returnDraftRows]
  )
  const returnRemainingQtyTotal = useMemo(
    () => Math.max(0, returnRequestedQtyTotal - returnSelectedQtyTotal),
    [returnRequestedQtyTotal, returnSelectedQtyTotal]
  )

  useEffect(() => {
    if (!hydratedExpandedDetail?.lines?.length) return

    const sortedLines = [...hydratedExpandedDetail.lines].sort((left, right) => {
      const leftRemaining = shipmentProgressByLine.get(left.lineId)?.remainingQty ?? Number(left.requestedQty || 0)
      const rightRemaining = shipmentProgressByLine.get(right.lineId)?.remainingQty ?? Number(right.requestedQty || 0)
      if (leftRemaining !== rightRemaining) return rightRemaining - leftRemaining
      return String(left.itemLabel || '').localeCompare(String(right.itemLabel || ''))
    })
    const firstRemainingLine = sortedLines.find((line) => (shipmentProgressByLine.get(line.lineId)?.remainingQty ?? 0) > 0)
    if (!mobileExpandedShipmentLineId && firstRemainingLine) {
      setMobileExpandedShipmentLineId(firstRemainingLine.lineId)
    }
  }, [hydratedExpandedDetail, shipmentProgressByLine, mobileExpandedShipmentLineId])

  useEffect(() => {
    if (!returnRequestLineSummaries.length) return
    const firstRemainingLine = returnRequestLineSummaries.find((line) => line.remainingQty > 0)

    if (!mobileExpandedReturnLineId && firstRemainingLine) {
      setMobileExpandedReturnLineId(firstRemainingLine.lineId)
    }
  }, [mobileExpandedReturnLineId, returnRequestLineSummaries])

  useEffect(() => {
    if (!lastTouchedShipmentLineId) return
    const node = mobileShipmentLineRefs.current[lastTouchedShipmentLineId]
    if (!node) return
    window.setTimeout(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
  }, [lastTouchedShipmentLineId, scannedShipmentSerials])

  useEffect(() => {
    setVoucherPage(1)
  }, [statusFilter, monthFilter, voucherQuery])

  useEffect(() => {
    if (detailPage) {
      router.prefetch('/don-hang/phieu-xuat')
      return
    }
  }, [detailPage, router, visibleVoucherRows])

  useEffect(() => {
    if (voucherPage > voucherPageCount) {
      setVoucherPage(voucherPageCount)
    }
  }, [voucherPage, voucherPageCount])

  useEffect(() => {
    setVoucherPageInput(String(voucherPage))
  }, [voucherPage])

  useEffect(() => {
    setSelectedVoucherIds((current) => current.filter((id) => vouchers.some((row) => row.voucherId === id)))
  }, [vouchers])

  async function toggleVoucher(voucherId: string) {
    if (expandedVoucherId === voucherId) {
      setExpandedVoucherId('')
      setExpandedVoucherDetail(null)
      setReturnPanelVoucherId('')
      setError('')
      return
    }

    setExpandedVoucherId(voucherId)
    setError('')
    const localDetail = vouchers.find((item) => item.voucherId === voucherId)?.detail || null
    setExpandedVoucherDetail(localDetail)
    if (localDetail) return

    setDetailPending(true)
    try {
      const result = await fetchXuatHangVoucherDetail(voucherId)
      if (!result.data) throw new Error('Không tải được chi tiết phiếu xuất hàng.')
      const detail = result.data
      setExpandedVoucherDetail(detail)
      setVouchers((current) =>
        current.map((item) =>
          item.voucherId === voucherId
            ? {
                ...item,
                detail,
                requestedQtyTotal: detail.requestedQtyTotal,
                actualQtyTotal: detail.actualQtyTotal,
                status: detail.status,
              }
            : item
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được chi tiết phiếu xuất hàng.')
    } finally {
      setDetailPending(false)
    }
  }

  function toggleVoucherSelected(voucherId: string, checked: boolean) {
    setSelectedVoucherIds((current) =>
      checked ? Array.from(new Set([...current, voucherId])) : current.filter((item) => item !== voucherId)
    )
  }

  function toggleSelectAllPaged(checked: boolean) {
    const pageIds = pagedVoucherRows.map((row) => row.voucherId)
    setSelectedVoucherIds((current) =>
      checked ? Array.from(new Set([...current, ...pageIds])) : current.filter((id) => !pageIds.includes(id))
    )
  }

  async function openSelectedReturnRequest() {
    if (!singleSelectedVoucher) {
      setError('Hãy chọn đúng 1 phiếu xuất để mở đề nghị trả hàng.')
      return
    }
    if (singleSelectedVoucher.status === 'CHO_XAC_NHAN') {
      setError('Phiếu chưa được thủ kho xác nhận thì chưa thể tạo đề nghị trả hàng.')
      return
    }
    setError('')
    if (!detailPage) {
      router.push(`/don-hang/phieu-xuat/${singleSelectedVoucher.voucherId}?panel=return&from=list`)
      return
    }
    if (expandedVoucherId !== singleSelectedVoucher.voucherId) {
      await toggleVoucher(singleSelectedVoucher.voucherId)
    }
    setReturnPanelVoucherId(singleSelectedVoucher.voucherId)
    window.setTimeout(() => {
      document
        .querySelector(`[data-return-request-anchor="${singleSelectedVoucher.voucherId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  function goBackToVoucherList() {
    if (props.fastBackToList && typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.replace('/don-hang/phieu-xuat')
  }

  async function deleteSelectedVouchers() {
    if (!deletableSelectedVoucherIds.length) {
      setError('Chỉ các phiếu ở trạng thái Chờ thủ kho xác nhận mới được xóa.')
      return
    }
    setPending(true)
    setError('')
    setMessage('')
    try {
      const result = await submitDeleteXuatHangVouchers({ voucherIds: deletableSelectedVoucherIds })
      setVouchers((current) => current.filter((row) => !deletableSelectedVoucherIds.includes(row.voucherId)))
      setSelectedVoucherIds((current) => current.filter((id) => !deletableSelectedVoucherIds.includes(id)))
      if (expandedVoucherId && deletableSelectedVoucherIds.includes(expandedVoucherId)) {
        setExpandedVoucherId('')
        setExpandedVoucherDetail(null)
      }
      const skippedCount = selectedVoucherRows.length - deletableSelectedVoucherIds.length
      setMessage(
        skippedCount > 0
          ? `Đã xóa ${result.data?.deletedCount || deletableSelectedVoucherIds.length} phiếu. Bỏ qua ${skippedCount} phiếu không hợp lệ để xóa.`
          : `Đã xóa ${result.data?.deletedCount || deletableSelectedVoucherIds.length} phiếu xuất hàng.`
      )
      const refreshedBootstrap = await fetchXuatHangCreateBootstrap()
      if (refreshedBootstrap.data) {
        setCreateBootstrap(refreshedBootstrap.data)
        setCreateBootstrapLoaded(true)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xóa được phiếu xuất hàng.')
    } finally {
      setPending(false)
    }
  }

  function stopShipmentScanner() {
    if (shipmentFrameRef.current != null) {
      cancelAnimationFrame(shipmentFrameRef.current)
      shipmentFrameRef.current = null
    }
    if (shipmentReadyTimeoutRef.current != null) {
      clearTimeout(shipmentReadyTimeoutRef.current)
      shipmentReadyTimeoutRef.current = null
    }
    if (shipmentStreamRef.current) {
      for (const track of shipmentStreamRef.current.getTracks()) {
        track.stop()
      }
      shipmentStreamRef.current = null
    }
    if (shipmentVideoRef.current) {
      shipmentVideoRef.current.srcObject = null
    }
    shipmentDetectLockRef.current = false
    setShipmentCameraReady(false)
    setShipmentScannerOpen(false)
    setShipmentScannerStarting(false)
  }

  async function resolveShipmentSerial(code: string) {
    if (!hydratedExpandedDetail) return false
    const result = await submitShipmentSerialScan({
      voucherId: hydratedExpandedDetail.voucherId,
      code,
    })
    if (!result.data) throw new Error('Không nhận diện được serial xuất hàng.')
    return result.data
  }

  async function addShipmentSerialFromCode(code: string, preferredLineId?: string) {
    const normalized = String(code || '').trim()
    if (!normalized) {
      setShipmentScanError('Cần serial_code hoặc nội dung QR để thêm thực xuất.')
      return false
    }

    try {
      const matched = await resolveShipmentSerial(normalized)
      if (!matched) return false

      let added = false
      let nextCount = 0
      let requestedQty = 0
      let rejectReason = ''
      let addedLineId = ''
      setScannedShipmentSerials((current) => {
        const candidateLines = (hydratedExpandedDetail?.lines || []).filter(
          (line) => normalizeText((line as { stockSourceKey?: string }).stockSourceKey || '') === normalizeText(matched.stockSourceKey)
        )
        const lineWithCapacity = candidateLines.find((line) => {
          const requested = Number(line.requestedQty || 0)
          const scanned = current.filter((item) => item.lineId === line.lineId).length
          return scanned < requested
        })
        const preferredLine =
          preferredLineId && candidateLines.some((line) => line.lineId === preferredLineId)
            ? candidateLines.find((line) => line.lineId === preferredLineId)
            : null
        const preferredLineCount = preferredLine
          ? current.filter((item) => item.lineId === preferredLine.lineId).length
          : 0
        const preferredLineHasCapacity = preferredLine
          ? preferredLineCount < Number(preferredLine.requestedQty || 0)
          : false

        const targetLine =
          (preferredLineHasCapacity ? preferredLine : null) ||
          lineWithCapacity ||
          candidateLines.find((line) => line.lineId === matched.lineId) ||
          hydratedExpandedDetail?.lines.find((line) => line.lineId === matched.lineId)

        const targetLineId = targetLine?.lineId || matched.lineId
        const targetItemLabel = targetLine?.itemLabel || matched.itemLabel

        if (
          current.some(
            (item) =>
              item.serialId === matched.serialId || normalizeCode(item.serialCode) === normalizeCode(matched.serialCode)
          )
        ) {
          rejectReason = 'DUPLICATE'
          nextCount = current.filter((item) => item.lineId === targetLineId).length
          requestedQty = hydratedExpandedDetail?.lines.find((line) => line.lineId === targetLineId)?.requestedQty || 0
          return current
        }

        nextCount = current.filter((item) => item.lineId === targetLineId).length + 1
        requestedQty = hydratedExpandedDetail?.lines.find((line) => line.lineId === targetLineId)?.requestedQty || 0
        if (!lineWithCapacity && candidateLines.length > 0) {
          rejectReason = 'FULL'
          return current
        }
        if (requestedQty > 0 && nextCount > requestedQty) {
          rejectReason = 'FULL'
          return current
        }
        added = true
        addedLineId = targetLineId
        return [
          ...current,
          {
            ...matched,
            lineId: targetLineId,
            itemLabel: targetItemLabel,
          },
        ]
      })

      if (!added) {
        if (rejectReason === 'DUPLICATE') {
          setShipmentScanInfo(`Serial ${matched.serialCode} đã được scan rồi.`)
          setShipmentScanError('')
          return true
        }
        throw new Error('Đã đủ số lượng đề nghị xuất cho nhóm hàng này.')
      }

      setShipmentScanError('')
      setShipmentScanInfo(`Đã thêm serial thực xuất: ${matched.serialCode}`)
      setLastTouchedShipmentLineId(addedLineId)
      setMobileExpandedShipmentLineId(addedLineId)
      return true
    } catch (err) {
      setShipmentScanError(err instanceof Error ? err.message : 'Không thêm được serial thực xuất.')
      setShipmentScanInfo('')
      return false
    }
  }

  async function handleShipmentSerialSelectionChange(
    lineId: string,
    value: string,
    options: Array<{ serialId: string; serialCode: string }>
  ) {
    setSelectedShipmentSerialByLine((current) => ({
      ...current,
      [lineId]: value,
    }))

    const matchedOption = options.find((option) => normalizeCode(option.serialCode) === normalizeCode(value))
    if (!matchedOption) return

    const ok = await addShipmentSerialFromCode(matchedOption.serialCode, lineId)
    if (ok) {
      setSelectedShipmentSerialByLine((current) => ({
        ...current,
        [lineId]: '',
      }))
    }
  }

  function handlePickedShipmentSerialChange(
    currentSerialId: string,
    lineId: string,
    value: string,
    options: Array<{ serialId: string; serialCode: string }>
  ) {
    const normalizedValue = normalizeCode(value)
    if (!normalizedValue) return

    setScannedShipmentSerials((current) => {
      const currentItem = current.find((item) => item.serialId === currentSerialId)
      if (!currentItem) return current
      if (normalizeCode(currentItem.serialCode) === normalizedValue) return current

      const matchedOption = options.find((option) => normalizeCode(option.serialCode) === normalizedValue)
      if (!matchedOption) return current

      if (current.some((item) => item.serialId === matchedOption.serialId && item.serialId !== currentSerialId)) {
        return current
      }

      const matchedSerial =
        hydratedExpandedDetail?.availableShipmentSerials.find((item) => item.serialId === matchedOption.serialId) || null

      return current.map((item) =>
        item.serialId === currentSerialId
          ? {
              ...item,
              serialId: matchedOption.serialId,
              serialCode: matchedOption.serialCode,
              stockSourceKey: matchedSerial?.stockSourceKey || item.stockSourceKey,
              itemLabel: matchedSerial?.itemLabel || item.itemLabel,
              lineId,
            }
          : item
      )
    })

    setLastTouchedShipmentLineId(lineId)
    setShipmentScanError('')
    setShipmentScanInfo(`Đã đổi serial thực xuất cho dòng này.`)
  }

  function runShipmentScanLoop() {
    if (!shipmentScannerOpen || !shipmentVideoRef.current || !shipmentDetectorRef.current) return

    const tick = async () => {
      if (!shipmentScannerOpen || !shipmentVideoRef.current || !shipmentDetectorRef.current) return
      shipmentFrameRef.current = requestAnimationFrame(() => {
        void tick()
      })
      if (shipmentDetectLockRef.current) return
      if (shipmentVideoRef.current.readyState < 2) return

      shipmentDetectLockRef.current = true
      try {
        const codes = await shipmentDetectorRef.current.detect(shipmentVideoRef.current)
        const rawValue = String(codes.find((item) => normalizeCode(String(item.rawValue || '')))?.rawValue || '').trim()
        if (rawValue) {
          const ok = await addShipmentSerialFromCode(rawValue)
          if (ok) {
            stopShipmentScanner()
          }
        }
      } catch {
        // Ignore transient camera detection failures.
      } finally {
        shipmentDetectLockRef.current = false
      }
    }

    void tick()
  }

  async function startShipmentScanner() {
    setShipmentScanError('')
    setShipmentScanInfo('')
    setShipmentScannerStarting(true)

    try {
      const isLocalhost =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      if (!window.isSecureContext && !isLocalhost) {
        throw new Error('Camera scan trên điện thoại cần HTTPS hoặc localhost. Với môi trường hiện tại có thể dùng quét từ ảnh hoặc nhập mã.')
      }

      const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      if (!Detector) {
        throw new Error('Trình duyệt này chưa hỗ trợ quét QR bằng camera. Vẫn có thể dùng ảnh QR hoặc nhập mã.')
      }

      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }

      shipmentDetectorRef.current = new Detector({ formats: ['qr_code'] })
      shipmentStreamRef.current = stream
      setShipmentScannerOpen(true)
      setShipmentCameraReady(false)

      if (shipmentVideoRef.current) {
        shipmentVideoRef.current.srcObject = stream
        shipmentVideoRef.current.autoplay = true
        shipmentVideoRef.current.muted = true
        shipmentVideoRef.current.playsInline = true
        await shipmentVideoRef.current.play()
      }

      shipmentReadyTimeoutRef.current = window.setTimeout(() => {
        setShipmentScanError('Camera đã bật nhưng chưa lên hình. Hãy kiểm tra quyền Camera của browser hoặc dùng quét từ ảnh.')
      }, 2500)

      setShipmentScanInfo('Đưa QR vào giữa khung. Scan trúng serial nào thì hệ thống tự cộng vào thực xuất.')
      runShipmentScanLoop()
    } catch (err) {
      stopShipmentScanner()
      setShipmentScanError(err instanceof Error ? err.message : 'Không bật được camera để quét QR.')
    } finally {
      setShipmentScannerStarting(false)
    }
  }

  async function scanShipmentImageFile(file: File) {
    setShipmentScanError('')
    setShipmentScanInfo('')
    setShipmentScanPending(true)
    try {
      const rawValue = await decodeQrFromImageFile(file)
      if (!rawValue) {
        throw new Error('Không đọc được QR từ ảnh này. Thử ảnh rõ hơn hoặc crop sát mã QR.')
      }
      await addShipmentSerialFromCode(rawValue)
    } catch (err) {
      setShipmentScanError(err instanceof Error ? err.message : 'Không đọc được QR từ ảnh.')
      setShipmentScanInfo('')
    } finally {
      setShipmentScanPending(false)
    }
  }

  function stopReturnScanner() {
    if (returnFrameRef.current != null) {
      cancelAnimationFrame(returnFrameRef.current)
      returnFrameRef.current = null
    }
    if (returnReadyTimeoutRef.current != null) {
      clearTimeout(returnReadyTimeoutRef.current)
      returnReadyTimeoutRef.current = null
    }
    if (returnStreamRef.current) {
      for (const track of returnStreamRef.current.getTracks()) {
        track.stop()
      }
      returnStreamRef.current = null
    }
    if (returnVideoRef.current) {
      returnVideoRef.current.srcObject = null
    }
    returnDetectLockRef.current = false
    setReturnCameraReady(false)
    setReturnScannerOpen(false)
    setReturnScannerStarting(false)
  }

  function runReturnScanLoop() {
    if (!returnScannerOpen || !returnVideoRef.current || !returnDetectorRef.current) return

    const tick = async () => {
      if (!returnScannerOpen || !returnVideoRef.current || !returnDetectorRef.current) return
      returnFrameRef.current = requestAnimationFrame(() => {
        void tick()
      })
      if (returnDetectLockRef.current) return
      if (returnVideoRef.current.readyState < 2) return

      returnDetectLockRef.current = true
      try {
        const codes = await returnDetectorRef.current.detect(returnVideoRef.current)
        const rawValue = String(codes.find((item) => normalizeCode(String(item.rawValue || '')))?.rawValue || '').trim()
        if (rawValue) {
          const ok = upsertReturnedSerialByCode(rawValue)
          if (ok) {
            stopReturnScanner()
          }
        }
      } catch {
        // Ignore transient camera detection failures.
      } finally {
        returnDetectLockRef.current = false
      }
    }

    void tick()
  }

  async function startReturnScanner() {
    setReturnScanError('')
    setReturnScanInfo('')
    setReturnScannerStarting(true)

    try {
      const isLocalhost =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      if (!window.isSecureContext && !isLocalhost) {
        throw new Error('Camera scan trên điện thoại cần HTTPS hoặc localhost. Với môi trường hiện tại có thể dùng quét từ ảnh hoặc nhập mã.')
      }

      const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      if (!Detector) {
        throw new Error('Trình duyệt này chưa hỗ trợ quét QR bằng camera. Vẫn có thể dùng ảnh QR hoặc nhập mã.')
      }

      let stream: MediaStream | null = null
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }

      returnDetectorRef.current = new Detector({ formats: ['qr_code'] })
      returnStreamRef.current = stream
      setReturnScannerOpen(true)
      setReturnCameraReady(false)

      if (returnVideoRef.current) {
        returnVideoRef.current.srcObject = stream
        returnVideoRef.current.autoplay = true
        returnVideoRef.current.muted = true
        returnVideoRef.current.playsInline = true
        await returnVideoRef.current.play()
      }

      returnReadyTimeoutRef.current = window.setTimeout(() => {
        setReturnScanError('Camera đã bật nhưng chưa lên hình. Hãy kiểm tra quyền Camera của browser hoặc dùng quét từ ảnh.')
      }, 2500)

      setReturnScanInfo('Đưa QR vào giữa khung. Scan trúng serial nào thì hệ thống tự thêm vào danh sách trả lại.')
      runReturnScanLoop()
    } catch (err) {
      stopReturnScanner()
      setReturnScanError(err instanceof Error ? err.message : 'Không bật được camera để quét QR trả lại.')
    } finally {
      setReturnScannerStarting(false)
    }
  }

  function removeScannedShipmentSerial(serialId: string) {
    setScannedShipmentSerials((current) => current.filter((item) => item.serialId !== serialId))
  }

  async function createVoucher() {
    setError('')
    setMessage('')
    const lines: Array<{
      sourceKey: string
      requestedQty: number
      unitPrice?: number | null
      actualSourceKey?: string
      substitutionReason?: string
    }> =
      mode === 'DON_HANG'
        ? sourceRows
            .map((row) => ({
              sourceKey: row.sourceKey,
              requestedQty: Math.max(toNumber(requestedBySource[row.sourceKey]), 0),
              availableQty: effectiveAvailableBySourceKey.get(row.sourceKey) ?? row.availableQty,
              itemLabel: row.itemLabel,
              actualSourceKey:
                substitutionDraftBySource[row.sourceKey]?.actualSourceKey ||
                buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM),
              substitutionReason: substitutionDraftBySource[row.sourceKey]?.reason || '',
            }))
            .filter((row) => row.requestedQty > 0)
            .map((row) => ({
              sourceKey: row.sourceKey,
              requestedQty: row.requestedQty,
              actualSourceKey: row.actualSourceKey,
              substitutionReason: row.substitutionReason,
            }))
        : stockDraftLines
            .map((row) => ({
              sourceKey: row.sourceKey,
              requestedQty: Number(row.requestedQty || 0),
              unitPrice: Number(row.unitPrice || 0),
            }))
            .filter((row) => row.requestedQty > 0)

    if (!lines.length) {
      setError('Cần nhập ít nhất một số lượng đề nghị xuất.')
      return
    }

    if (mode === 'DON_HANG') {
      const exceededLine = sourceRows.find((row) => {
        const requestedQty = Math.max(toNumber(requestedBySource[row.sourceKey]), 0)
        if (!requestedQty) return false
        const availableQty = effectiveAvailableBySourceKey.get(row.sourceKey) ?? row.availableQty
        return requestedQty > availableQty
      })
      if (exceededLine) {
        const availableQty = effectiveAvailableBySourceKey.get(exceededLine.sourceKey) ?? exceededLine.availableQty
        setError(`Dòng ${exceededLine.itemLabel} chỉ còn ${formatNumber(availableQty)} cây trong pool kho dùng chung.`)
        return
      }
      const missingReasonLine = sourceRows.find((row) => {
        const requestedQty = Math.max(toNumber(requestedBySource[row.sourceKey]), 0)
        if (!requestedQty || row.loaiCoc === 'PHU_KIEN') return false
        const draft = substitutionDraftBySource[row.sourceKey]
        return Boolean(
          draft?.actualSourceKey &&
            draft.actualSourceKey !== buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM) &&
            !draft.reason.trim()
        )
      })
      if (missingReasonLine) {
        setError(`Dòng ${missingReasonLine.itemLabel} đang chọn hàng thay thế nhưng chưa nhập lý do.`)
        return
      }
    }

    if (mode === 'TON_KHO') {
      const exceededLine = stockDraftLines.find((row) => Number(row.requestedQty || 0) > row.availableQty)
      if (exceededLine) {
        setError(`Mặt hàng ${exceededLine.itemLabel} đang vượt tồn có thể giao.`)
        return
      }
    }

    if (mode === 'TON_KHO' && lines.some((row) => Number(row.unitPrice || 0) <= 0)) {
      setError('Bán tồn kho cần nhập đơn giá lớn hơn 0 cho từng dòng.')
      return
    }

    setPending(true)
    try {
      const result = await submitCreateXuatHangVoucher({
        mode,
        quoteId: mode === 'DON_HANG' ? selectedQuoteId : undefined,
        customerId: mode === 'TON_KHO' ? selectedCustomerId : selectedQuote?.customerId,
        note: createNote,
        lines,
      })
      if (!result.data) throw new Error('Không tạo được phiếu xuất hàng.')
      const detailResult = await fetchXuatHangVoucherDetail(result.data.voucherId)
      if (detailResult.data) {
        const nextRow = buildVoucherListItemFromDetail(detailResult.data)
        setVouchers((current) => [nextRow, ...current.filter((item) => item.voucherId !== nextRow.voucherId)])
        setExpandedVoucherId(nextRow.voucherId)
        setExpandedVoucherDetail(detailResult.data)
      }
      const refreshedBootstrap = await fetchXuatHangCreateBootstrap()
      if (refreshedBootstrap.data) {
        setCreateBootstrap(refreshedBootstrap.data)
        setCreateBootstrapLoaded(true)
      }
      setMessage('Đã lập phiếu đề xuất xuất hàng.')
      setRequestedBySource({})
      setSubstitutionDraftBySource({})
      setStockDraftLines([])
      setSelectedStockSourceKey('')
      setSelectedStockQty('')
      setSelectedStockUnitPrice('')
      setCreateNote('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được phiếu xuất hàng.')
    } finally {
      setPending(false)
    }
  }

  async function confirmVoucher() {
    if (!hydratedExpandedDetail) return
    setError('')
    setMessage('')

    const pileLines = hydratedExpandedDetail.lines.filter((line) => line.loaiCoc !== 'PHU_KIEN')
    const pileActualQty = pileLines.reduce((sum, line) => sum + (scannedShipmentCountByLine.get(line.lineId) ?? 0), 0)
    const accessoryActualQty = hydratedExpandedDetail.lines
      .filter((line) => line.loaiCoc === 'PHU_KIEN')
      .reduce((sum, line) => sum + Math.max(0, Number(actualByLine[line.lineId] || 0)), 0)

    if (pileLines.length > 0 && pileActualQty <= 0 && accessoryActualQty <= 0) {
      setError('Với cọc thành phẩm, Thủ kho cần quét hoặc chọn serial trước khi xác nhận xuất.')
      return
    }

    const lines = hydratedExpandedDetail.lines.map((line) => ({
      lineId: line.lineId,
      actualQty:
        line.loaiCoc === 'PHU_KIEN'
          ? Number(actualByLine[line.lineId] || 0)
          : scannedShipmentCountByLine.get(line.lineId) || 0,
    }))
    setPending(true)
    try {
      await submitConfirmXuatHangVoucher({
        voucherId: hydratedExpandedDetail.voucherId,
        note: confirmNote,
        lines,
        serialAssignments: scannedShipmentSerials.map((item) => ({
          lineId: item.lineId,
          serialId: item.serialId,
          serialCode: item.serialCode,
        })),
      })
      const detailResult = await fetchXuatHangVoucherDetail(hydratedExpandedDetail.voucherId)
      if (detailResult.data) {
        const nextDetail = detailResult.data
        setExpandedVoucherDetail(nextDetail)
        setVouchers((current) =>
          current.map((item) =>
            item.voucherId === hydratedExpandedDetail.voucherId
              ? {
                  ...item,
                  detail: nextDetail,
                  requestedQtyTotal: nextDetail.requestedQtyTotal,
                  actualQtyTotal: nextDetail.actualQtyTotal,
                  status: nextDetail.status,
                }
              : item
          )
        )
      }
      setMessage('Đã xác nhận thực xuất hàng.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xác nhận được phiếu xuất hàng.')
    } finally {
      setPending(false)
    }
  }

  function addReturnDraftRow() {
    setReturnDraftRows((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length + 1}`,
        serialId: '',
        resolutionStatus: '',
        note: '',
      },
    ])
  }

  async function submitReturnRequest() {
    if (!hydratedExpandedDetail) return
    const totalRequestedQty = Math.max(0, Math.floor(Number(returnRequestQty || 0)))
    if (!totalRequestedQty) {
      setError('Cần nhập ít nhất một số lượng cọc khách đề nghị trả lại.')
      return
    }
    setPending(true)
    setError('')
    setMessage('')
    try {
      const result = await submitShipmentReturnRequest({
        voucherId: hydratedExpandedDetail.voucherId,
        note: returnRequestNote,
        totalRequestedQty,
      })
      const detailResult = await fetchXuatHangVoucherDetail(hydratedExpandedDetail.voucherId)
      if (detailResult.data) {
        const nextDetail = detailResult.data
        setExpandedVoucherDetail(nextDetail)
        setVouchers((current) =>
          current.map((item) =>
            item.voucherId === hydratedExpandedDetail.voucherId
              ? {
                  ...item,
                  detail: nextDetail,
                  requestedQtyTotal: nextDetail.requestedQtyTotal,
                  actualQtyTotal: nextDetail.actualQtyTotal,
                  status: nextDetail.status,
                }
              : item
          )
        )
      }
      setMessage(`Đã ghi nhận đề nghị trả ${result.data?.requestedCount || totalRequestedQty} cọc. Chờ Thủ kho xác nhận serial thực tế.`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tạo được đề nghị trả hàng.')
    } finally {
      setPending(false)
    }
  }

  function removeReturnDraftRow(rowId: string) {
    setReturnDraftRows((current) => current.filter((item) => item.id !== rowId))
  }

  function updateReturnDraftSerial(rowId: string, serialId: string) {
    setReturnDraftRows((current) =>
      current.map((item) => (item.id === rowId ? { ...item, serialId } : item))
    )
    const confirmed = hydratedExpandedDetail?.confirmedSerials.find((item) => item.serialId === serialId)
    if (confirmed?.lineId) {
      setMobileExpandedReturnLineId(confirmed.lineId)
    }
  }

  async function submitReturnedSerials() {
    if (!hydratedExpandedDetail) return
    const items = returnDraftRows.filter(
      (item): item is ShipmentReturnDraftRow & { resolutionStatus: 'NHAP_DU_AN' | 'NHAP_KHACH_LE' | 'HUY' } =>
        Boolean(item.serialId) && Boolean(item.resolutionStatus)
    )
    if (!items.length) {
      setError('Cần chọn ít nhất một serial trả lại sau giao.')
      return
    }
    if (returnDraftRows.some((item) => item.serialId && !item.resolutionStatus)) {
      setError('Cần chọn hướng xử lý cho từng serial trả lại trước khi xác nhận.')
      return
    }
    setPending(true)
    setError('')
    setMessage('')
    try {
      const result = await submitShipmentReturn({
        voucherId: hydratedExpandedDetail.voucherId,
        note: returnNote,
        items,
      })
      setMessage(`Đã xử lý ${result.data?.processedCount || items.length} serial trả lại sau giao.`)
      setReturnDraftRows([])
      setReturnNote('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không xử lý được trả lại sau giao.')
    } finally {
      setPending(false)
    }
  }

  function upsertReturnedSerialByCode(serialCode: string) {
    const normalized = normalizeCode(serialCode)
    if (!normalized) {
      setReturnScanError('Cần serial_code hoặc nội dung QR để thêm trả lại.')
      return false
    }
    const confirmed = (hydratedExpandedDetail?.confirmedSerials || []).find(
      (item) => normalizeCode(item.serialCode) === normalized
    )
    if (!confirmed) {
      setReturnScanError(`Không tìm thấy serial ${serialCode} trong phiếu đã xuất này.`)
      setReturnScanInfo('')
      return false
    }
    if ((hydratedExpandedDetail?.returnedSerials || []).some((item) => item.serialId === confirmed.serialId)) {
      setReturnScanError(`Serial ${confirmed.serialCode} đã được xử lý trả lại trước đó.`)
      setReturnScanInfo('')
      return false
    }
    setReturnScanError('')
    setReturnScanInfo(`Đã thêm serial trả lại: ${confirmed.serialCode}`)
    setReturnDraftRows((current) => {
      const existing = current.find((item) => item.serialId === confirmed.serialId)
      if (existing) return current
      const emptyIndex = current.findIndex((item) => !item.serialId)
      if (emptyIndex >= 0) {
        return current.map((item, index) =>
          index === emptyIndex ? { ...item, serialId: confirmed.serialId } : item
        )
      }
      return [
        ...current,
        {
          id: `${Date.now()}-${current.length + 1}`,
          serialId: confirmed.serialId,
          resolutionStatus: '',
          note: '',
        },
      ]
    })
    setMobileExpandedReturnLineId(confirmed.lineId)
    return true
  }

  async function scanReturnedImageFile(file: File) {
    setReturnScanError('')
    setReturnScanInfo('')
    setReturnImageScanPending(true)
    try {
      const rawValue = await decodeQrFromImageFile(file)
      if (!rawValue) {
        throw new Error('Không đọc được QR từ ảnh này. Thử ảnh rõ hơn hoặc crop sát mã QR.')
      }
      upsertReturnedSerialByCode(rawValue)
    } catch (err) {
      setReturnScanError(err instanceof Error ? err.message : 'Không đọc được QR từ ảnh.')
      setReturnScanInfo('')
    } finally {
      setReturnImageScanPending(false)
    }
  }

  function addStockDraftLine() {
    if (!selectedCustomerId) {
      setError('Cần chọn khách hàng trước khi thêm hàng bán tồn kho.')
      return
    }
    if (!selectedStockSource) {
      setError('Cần chọn đúng mặt hàng tồn kho để thêm dòng.')
      return
    }
    const requestedQty = Number(selectedStockQty || 0)
    if (!(requestedQty > 0)) {
      setError('Cần nhập số lượng đề nghị xuất lớn hơn 0.')
      return
    }
    if (requestedQty > selectedStockSource.availableQty) {
      setError(`Số lượng đề nghị vượt tồn có thể giao của ${selectedStockSource.itemLabel}.`)
      return
    }
    const unitPrice = Number(selectedStockUnitPrice || 0)
    if (!(unitPrice > 0)) {
      setError('Cần nhập đơn giá lớn hơn 0 cho dòng bán tồn kho.')
      return
    }

    setError('')
    setStockDraftLines((current) => {
      const next = current.filter((row) => row.sourceKey !== selectedStockSource.sourceKey)
      next.push({
        sourceKey: selectedStockSource.sourceKey,
        itemLabel: selectedStockSource.itemLabel,
        availableQty: selectedStockSource.availableQty,
        requestedQty: String(requestedQty),
        unitPrice: String(unitPrice),
      })
      return next
    })
    setSelectedStockSourceKey('')
    setSelectedStockQty('')
    setSelectedStockUnitPrice('')
  }

  function removeStockDraftLine(sourceKey: string) {
    setStockDraftLines((current) => current.filter((row) => row.sourceKey !== sourceKey))
  }

  return (
    <div>
      {canCreate && !detailPage ? (
        <section className="space-y-5 border-b px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Lập phiếu đề xuất xuất hàng</h2>
            </div>
            <button
              type="button"
              onClick={() => setCreateSectionOpen((current) => !current)}
              className="app-outline inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
              aria-label={createSectionOpen ? 'Thu gọn phần lập phiếu' : 'Mở rộng phần lập phiếu'}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: createSectionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 180ms ease',
                  lineHeight: 1,
                }}
              >
                v
              </span>
            </button>
          </div>

          {createSectionOpen ? (
            <div className="space-y-5">
          {createBootstrapPending ? (
            <div className="rounded-2xl border px-4 py-8 text-center text-sm text-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)' }}>
              Đang tải dữ liệu lập phiếu xuất hàng...
            </div>
          ) : (
            <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap gap-6 border-b text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <button
                type="button"
                onClick={() => setMode('DON_HANG')}
                className="border-b-2 px-1 pb-3 font-semibold transition-colors"
                style={{
                  borderColor: mode === 'DON_HANG' ? 'var(--color-primary)' : 'transparent',
                  color: mode === 'DON_HANG' ? 'var(--color-primary)' : 'var(--color-muted)',
                }}
              >
                Theo đơn hàng
              </button>
              <button
                type="button"
                onClick={() => setMode('TON_KHO')}
                className="border-b-2 px-1 pb-3 font-semibold transition-colors"
                style={{
                  borderColor: mode === 'TON_KHO' ? 'var(--color-primary)' : 'transparent',
                  color: mode === 'TON_KHO' ? 'var(--color-primary)' : 'var(--color-muted)',
                }}
              >
                Bán tồn kho
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {mode === 'DON_HANG' ? (
              <Field label="Báo giá">
                <select
                  value={selectedQuoteId}
                  onChange={(event) => setSelectedQuoteId(event.target.value)}
                  className="app-input w-full rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Chọn báo giá</option>
                  {createBootstrap.quoteOptions.map((option) => (
                    <option key={option.quoteId} value={option.quoteId}>
                      {option.maBaoGia} · {option.customerName}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Khách hàng">
                <select
                  value={selectedCustomerId}
                  onChange={(event) => setSelectedCustomerId(event.target.value)}
                  className="app-input w-full rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Chọn khách hàng</option>
                  {createBootstrap.customers.map((option) => (
                    <option key={option.khId} value={option.khId}>
                      {option.tenKh}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Tìm nhanh">
              <input
                value={sourceQuery}
                onChange={(event) => setSourceQuery(event.target.value)}
                className="app-input w-full rounded-xl px-3 py-2 text-sm"
                placeholder={mode === 'DON_HANG' ? 'Tìm theo dòng hàng, báo giá, dự án...' : 'Tìm theo loại cọc, đoạn, chiều dài...'}
              />
            </Field>
            {mode === 'DON_HANG' && selectedQuote ? (
              <Info label="Khách hàng" value={selectedQuote.customerName} />
            ) : null}
            {mode === 'DON_HANG' && selectedQuote ? (
              <Info
                label="Dự án / Báo giá"
                value={`${selectedQuote.projectName}${selectedQuote.maBaoGia ? ` · ${selectedQuote.maBaoGia}` : ''}`}
              />
            ) : null}
            {mode === 'DON_HANG' && selectedQuote ? (
              <Info label="Đơn hàng" value={selectedQuote.orderLabels.join(', ')} />
            ) : null}
          </div>

          {mode === 'DON_HANG' ? (
            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Hàng xuất</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đã giao</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Tồn vật lý</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Còn có thể giao</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đơn giá</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">SL đề nghị xuất</th>
                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((row) => {
                    const draft = substitutionDraftBySource[row.sourceKey]
                    const actualSourceKey =
                      draft?.actualSourceKey || buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM)
                    const actualSource = actualShipmentSourceByStockKey.get(actualSourceKey) || row
                    const effectiveAvailableQty = effectiveAvailableBySourceKey.get(row.sourceKey) ?? row.availableQty
                    const displayAvailableQty = displayAvailableBySourceKey.get(row.sourceKey) ?? row.availableQty
                    const displayPhysicalQty = Math.max(
                      actualSource.physicalQty,
                      displayAvailableQty + Math.max(actualSource.reservedQty, 0)
                    )
                    const showSubstitutionEditor = row.loaiCoc !== 'PHU_KIEN' && Boolean(draft?.expanded)
                    const isSubstituted =
                      row.loaiCoc !== 'PHU_KIEN' &&
                      actualSourceKey !== buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM)
                    return (
                      <Fragment key={row.sourceKey}>
                        <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                          <td className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold">{row.itemLabel}</div>
                                <div className="text-xs text-[var(--color-muted)]">
                                  {`Theo báo giá${row.maBaoGia ? ` · ${row.maBaoGia}` : ''}${
                                    row.tenDoan.toUpperCase().startsWith('THAN') ? ' · Dùng chung pool THAN cùng chiều dài' : ''
                                  }`}
                                </div>
                                <div className="mt-1 text-xs text-[var(--color-muted)]">
                                  Thực xuất: {isSubstituted ? actualSource.itemLabel : 'Đúng mã theo báo giá'}
                                </div>
                                {isSubstituted && draft?.reason ? (
                                  <div className="mt-1 text-xs text-[var(--color-muted)]">Lý do thay thế: {draft.reason}</div>
                                ) : null}
                              </div>
                              {row.loaiCoc !== 'PHU_KIEN' ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSubstitutionDraftBySource((current) => {
                                          const next = current[row.sourceKey] || {
                                            expanded: false,
                                            actualSourceKey: buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM),
                                            reason: '',
                                          }
                                      return {
                                        ...current,
                                        [row.sourceKey]: {
                                          ...next,
                                          expanded: !next.expanded,
                                          actualSourceKey:
                                            next.actualSourceKey || buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM),
                                        },
                                      }
                                    })
                                  }
                                  className="app-outline shrink-0 rounded-xl px-3 py-1 text-xs font-semibold"
                                >
                                  {showSubstitutionEditor ? '- Thu lại' : '+ Thay thế'}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">{formatNumber(row.shippedQty)}</td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {row.loaiCoc === 'PHU_KIEN' ? '-' : formatNumber(displayPhysicalQty)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ShipmentAvailabilityCell
                              availableQty={displayAvailableQty}
                              reservedQty={actualSource.reservedQty}
                              reservedByVouchers={actualSource.reservedByVouchers}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">{row.unitPriceRef != null ? formatMoney(row.unitPriceRef) : '-'}</td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              min={0}
                              max={effectiveAvailableQty}
                              value={requestedBySource[row.sourceKey] ?? ''}
                              onChange={(event) =>
                                setRequestedBySource((current) => ({
                                  ...current,
                                  [row.sourceKey]: event.target.value,
                                }))
                              }
                              className="app-input w-28 rounded-xl px-2 py-1 text-right text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {row.unitPriceRef != null
                              ? formatMoney(
                                  (Number(requestedBySource[row.sourceKey] || 0) || 0) *
                                    (row.loaiCoc === 'PHU_KIEN' ? 1 : row.chieuDaiM) *
                                    row.unitPriceRef
                                )
                              : '-'}
                          </td>
                        </tr>
                        {showSubstitutionEditor ? (
                          <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                            <td colSpan={7} className="px-4 py-3">
                              <div
                                className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
                                style={{ borderColor: 'var(--color-border)', backgroundColor: 'color-mix(in srgb, white 97%, var(--color-primary) 2%)' }}
                              >
                                <Field label="Mã thực xuất">
                                  <select
                                    value={actualSourceKey}
                                    onChange={(event) =>
                                      setSubstitutionDraftBySource((current) => ({
                                        ...current,
                                        [row.sourceKey]: {
                                          expanded: true,
                                          actualSourceKey:
                                            event.target.value || buildExactShipmentItemKey(row.loaiCoc, row.tenDoan, row.chieuDaiM),
                                          reason: current[row.sourceKey]?.reason || '',
                                        },
                                      }))
                                    }
                                    className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                  >
                                    {actualShipmentSourceOptions.map((option) => (
                                      <option
                                        key={`${row.sourceKey}-${buildExactShipmentItemKey(option.loaiCoc, option.tenDoan, option.chieuDaiM)}`}
                                        value={buildExactShipmentItemKey(option.loaiCoc, option.tenDoan, option.chieuDaiM)}
                                      >
                                        {option.itemLabel} · Có thể giao {formatNumber(option.availableQty)}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Lý do thay thế">
                                  <input
                                    value={draft?.reason ?? ''}
                                    onChange={(event) =>
                                      setSubstitutionDraftBySource((current) => ({
                                        ...current,
                                        [row.sourceKey]: {
                                          expanded: true,
                                          actualSourceKey: actualSourceKey,
                                          reason: event.target.value,
                                        },
                                      }))
                                    }
                                    className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                    placeholder={isSubstituted ? 'Nhập lý do thay thế' : 'Để trống nếu xuất đúng mã'}
                                  />
                                </Field>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                  {sourceRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                        {selectedQuoteId ? 'Báo giá này hiện chưa có dữ liệu dòng hàng.' : 'Chọn báo giá để xem các dòng có thể giao.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[minmax(0,1.8fr)_140px_160px_auto]" style={{ borderColor: 'var(--color-border)' }}>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">Mặt hàng tồn kho</div>
                  <select
                    value={selectedStockSourceKey}
                    onChange={(event) => setSelectedStockSourceKey(event.target.value)}
                    disabled={!selectedCustomerId}
                    className="app-input w-full rounded-xl px-3 py-2 text-sm disabled:opacity-60"
                  >
                    <option value="">{selectedCustomerId ? 'Chọn mặt hàng cần xuất' : 'Chọn khách hàng trước'}</option>
                    {stockOptions.map((row) => (
                      <option key={row.sourceKey} value={row.sourceKey}>
                        {row.itemLabel} · Tồn {formatNumber(row.availableQty)}
                      </option>
                    ))}
                  </select>
                </div>
                <Field label="SL đề nghị">
                  <input
                    type="number"
                    min={0}
                    max={selectedStockSource?.availableQty || undefined}
                    value={selectedStockQty}
                    onChange={(event) => setSelectedStockQty(event.target.value)}
                    disabled={!selectedStockSource}
                    className="app-input w-full rounded-xl px-3 py-2 text-right text-sm disabled:opacity-60"
                  />
                </Field>
                <Field label="Đơn giá">
                  <input
                    type="number"
                    min={0}
                    value={selectedStockUnitPrice}
                    onChange={(event) => setSelectedStockUnitPrice(event.target.value)}
                    disabled={!selectedStockSource}
                    className="app-input w-full rounded-xl px-3 py-2 text-right text-sm disabled:opacity-60"
                    placeholder="Nhập đơn giá"
                  />
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={addStockDraftLine}
                    disabled={!selectedCustomerId}
                    className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  >
                    + Thêm dòng
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                      <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Hàng</th>
                      <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Có thể giao</th>
                      <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đơn giá</th>
                      <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">SL đề nghị xuất</th>
                      <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Thành tiền</th>
                      <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-center">Xóa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockDraftLines.map((row) => {
                      const requestedQty = Number(row.requestedQty || 0)
                      const unitPrice = Number(row.unitPrice || 0)
                      return (
                        <tr key={row.sourceKey} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                          <td className="px-4 py-3 font-semibold">{row.itemLabel}</td>
                          <td className="px-4 py-3 text-right">{formatNumber(row.availableQty)}</td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              min={0}
                              value={row.unitPrice}
                              onChange={(event) =>
                                setStockDraftLines((current) =>
                                  current.map((item) =>
                                    item.sourceKey === row.sourceKey ? { ...item, unitPrice: event.target.value } : item
                                  )
                                )
                              }
                              className="app-input w-28 rounded-xl px-2 py-1 text-right text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <input
                              type="number"
                              min={0}
                              max={row.availableQty}
                              value={row.requestedQty}
                              onChange={(event) =>
                                setStockDraftLines((current) =>
                                  current.map((item) =>
                                    item.sourceKey === row.sourceKey ? { ...item, requestedQty: event.target.value } : item
                                  )
                                )
                              }
                              className="app-input w-24 rounded-xl px-2 py-1 text-right text-sm"
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{formatMoney(requestedQty * unitPrice)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeStockDraftLine(row.sourceKey)}
                              className="app-outline rounded-xl px-3 py-1 text-sm font-semibold"
                            >
                              Xóa
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {stockDraftLines.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                          {selectedCustomerId
                            ? 'Chọn đúng mặt hàng từ dropdown, nhập số lượng rồi bấm + Thêm dòng.'
                            : 'Chọn khách hàng trước, sau đó chọn mặt hàng tồn kho để thêm dòng.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Field label="Ghi chú phiếu xuất">
            <input
              value={createNote}
              onChange={(event) => setCreateNote(event.target.value)}
              className="app-input w-full rounded-xl px-3 py-2 text-sm"
              placeholder="Ghi chú nội bộ nếu cần"
            />
          </Field>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void createVoucher()}
              disabled={pending}
              className="app-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {pending ? 'Đang tạo...' : 'Lập phiếu xuất'}
            </button>
          </div>
            </>
          )}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={detailPage ? 'space-y-4 px-6 py-5' : 'space-y-5 px-6 py-5'}>
        <div className={`flex flex-wrap items-start ${detailPage ? 'gap-3' : 'justify-between gap-4'}`}>
          <div className="min-w-0">
            {detailPage ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={goBackToVoucherList}
                  className="app-outline inline-flex h-9 w-9 items-center justify-center rounded-full text-base font-semibold"
                  aria-label="Quay lại danh sách phiếu xuất"
                >
                  ←
                </button>
                <h2 className="text-lg font-semibold">Chi tiết phiếu xuất hàng</h2>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Danh sách phiếu xuất hàng</h2>
              </>
            )}
          </div>
          {detailPage ? null : (
            <button
              type="button"
              onClick={() => setListSectionOpen((current) => !current)}
              className="app-outline inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
              aria-label={listSectionOpen ? 'Thu gọn danh sách phiếu xuất' : 'Mở rộng danh sách phiếu xuất'}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: listSectionOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 180ms ease',
                  lineHeight: 1,
                }}
              >
                v
              </span>
            </button>
          )}
        </div>

        {detailPage || listSectionOpen ? (
          <div className="space-y-5">
        {!detailPage ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Trạng thái" className="w-[220px]">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as XuatHangStatus | 'ALL')}
              className="app-input w-full rounded-xl px-3 py-2 text-sm"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="CHO_XAC_NHAN">Chờ xác nhận</option>
              <option value="DA_XUAT">Đã xuất</option>
              <option value="XUAT_MOT_PHAN">Xuất một phần</option>
            </select>
          </Field>
          <Field label="Theo tháng" className="w-auto">
            <div className="flex items-center gap-2">
              <select
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
                className="app-input w-36 rounded-xl px-3 py-2 text-sm"
              >
                <option value="">Tất cả tháng</option>
                {combinedMonthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Tìm kiếm" className="min-w-[280px] flex-1">
            <input
              value={voucherQuery}
              onChange={(event) => setVoucherQuery(event.target.value)}
              className="app-input w-full rounded-xl px-3 py-2 text-sm"
              placeholder="Tìm theo mã phiếu, khách hàng, đơn hàng..."
            />
          </Field>
        </div>
        ) : null}

        {!detailPage ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-muted)]">
          <span>{sortedVoucherRows.length} phiếu</span>
          <span>
            Trang {voucherPage} / {voucherPageCount}
          </span>
        </div>
        ) : null}

        {!detailPage && selectedVoucherIds.length ? (
          <>
            <div
              className="hidden md:block sticky bottom-4 z-20 rounded-2xl border px-4 py-3 shadow-lg"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'color-mix(in srgb, white 92%, var(--color-primary) 8%)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm font-medium">Đã chọn {selectedVoucherIds.length} phiếu</div>
                {canDeleteSelectedVoucher ? (
                  <button
                    type="button"
                    onClick={() => void deleteSelectedVouchers()}
                    disabled={pending || deletableSelectedVoucherIds.length === 0}
                    className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Xóa
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void openSelectedReturnRequest()}
                  disabled={pending || !canOpenSelectedReturnRequest}
                  className="app-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Trả hàng
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedVoucherIds([])}
                  className="app-outline rounded-xl px-4 py-2 text-sm font-semibold"
                >
                  Bỏ chọn
                </button>
              </div>
              <div className="mt-2 text-sm text-[var(--color-muted)]">
                {canDeleteSelectedVoucher
                  ? '`Xóa` chỉ áp dụng cho phiếu chờ thủ kho xác nhận. `Trả hàng` dùng cho 1 phiếu đã xuất.'
                  : '`Trả hàng` dùng cho 1 phiếu đã xuất. Thủ kho không có quyền xóa đề xuất của KTBH.'}
              </div>
            </div>

            <div
              className="md:hidden fixed inset-x-3 bottom-3 z-30 rounded-2xl border px-3 py-3 shadow-xl"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 4%)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Đã chọn {selectedVoucherIds.length} phiếu</div>
                <button
                  type="button"
                  onClick={() => setSelectedVoucherIds([])}
                  className="text-xs font-semibold text-[var(--color-muted)]"
                >
                  Bỏ chọn
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => void openSelectedReturnRequest()}
                  disabled={pending || !canOpenSelectedReturnRequest}
                  className="app-primary rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
                >
                  Trả hàng
                </button>
              </div>
              <div className="mt-2 text-xs text-[var(--color-muted)]">Thủ kho không có quyền xóa đề xuất của KTBH.</div>
            </div>
          </>
        ) : null}

        <div className={`space-y-3 md:hidden ${!detailPage && selectedVoucherIds.length ? 'pb-32' : ''}`}>
          {visibleVoucherRows.map((row) => {
            const expanded = detailPage ? true : expandedVoucherId === row.voucherId
            const detail = expanded ? row.detail || expandedVoucherDetail : null
            const returnPanelOpen = returnPanelVoucherId === row.voucherId
            const rowHasReturnRequest = Boolean(row.hasReturnData || row.detail?.returnRequest || row.detail?.returnedSerials?.length)
            const mobileReturnMode = Boolean(detailPage && detail && canProcessReturn && returnPanelOpen && detail.returnRequest?.status === 'PENDING')
            const mobileReturnCompletedMode = Boolean(
              detailPage &&
                detail &&
                canProcessReturn &&
                returnPanelOpen &&
                detail.returnedSerials.length > 0 &&
                detail.returnRequest?.status !== 'PENDING'
            )
            const mobileReturnRequest = detail?.returnRequest || null
            const mobileCanEditReturnRequest = Boolean(
              detailPage &&
                canRequestReturn &&
                hydratedReturnCapacity > 0 &&
                (!mobileReturnRequest || mobileReturnRequest.status === 'COMPLETED')
            )
            const effectiveDetailActualQty = detail
              ? canConfirm
                ? scannedShipmentSerials.length
                : detail.confirmedSerials.length > 0
                  ? detail.confirmedSerials.length
                  : detail.actualQtyTotal
              : row.actualQtyTotal
            const effectiveDetailRemainingQty = detail
              ? Math.max(0, detail.requestedQtyTotal - effectiveDetailActualQty)
              : Math.max(0, row.requestedQtyTotal - row.actualQtyTotal)
            const mobileShipmentLines = detail
              ? [...detail.lines].sort((left, right) => {
                  const leftProgress = shipmentProgressByLine.get(left.lineId) || {
                    requestedQty: Number(left.requestedQty || 0),
                    scannedQty: 0,
                    remainingQty: Number(left.requestedQty || 0),
                  }
                  const rightProgress = shipmentProgressByLine.get(right.lineId) || {
                    requestedQty: Number(right.requestedQty || 0),
                    scannedQty: 0,
                    remainingQty: Number(right.requestedQty || 0),
                  }
                  if (leftProgress.remainingQty !== rightProgress.remainingQty) {
                    return rightProgress.remainingQty - leftProgress.remainingQty
                  }
                  return String(left.itemLabel || '').localeCompare(String(right.itemLabel || ''))
                })
              : []
            const mobileConfirmedCountByLine = new Map<string, number>()
            for (const item of detail?.confirmedSerials || []) {
              mobileConfirmedCountByLine.set(item.lineId, (mobileConfirmedCountByLine.get(item.lineId) ?? 0) + 1)
            }
            const mobileReturnedCountByLine = new Map<string, number>()
            for (const item of detail?.returnedSerials || []) {
              mobileReturnedCountByLine.set(item.lineId, (mobileReturnedCountByLine.get(item.lineId) ?? 0) + 1)
            }

            return (
              <div
                key={`mobile-${row.voucherId}`}
                className="rounded-2xl border p-3"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'white',
                }}
              >
                <div className="flex items-start gap-3">
                  {!detailPage ? (
                    <input
                      type="checkbox"
                      checked={selectedVoucherIds.includes(row.voucherId)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => toggleVoucherSelected(row.voucherId, event.target.checked)}
                      className="mt-1"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {detailPage ? (
                          <div className="text-left text-lg font-semibold">{row.maPhieu}</div>
                        ) : (
                          <Link
                            href={`/don-hang/phieu-xuat/${row.voucherId}?from=list`}
                            prefetch={false}
                            className="text-left text-lg font-semibold underline-offset-2 hover:underline"
                          >
                            {row.maPhieu}
                          </Link>
                        )}
                        <div className={`mt-1 text-sm text-[var(--color-muted)] ${detailPage ? 'hidden' : ''}`}>
                          {row.sourceType === 'DON_HANG' ? 'Theo đơn hàng' : 'Bán tồn kho'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'color-mix(in srgb, white 92%, var(--color-primary) 4%)' }}>
                          {formatCompactStatusLabel(row.status)}
                        </div>
                        {rowHasReturnRequest ? (
                          <span
                            className="inline-flex rounded-full border px-2 py-1 text-[11px] font-medium"
                            style={{
                              borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                              backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                              color: 'var(--color-primary)',
                            }}
                          >
                            Có trả hàng
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-1 p-1 text-sm">
                      {detailPage && !canConfirm && !mobileReturnMode ? null : (
                        <div>
                          <div className="font-medium">{row.customerName || '-'}</div>
                          <div className="text-xs text-[var(--color-muted)]">{row.orderLabel || row.projectName || '-'}</div>
                        </div>
                      )}
                      {detailPage ? (
                        detailPage && !canConfirm && !mobileReturnMode ? null : (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            {mobileReturnMode || mobileReturnCompletedMode ? (
                              <>
                                <span><span className="text-[var(--color-muted)]">Đề nghị trả</span> <span className="font-semibold">{formatNumber(returnRequestedQtyTotal)}</span></span>
                                <span><span className="text-[var(--color-muted)]">{mobileReturnCompletedMode ? 'Đã trả' : 'Đã chọn'}</span> <span className="font-semibold">{formatNumber(mobileReturnCompletedMode ? (detail?.returnedSerials.length ?? 0) : returnSelectedQtyTotal)}</span></span>
                                <span><span className="text-[var(--color-muted)]">Còn thiếu</span> <span className="font-semibold">{formatNumber(mobileReturnCompletedMode ? Math.max(0, returnRequestedQtyTotal - (detail?.returnedSerials.length ?? 0)) : returnRemainingQtyTotal)}</span></span>
                              </>
                            ) : (
                              <>
                                <span><span className="text-[var(--color-muted)]">Đã quét</span> <span className="font-semibold">{formatNumber(effectiveDetailActualQty)}</span></span>
                                <span><span className="text-[var(--color-muted)]">Còn thiếu</span> <span className="font-semibold">{formatNumber(effectiveDetailRemainingQty)}</span></span>
                              </>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {[
                            { label: 'Trạng thái', value: formatStatusLabel(row.status) },
                            { label: 'SL đề nghị', value: formatNumber(row.requestedQtyTotal) },
                            {
                              label: 'Đã quét',
                              value: expanded && detail ? formatNumber(scannedShipmentSerials.length) : formatNumber(row.actualQtyTotal),
                            },
                            {
                              label: 'Còn thiếu',
                              value: expanded && detail
                                ? formatNumber(Math.max(0, detail.requestedQtyTotal - scannedShipmentSerials.length))
                                : formatNumber(Math.max(0, row.requestedQtyTotal - row.actualQtyTotal)),
                            },
                          ].map((item) => (
                            <div
                              key={`${row.voucherId}-${item.label}`}
                              className="rounded-xl px-3 py-1.5"
                              style={{ backgroundColor: 'color-mix(in srgb, white 94%, var(--color-primary) 3%)' }}
                            >
                              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{item.label}</div>
                              <div className="mt-1 text-sm font-semibold leading-5">{item.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {expanded ? (
                      detail ? (
                        canConfirm ? (
                        <div className={`space-y-3 ${mobileShipmentStep === 'PICK' ? 'pb-24' : 'pb-28'}`}>
                          {mobileShipmentStep === 'PICK' ? (
                            <div className="space-y-2.5">
                              <div className="space-y-2 px-1 py-0.5">
                                <div className="grid grid-cols-2 rounded-2xl p-1" style={{ backgroundColor: 'color-mix(in srgb, white 90%, var(--color-primary) 4%)' }}>
                                  <button
                                    type="button"
                                    onClick={() => setShipmentInputMode('SCAN')}
                                    className={`rounded-xl px-3 py-1 text-sm font-semibold ${shipmentInputMode === 'SCAN' ? 'app-primary text-white' : ''}`}
                                  >
                                    Scan
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setShipmentInputMode('SELECT')}
                                    className={`rounded-xl px-3 py-1 text-sm font-semibold ${shipmentInputMode === 'SELECT' ? 'app-primary text-white' : ''}`}
                                  >
                                    Danh sách
                                  </button>
                                </div>
                              </div>

                              {shipmentInputMode === 'SELECT' ? (
                                <div className="space-y-2.5">
                                  {mobileShipmentLines.map((line) => {
                                    const progress = shipmentProgressByLine.get(line.lineId) || {
                                      requestedQty: Number(line.requestedQty || 0),
                                      scannedQty: 0,
                                      remainingQty: Number(line.requestedQty || 0),
                                    }
                                    const isAccessory = line.loaiCoc === 'PHU_KIEN'
                                    const serialOptions = availableShipmentSerialOptionsByLine.get(line.lineId) || []
                                    const pickedSerials = scannedShipmentSerials.filter((item) => item.lineId === line.lineId)
                                    const expandedLine = mobileExpandedShipmentLineId === line.lineId
                                    return (
                                      <div
                                        key={`mobile-line-${line.lineId}`}
                                        ref={(node) => {
                                          mobileShipmentLineRefs.current[line.lineId] = node
                                        }}
                                        className="rounded-2xl p-2.5"
                                        style={{
                                          backgroundColor:
                                            mobileExpandedShipmentLineId === line.lineId
                                              ? 'color-mix(in srgb, white 90%, var(--color-primary) 6%)'
                                              : 'color-mix(in srgb, white 96%, var(--color-primary) 2%)',
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => setMobileExpandedShipmentLineId((current) => (current === line.lineId ? '' : line.lineId))}
                                          className="flex w-full items-start justify-between gap-3 text-left"
                                        >
                                          <div className="min-w-0">
                                            <div className="text-[15px] font-semibold leading-6">{line.itemLabel}</div>
                                            {formatShipmentLineMeta(line) ? (
                                              <div className="mt-1 text-xs text-[var(--color-muted)]">{formatShipmentLineMeta(line)}</div>
                                            ) : null}
                                          </div>
                                          <div
                                            className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                            style={{ backgroundColor: 'color-mix(in srgb, white 88%, var(--color-primary) 4%)' }}
                                          >
                                            {expandedLine ? '⌃' : '⌄'}
                                          </div>
                                        </button>

                                        <div className="mt-2 flex items-start justify-between gap-3">
                                          <div className="min-w-0 text-xs text-[var(--color-muted)]">
                                            Đã quét {formatNumber(progress.scannedQty)} · Còn thiếu {formatNumber(progress.remainingQty)}
                                          </div>
                                          <span
                                            className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                            style={{
                                              backgroundColor: 'color-mix(in srgb, white 88%, var(--color-primary) 4%)',
                                              color: 'var(--color-primary)',
                                            }}
                                          >
                                            {formatNumber(progress.scannedQty)}
                                          </span>
                                        </div>

                                        {expandedLine ? (
                                          isAccessory ? (
                                            <div className="mt-2.5">
                                              <Field label="Thực xuất phụ kiện">
                                                <input
                                                  type="number"
                                                  min={0}
                                                  max={line.requestedQty}
                                                  value={actualByLine[line.lineId] ?? String(line.actualQty || 0)}
                                                  onChange={(event) =>
                                                    setActualByLine((current) => ({
                                                      ...current,
                                                      [line.lineId]: event.target.value,
                                                    }))
                                                  }
                                                  className="app-input w-full rounded-xl px-3 py-2 text-right text-sm"
                                                />
                                              </Field>
                                            </div>
                                          ) : (
                                            <div className="mt-2.5">
                                              <div className="space-y-2">
                                                {pickedSerials.length ? (
                                                  <div className="space-y-2">
                                                    {pickedSerials.map((item) => (
                                                      <div
                                                        key={`mobile-line-picked-${line.lineId}-${item.serialId}`}
                                                        className="rounded-xl px-3 py-2 text-sm"
                                                        style={{ backgroundColor: 'white' }}
                                                      >
                                                        <select
                                                          value={item.serialCode}
                                                          onChange={(event) =>
                                                            handlePickedShipmentSerialChange(
                                                              item.serialId,
                                                              line.lineId,
                                                              event.target.value,
                                                              [
                                                                { serialId: item.serialId, serialCode: item.serialCode },
                                                                ...serialOptions.filter((option) => option.serialId !== item.serialId),
                                                              ]
                                                            )
                                                          }
                                                          className="app-input w-full rounded-xl px-3 py-2 text-sm font-mono"
                                                        >
                                                          {[{ serialId: item.serialId, serialCode: item.serialCode }, ...serialOptions.filter((option) => option.serialId !== item.serialId)].map((option) => (
                                                            <option key={option.serialId} value={option.serialCode}>
                                                              {option.serialCode}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                    ))}
                                                  </div>
                                                ) : null}
                                                {progress.remainingQty > 0 ? (
                                                  <select
                                                    value={selectedShipmentSerialByLine[line.lineId] ?? ''}
                                                    onChange={(event) => {
                                                      void handleShipmentSerialSelectionChange(line.lineId, event.target.value, serialOptions)
                                                    }}
                                                    className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                  >
                                                    <option value="">Chọn serial</option>
                                                    {serialOptions.map((option) => (
                                                      <option key={option.serialId} value={option.serialCode}>
                                                        {option.serialCode}
                                                      </option>
                                                    ))}
                                                  </select>
                                                ) : null}
                                              </div>
                                            </div>
                                          )
                                        ) : null}
              </div>
            )
          })}
        </div>
                              ) : (
                                <div className="space-y-1.5 rounded-2xl p-2.5" style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}>
                                  {mobileShipmentLines.map((line) => {
                                    const progress = shipmentProgressByLine.get(line.lineId) || {
                                      requestedQty: Number(line.requestedQty || 0),
                                      scannedQty: 0,
                                      remainingQty: Number(line.requestedQty || 0),
                                    }
                                    return (
                                      <div
                                        key={`mobile-scan-line-${line.lineId}`}
                                        ref={(node) => {
                                          mobileShipmentLineRefs.current[line.lineId] = node
                                        }}
                                        className="flex items-start justify-between gap-3 rounded-xl px-2 py-2"
                                        style={{
                                          backgroundColor:
                                            lastTouchedShipmentLineId === line.lineId
                                              ? 'color-mix(in srgb, white 88%, var(--color-primary) 6%)'
                                              : 'transparent',
                                        }}
                                      >
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold leading-5">{line.itemLabel}</div>
                                          {formatShipmentLineMeta(line) ? (
                                            <div className="mt-1 text-xs text-[var(--color-muted)]">{formatShipmentLineMeta(line)}</div>
                                          ) : null}
                                          <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                                            Đã quét {formatNumber(progress.scannedQty)} · Còn thiếu {formatNumber(progress.remainingQty)}
                                          </div>
                                        </div>
                                        <span
                                          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                          style={{
                                            backgroundColor: 'color-mix(in srgb, white 88%, var(--color-primary) 4%)',
                                            color: 'var(--color-primary)',
                                          }}
                                        >
                                          {formatNumber(progress.scannedQty)}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}

                              {shipmentInputMode === 'SCAN' ? (
                                <div className="rounded-2xl p-3 space-y-2.5" style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="pt-1 text-xs text-[var(--color-muted)]">{adminViewer ? 'Camera hoặc ảnh QR' : 'Camera QR'}</div>
                                    {adminViewer ? (
                                      <button
                                        type="button"
                                        onClick={() => setMobileScanPanelOpen((current) => !current)}
                                        className="rounded-full px-3 py-0.5 text-xs font-semibold"
                                        style={{ backgroundColor: 'white' }}
                                      >
                                        {mobileScanPanelOpen ? '−' : '+'}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => (shipmentScannerOpen ? stopShipmentScanner() : void startShipmentScanner())}
                                        disabled={shipmentScannerStarting || shipmentScanPending}
                                        className="app-outline inline-flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-50"
                                        aria-label={shipmentScannerStarting ? 'Đang scan' : shipmentScannerOpen ? 'Đang scan' : 'Scan'}
                                        title={shipmentScannerStarting ? 'Đang scan' : shipmentScannerOpen ? 'Đang scan' : 'Scan'}
                                      >
                                        <ScanQrIcon className="h-6 w-6" />
                                      </button>
                                    )}
                                  </div>
                                  {(adminViewer ? mobileScanPanelOpen : true) ? (
                                    <>
                                      <div className={`grid gap-2 ${adminViewer ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                        {adminViewer ? (
                                          <button
                                            type="button"
                                            onClick={() => (shipmentScannerOpen ? stopShipmentScanner() : void startShipmentScanner())}
                                            disabled={shipmentScannerStarting || shipmentScanPending}
                                            className="app-outline rounded-xl px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
                                          >
                                            {shipmentScannerStarting ? 'Đang scan...' : shipmentScannerOpen ? 'Đang scan' : 'Scan'}
                                          </button>
                                        ) : null}
                                        {adminViewer ? (
                                          <label className="app-outline rounded-xl px-4 py-1.5 text-sm font-semibold cursor-pointer">
                                            {shipmentScanPending ? 'Đang đọc ảnh...' : 'Chọn ảnh QR'}
                                            <input
                                              type="file"
                                              accept="image/*"
                                              className="hidden"
                                              disabled={shipmentScanPending}
                                              onChange={(event) => {
                                                const file = event.target.files?.[0]
                                                if (file) void scanShipmentImageFile(file)
                                                event.currentTarget.value = ''
                                              }}
                                            />
                                          </label>
                                        ) : null}
                                      </div>
                                      {shipmentScannerOpen || shipmentScannerStarting ? (
                                        <div className="overflow-hidden rounded-2xl" style={{ backgroundColor: '#0f172a' }}>
                                          <video
                                            ref={shipmentVideoRef}
                                            className="h-[220px] w-full object-cover"
                                            muted
                                            playsInline
                                            autoPlay
                                            onLoadedData={() => {
                                              setShipmentCameraReady(true)
                                              if (shipmentReadyTimeoutRef.current != null) {
                                                clearTimeout(shipmentReadyTimeoutRef.current)
                                                shipmentReadyTimeoutRef.current = null
                                              }
                                            }}
                                          />
                                        </div>
                                      ) : null}
                                      <div className="rounded-2xl px-3 py-1.5 text-sm" style={{ backgroundColor: 'white' }}>
                                        Camera: {shipmentCameraReady ? 'Đã lên hình' : shipmentScannerOpen ? 'Đang chờ' : 'Chưa bật'}
                                      </div>
                                      {shipmentScanError ? <div className="app-accent-soft rounded-2xl px-4 py-3 text-sm">{shipmentScanError}</div> : null}
                                      {shipmentScanInfo ? (
                                        <div
                                          className="rounded-2xl border px-4 py-3 text-sm"
                                          style={{
                                            borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                            backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                            color: 'var(--color-primary)',
                                          }}
                                        >
                                          {shipmentScanInfo}
                                        </div>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              ) : null}

                            </div>
                          ) : null}

                          {mobileShipmentStep === 'CONFIRM' ? (
                            <div className="space-y-3">
                              <div className="rounded-2xl p-3.5 space-y-3" style={{ backgroundColor: 'color-mix(in srgb, white 95%, var(--color-primary) 3%)' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (scannedShipmentSerials.length > 0) setMobileSerialListOpen((current) => !current)
                                  }}
                                  className="flex w-full items-center justify-between gap-3 text-left"
                                >
                                  <div>
                                    <div className="text-base font-semibold">Serial đã chọn</div>
                                    <div className="mt-1 text-sm text-[var(--color-muted)]">
                                      {scannedShipmentSerials.length
                                        ? `${formatNumber(scannedShipmentSerials.length)} serial đã được thêm`
                                        : 'Chưa có serial nào được thêm.'}
                                    </div>
                                  </div>
                                  {scannedShipmentSerials.length > 0 ? (
                                    <span className="rounded-full px-3 py-0.5 text-xs font-semibold" style={{ backgroundColor: 'white' }}>
                                      {mobileSerialListOpen ? 'Thu gọn' : 'Xem'}
                                    </span>
                                  ) : null}
                                </button>
                                {mobileSerialListOpen && scannedShipmentSerials.length ? (
                                  <div className="space-y-2">
                                    {scannedShipmentSerials.map((item) => (
                                      <div
                                        key={`mobile-picked-${item.serialId}`}
                                        className="flex items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-sm"
                                        style={{ backgroundColor: 'white' }}
                                      >
                                        <div className="min-w-0">
                                          <div className="truncate font-mono">{item.serialCode}</div>
                                          <div className="text-xs text-[var(--color-muted)]">{item.itemLabel}</div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => removeScannedShipmentSerial(item.serialId)}
                                          className="app-outline rounded-xl px-3 py-0.5 text-sm font-semibold"
                                        >
                                          Xóa
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <div className="space-y-3">
                                <Field label="Ghi chú xác nhận xuất hàng">
                                  <input
                                    value={confirmNote}
                                    onChange={(event) => setConfirmNote(event.target.value)}
                                    className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                    placeholder="Ghi chú nếu thực xuất khác đề nghị"
                                  />
                                </Field>
                              </div>
                            </div>
                          ) : null}

                          <div
                            className="md:hidden fixed inset-x-3 z-30 rounded-2xl border px-3 py-3 shadow-xl"
                            style={{
                              bottom: selectedVoucherIds.length ? '6.75rem' : '0.75rem',
                              borderColor: 'var(--color-border)',
                              backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 4%)',
                              backdropFilter: 'blur(10px)',
                            }}
                          >
                            {mobileShipmentStep === 'PICK' ? (
                              <button
                                type="button"
                                onClick={() => setMobileShipmentStep('CONFIRM')}
                                className="app-primary w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
                              >
                                Sang xác nhận
                              </button>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => setMobileShipmentStep('PICK')}
                                  className="app-outline rounded-xl px-4 py-2.5 text-sm font-semibold"
                                >
                                  Quay lại
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void confirmVoucher()}
                                  disabled={pending}
                                  className="app-primary rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                                >
                                  {pending ? 'Đang xác nhận...' : 'Xác nhận xuất'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        ) : canProcessReturn && returnPanelOpen && detail.returnRequest?.status === 'PENDING' ? (
                        <div className={`space-y-3 ${mobileReturnStep === 'PICK' ? 'pb-24' : 'pb-28'}`}>
                          {mobileReturnStep === 'PICK' ? (
                            <div className="space-y-2.5">
                              <div className="space-y-2 px-1 py-0.5">
                                <div className="grid grid-cols-2 rounded-2xl p-1" style={{ backgroundColor: 'color-mix(in srgb, white 90%, var(--color-primary) 4%)' }}>
                                  <button
                                    type="button"
                                    onClick={() => setReturnInputMode('SCAN')}
                                    className={`rounded-xl px-3 py-1 text-sm font-semibold ${returnInputMode === 'SCAN' ? 'app-primary text-white' : ''}`}
                                  >
                                    Scan
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setReturnInputMode('SELECT')}
                                    className={`rounded-xl px-3 py-1 text-sm font-semibold ${returnInputMode === 'SELECT' ? 'app-primary text-white' : ''}`}
                                  >
                                    Danh sách
                                  </button>
                                </div>
                              </div>

                              {returnInputMode === 'SELECT' ? (
                                <div className="space-y-2.5">
                                  {returnDraftRows.map((rowDraft) => {
                                    const pickedSerialIds = new Set(
                                      returnDraftRows
                                        .filter((item) => item.id !== rowDraft.id)
                                        .map((item) => item.serialId)
                                        .filter(Boolean)
                                    )
                                    const returnedSerialIds = new Set(detail.returnedSerials.map((item) => item.serialId))
                                    const availableSerialOptions = detail.confirmedSerials.filter(
                                      (item) =>
                                        (!returnedSerialIds.has(item.serialId) || item.serialId === rowDraft.serialId) &&
                                        (!pickedSerialIds.has(item.serialId) || item.serialId === rowDraft.serialId)
                                    )

                                    return (
                                      <div
                                        key={`mobile-return-line-${rowDraft.id}`}
                                        className="rounded-2xl p-2.5"
                                        style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}
                                      >
                                        <select
                                          value={rowDraft.serialId}
                                          onChange={(event) => updateReturnDraftSerial(rowDraft.id, event.target.value)}
                                          className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                        >
                                          <option value="">Chọn serial đã xuất</option>
                                          {availableSerialOptions.map((item) => (
                                            <option key={item.serialId} value={item.serialId}>
                                              {item.serialCode}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div className="space-y-1.5 rounded-2xl p-2.5" style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}>
                                  <div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: 'white' }}>
                                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                                      Scan đúng serial hàng về để hệ thống tự nhận đúng đoạn.
                                    </div>
                                  </div>
                                </div>
                              )}

                              {returnInputMode === 'SCAN' ? (
                                <div className="rounded-2xl p-3 space-y-2.5" style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="pt-1 text-xs text-[var(--color-muted)]">{adminViewer ? 'Camera hoặc ảnh QR' : 'Camera QR'}</div>
                                    {adminViewer ? (
                                      <button
                                        type="button"
                                        onClick={() => (returnScannerOpen ? stopReturnScanner() : void startReturnScanner())}
                                        disabled={returnScannerStarting || returnImageScanPending}
                                        className="app-outline rounded-xl px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
                                      >
                                        {returnScannerStarting ? 'Đang scan...' : returnScannerOpen ? 'Đang scan' : 'Scan'}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => (returnScannerOpen ? stopReturnScanner() : void startReturnScanner())}
                                        disabled={returnScannerStarting || returnImageScanPending}
                                        className="app-outline inline-flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-50"
                                        aria-label={returnScannerStarting ? 'Đang scan' : returnScannerOpen ? 'Đang scan' : 'Scan'}
                                        title={returnScannerStarting ? 'Đang scan' : returnScannerOpen ? 'Đang scan' : 'Scan'}
                                      >
                                        <ScanQrIcon className="h-6 w-6" />
                                      </button>
                                    )}
                                  </div>
                                  {adminViewer ? (
                                    <label className="app-outline inline-flex w-full items-center justify-center rounded-xl px-4 py-1.5 text-sm font-semibold cursor-pointer">
                                      {returnImageScanPending ? 'Đang đọc ảnh...' : 'Chọn ảnh QR'}
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        disabled={returnImageScanPending}
                                        onChange={(event) => {
                                          const file = event.target.files?.[0]
                                          if (file) void scanReturnedImageFile(file)
                                          event.currentTarget.value = ''
                                        }}
                                      />
                                    </label>
                                  ) : null}
                                  {returnScannerOpen || returnScannerStarting ? (
                                    <div className="overflow-hidden rounded-2xl" style={{ backgroundColor: '#0f172a' }}>
                                      <video
                                        ref={returnVideoRef}
                                        className="h-[220px] w-full object-cover"
                                        muted
                                        playsInline
                                        autoPlay
                                        onLoadedData={() => {
                                          setReturnCameraReady(true)
                                          if (returnReadyTimeoutRef.current != null) {
                                            clearTimeout(returnReadyTimeoutRef.current)
                                            returnReadyTimeoutRef.current = null
                                          }
                                        }}
                                      />
                                    </div>
                                  ) : null}
                                  <div className="rounded-2xl px-3 py-1.5 text-sm" style={{ backgroundColor: 'white' }}>
                                    Camera: {returnCameraReady ? 'Đã lên hình' : returnScannerOpen ? 'Đang chờ' : 'Chưa bật'}
                                  </div>
                                  {returnScanError ? <div className="app-accent-soft rounded-2xl px-4 py-3 text-sm">{returnScanError}</div> : null}
                                  {returnScanInfo ? (
                                    <div
                                      className="rounded-2xl border px-4 py-3 text-sm"
                                      style={{
                                        borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                        backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                        color: 'var(--color-primary)',
                                      }}
                                    >
                                      {returnScanInfo}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              {returnDraftRows.length ? (
                                <div className="rounded-2xl p-3 space-y-2.5" style={{ backgroundColor: 'color-mix(in srgb, white 95%, var(--color-primary) 3%)' }}>
                                  <div className="text-sm font-semibold">Serial đã thêm</div>
                                  <div className="space-y-2">
                                    {returnDraftRows.map((rowDraft) => {
                                      const confirmed = detail.confirmedSerials.find((item) => item.serialId === rowDraft.serialId)
                                      if (!confirmed) return null
                                      const availableSerialOptions = detail.confirmedSerials.filter(
                                        (item) =>
                                          !detail.returnedSerials.some((returned) => returned.serialId === item.serialId) &&
                                          !returnDraftRows.some(
                                            (draft) => draft.id !== rowDraft.id && draft.serialId === item.serialId
                                          )
                                      )
                                      return (
                                        <div
                                          key={`mobile-return-picked-inline-${rowDraft.id}`}
                                          className="space-y-2 rounded-xl px-3 py-2 text-sm"
                                          style={{ backgroundColor: 'white' }}
                                        >
                                          <select
                                            value={rowDraft.serialId}
                                            onChange={(event) => updateReturnDraftSerial(rowDraft.id, event.target.value)}
                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                          >
                                            {[confirmed, ...availableSerialOptions.filter((item) => item.serialId !== confirmed.serialId)].map((item) => (
                                              <option key={item.serialId} value={item.serialId}>
                                                {item.serialCode}
                                              </option>
                                            ))}
                                          </select>
                                          <select
                                            value={rowDraft.resolutionStatus}
                                            onChange={(event) =>
                                              setReturnDraftRows((current) =>
                                                current.map((item) =>
                                                  item.id === rowDraft.id
                                                    ? {
                                                        ...item,
                                                        resolutionStatus: (event.target.value === 'NHAP_KHACH_LE'
                                                          ? 'NHAP_KHACH_LE'
                                                          : event.target.value === 'HUY'
                                                            ? 'HUY'
                                                            : event.target.value === 'NHAP_DU_AN'
                                                              ? 'NHAP_DU_AN'
                                                              : '') as ShipmentReturnDraftRow['resolutionStatus'],
                                                      }
                                                    : item
                                                )
                                              )
                                            }
                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                          >
                                            <option value="">Chọn hướng xử lý</option>
                                            <option value="NHAP_DU_AN">Nhập về dự án</option>
                                            <option value="NHAP_KHACH_LE">Nhập về khách lẻ</option>
                                            <option value="HUY">Hủy bỏ</option>
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => removeReturnDraftRow(rowDraft.id)}
                                            className="app-outline w-full rounded-xl px-3 py-1.5 text-sm font-semibold"
                                          >
                                            Xóa serial này
                                          </button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="rounded-2xl p-3.5 space-y-3" style={{ backgroundColor: 'color-mix(in srgb, white 95%, var(--color-primary) 3%)' }}>
                                <div>
                                  <div className="text-base font-semibold">Serial trả lại</div>
                                  <div className="mt-1 text-sm text-[var(--color-muted)]">
                                    {returnDraftRows.length
                                      ? `${formatNumber(returnDraftRows.length)} serial đã được thêm`
                                      : 'Chưa có serial nào được thêm.'}
                                  </div>
                                </div>
                                {returnDraftRows.length ? (
                                  <div className="space-y-2">
                                    {returnDraftRows.map((rowDraft) => {
                                      const confirmed = detail.confirmedSerials.find((item) => item.serialId === rowDraft.serialId)
                                      if (!confirmed) return null
                                      const availableSerialOptions = detail.confirmedSerials.filter(
                                        (item) =>
                                          !detail.returnedSerials.some((returned) => returned.serialId === item.serialId) &&
                                          !returnDraftRows.some(
                                            (draft) => draft.id !== rowDraft.id && draft.serialId === item.serialId
                                          )
                                      )
                                      return (
                                        <div
                                          key={`mobile-return-picked-${rowDraft.id}`}
                                          className="space-y-2 rounded-xl px-3 py-2 text-sm"
                                          style={{ backgroundColor: 'white' }}
                                        >
                                          <select
                                            value={rowDraft.serialId}
                                            onChange={(event) => updateReturnDraftSerial(rowDraft.id, event.target.value)}
                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                          >
                                            {[confirmed, ...availableSerialOptions.filter((item) => item.serialId !== confirmed.serialId)].map((item) => (
                                              <option key={item.serialId} value={item.serialId}>
                                                {item.serialCode}
                                              </option>
                                            ))}
                                          </select>
                                          <select
                                            value={rowDraft.resolutionStatus}
                                            onChange={(event) =>
                                              setReturnDraftRows((current) =>
                                                current.map((item) =>
                                                  item.id === rowDraft.id
                                                    ? {
                                                        ...item,
                                                        resolutionStatus: (event.target.value === 'NHAP_KHACH_LE'
                                                          ? 'NHAP_KHACH_LE'
                                                          : event.target.value === 'HUY'
                                                            ? 'HUY'
                                                            : event.target.value === 'NHAP_DU_AN'
                                                              ? 'NHAP_DU_AN'
                                                              : '') as ShipmentReturnDraftRow['resolutionStatus'],
                                                      }
                                                    : item
                                                )
                                              )
                                            }
                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                          >
                                            <option value="">Chọn hướng xử lý</option>
                                            <option value="NHAP_DU_AN">Nhập về dự án</option>
                                            <option value="NHAP_KHACH_LE">Nhập về khách lẻ</option>
                                            <option value="HUY">Hủy bỏ</option>
                                          </select>
                                          <input
                                            value={rowDraft.note}
                                            onChange={(event) =>
                                              setReturnDraftRows((current) =>
                                                current.map((item) => (item.id === rowDraft.id ? { ...item, note: event.target.value } : item))
                                              )
                                            }
                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                            placeholder="Ghi chú nếu cần"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => removeReturnDraftRow(rowDraft.id)}
                                            className="app-outline w-full rounded-xl px-3 py-1.5 text-sm font-semibold"
                                          >
                                            Xóa serial này
                                          </button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                ) : null}
                              </div>

                              <Field label="Ghi chú kho khi nhận hàng trả lại">
                                <input
                                  value={returnNote}
                                  onChange={(event) => setReturnNote(event.target.value)}
                                  className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                  placeholder="Ghi chú nếu serial thực tế khác đề nghị"
                                />
                              </Field>
                            </div>
                          )}

                          <div
                            className="md:hidden fixed inset-x-3 z-30 rounded-2xl border px-3 py-3 shadow-xl"
                            style={{
                              bottom: selectedVoucherIds.length ? '6.75rem' : '0.75rem',
                              borderColor: 'var(--color-border)',
                              backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 4%)',
                              backdropFilter: 'blur(10px)',
                            }}
                          >
                            {mobileReturnStep === 'PICK' ? (
                              <button
                                type="button"
                                onClick={() => setMobileReturnStep('CONFIRM')}
                                className="app-primary w-full rounded-xl px-4 py-2.5 text-sm font-semibold"
                              >
                                Sang xác nhận
                              </button>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMobileReturnStep('PICK')
                                    if (!mobileExpandedReturnLineId) {
                                      setMobileExpandedReturnLineId(returnRequestLineSummaries[0]?.lineId || '')
                                    }
                                  }}
                                  className="app-outline rounded-xl px-4 py-2.5 text-sm font-semibold"
                                >
                                  Quay lại
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void submitReturnedSerials()}
                                  disabled={pending || !returnDraftRows.length}
                                  className="app-primary rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                                >
                                  {pending ? 'Đang xử lý...' : 'Xác nhận trả'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="rounded-2xl p-3.5 space-y-3" style={{ backgroundColor: 'color-mix(in srgb, white 95%, var(--color-primary) 3%)' }}>
                              <div>
                                <div className="text-base font-semibold">Tổng quan phiếu</div>
                                <div className="mt-2 space-y-1 text-sm">
                                  <div><span className="text-[var(--color-muted)]">Mã phiếu</span> <span className="font-semibold">{detail.maPhieu}</span></div>
                                  <div>
                                    <span className="text-[var(--color-muted)]">Khách hàng / đơn hàng</span>{' '}
                                    <span className="font-semibold">{detail.customerName || '-'} / {detail.orderLabel || detail.projectName || '-'}</span>
                                  </div>
                                  <div><span className="text-[var(--color-muted)]">Trạng thái hiện tại</span> <span className="font-semibold">{formatStatusLabel(detail.status)}</span></div>
                                </div>
                              </div>

                              <div className="rounded-xl px-3 py-3 text-sm" style={{ backgroundColor: 'white' }}>
                                <div className="text-base font-semibold">Xuất hàng</div>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                  <span><span className="text-[var(--color-muted)]">Đề nghị xuất</span> <span className="font-semibold">{formatNumber(detail.requestedQtyTotal)}</span></span>
                                  <span><span className="text-[var(--color-muted)]">Đã xuất</span> <span className="font-semibold">{formatNumber(detail.confirmedSerials.length > 0 ? detail.confirmedSerials.length : detail.actualQtyTotal)}</span></span>
                                </div>
                                <div className="mt-3 text-sm font-semibold">Danh sách serial đã xuất</div>
                                <div className="mt-2 space-y-2">
                                  {detail.confirmedSerials.length ? (
                                    detail.confirmedSerials.map((item) => (
                                      <div
                                        key={`mobile-confirmed-${item.serialId}`}
                                        className="rounded-xl px-3 py-2 text-sm"
                                        style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}
                                      >
                                        <div className="font-mono">{item.serialCode}</div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-sm text-[var(--color-muted)]">Chưa có serial đã xuất.</div>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-xl px-3 py-3 text-sm" style={{ backgroundColor: 'white' }}>
                                <div className="text-base font-semibold">Trả hàng</div>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                  <span><span className="text-[var(--color-muted)]">Đề nghị trả</span> <span className="font-semibold">{formatNumber(returnRequestedQtyTotal)}</span></span>
                                  <span><span className="text-[var(--color-muted)]">Đã trả</span> <span className="font-semibold">{formatNumber(detail.returnedSerials.length)}</span></span>
                                </div>
                                <div className="mt-3 text-sm font-semibold">Danh sách serial đã trả</div>
                                <div className="mt-2 space-y-2">
                                  {detail.returnedSerials.length ? (
                                    detail.returnedSerials.map((item) => (
                                      <div
                                        key={`mobile-returned-${item.serialId}`}
                                        className="rounded-xl px-3 py-2 text-sm"
                                        style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}
                                      >
                                        <div className="font-mono">{item.serialCode}</div>
                                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                                          {formatReturnResolutionLabel(item.resolutionStatus)}
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-sm text-[var(--color-muted)]">Chưa có serial đã trả.</div>
                                  )}
                                </div>
                              </div>

                              {mobileCanEditReturnRequest ? (
                                <div className="rounded-xl px-3 py-3 text-sm" style={{ backgroundColor: 'white' }}>
                                  <div className="text-base font-semibold">Đề nghị trả hàng</div>
                                  <div className="mt-1 text-sm text-[var(--color-muted)]">
                                    KTBH chỉ nhập tổng số đoạn cần trả. Chưa chọn serial ở bước này. Khi hàng về kho, Thủ kho sẽ scan hoặc chọn mã đã xuất để hệ thống tự xác định đúng đoạn.
                                  </div>
                                  <div
                                    className="mt-3 rounded-xl px-3 py-3"
                                    style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}
                                  >
                                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                      <span><span className="text-[var(--color-muted)]">Đã xuất</span> <span className="font-semibold">{formatNumber(detail.confirmedSerials.length > 0 ? detail.confirmedSerials.length : detail.actualQtyTotal)}</span></span>
                                      <span><span className="text-[var(--color-muted)]">Có thể đề nghị</span> <span className="font-semibold">{formatNumber(hydratedReturnCapacity)}</span></span>
                                    </div>
                                    <div className="mt-3">
                                      <input
                                        type="number"
                                        min={0}
                                        max={hydratedReturnCapacity}
                                        value={returnRequestQty}
                                        onChange={(event) => setReturnRequestQty(event.target.value)}
                                        disabled={!mobileCanEditReturnRequest}
                                        className="app-input w-full rounded-xl px-3 py-2 text-right text-sm disabled:opacity-60"
                                        placeholder="Nhập tổng số đoạn cần trả"
                                      />
                                    </div>
                                  </div>
                                  {mobileReturnRequest ? (
                                    <div
                                      className="mt-3 rounded-2xl border px-4 py-3 text-sm"
                                      style={{
                                        borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                        backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                        color: 'var(--color-primary)',
                                      }}
                                    >
                                      {mobileReturnRequest.status === 'PENDING'
                                        ? 'Đã có đề nghị trả hàng đang chờ Thủ kho xử lý.'
                                        : 'Đề nghị trả hàng gần nhất đã được Thủ kho xử lý.'}
                                    </div>
                                  ) : null}
                                  <div className="mt-3 space-y-3">
                                    <Field label="Ghi chú đề nghị trả hàng">
                                      <input
                                        value={returnRequestNote}
                                        onChange={(event) => setReturnRequestNote(event.target.value)}
                                        className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                        placeholder="Ghi chú nếu khách báo không nhận hàng"
                                      />
                                    </Field>
                                    <button
                                      type="button"
                                      onClick={() => void submitReturnRequest()}
                                      disabled={pending}
                                      className="app-primary w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                                    >
                                      {pending ? 'Đang gửi đề nghị...' : 'Gửi đề nghị trả hàng'}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      ) : null
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}

          {visibleVoucherRows.length === 0 ? (
            <div className="rounded-2xl border px-4 py-8 text-center text-sm text-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)' }}>
              Chưa có phiếu xuất hàng nào.
            </div>
          ) : null}
        </div>

        <div
          className={detailPage ? 'max-md:hidden overflow-hidden border-y bg-white' : 'max-md:hidden overflow-hidden rounded-2xl border bg-white'}
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="max-h-[36rem] overflow-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
          <table className="min-w-full text-left text-sm">
            <thead className={detailPage ? 'hidden' : 'sticky top-0 z-10'}>
              <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                <th className="w-14 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={!detailPage && pagedVoucherRows.length > 0 && pagedVoucherRows.every((row) => selectedVoucherIds.includes(row.voucherId))}
                    onChange={(event) => toggleSelectAllPaged(event.target.checked)}
                    disabled={detailPage}
                  />
                </th>
                <th className="w-44 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Mã phiếu</th>
                <th className="w-40 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Nguồn</th>
                <th className="min-w-[280px] px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Khách hàng</th>
                <th className="min-w-[220px] px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Trạng thái</th>
                <th className="w-32 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đề nghị</th>
                <th className="w-32 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Thực xuất</th>
              </tr>
            </thead>
            <tbody>
              {visibleVoucherRows.map((row) => {
                const expanded = detailPage ? true : expandedVoucherId === row.voucherId
                const returnPanelOpen = returnPanelVoucherId === row.voucherId
                const detail = expanded ? row.detail || expandedVoucherDetail : null
                const confirmedSerials = detail?.confirmedSerials || []
                const returnedSerials = detail?.returnedSerials || []
                const returnRequest = detail?.returnRequest || null
                const rowHasReturnRequest = Boolean(row.hasReturnData || row.detail?.returnRequest || row.detail?.returnedSerials?.length)
                const shouldShowReturnSection = returnPanelOpen || Boolean(returnRequest)
                const canEditReturnRequest =
                  canRequestReturn && hydratedReturnCapacity > 0 && (!returnRequest || returnRequest.status === 'COMPLETED')
                const confirmedCountByLine = new Map<string, number>()
                for (const item of confirmedSerials) {
                  confirmedCountByLine.set(item.lineId, (confirmedCountByLine.get(item.lineId) ?? 0) + 1)
                }
                const returnedCountByLine = new Map<string, number>()
                for (const item of returnedSerials) {
                  returnedCountByLine.set(item.lineId, (returnedCountByLine.get(item.lineId) ?? 0) + 1)
                }

                return (
                  <Fragment key={row.voucherId}>
                    {detailPage ? (
                      <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                            <div className="min-w-0">
                              <div className="font-semibold">{row.maPhieu}</div>
                              <div className="mt-1 truncate text-sm text-[var(--color-muted)]">
                                {row.customerName || '-'}{row.orderLabel || row.projectName ? ` · ${row.orderLabel || row.projectName}` : ''}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                              <span>
                                <span className="text-[var(--color-muted)]">Nguồn</span>{' '}
                                <span className="font-medium">{row.sourceType === 'DON_HANG' ? 'Theo đơn hàng' : 'Bán tồn kho'}</span>
                              </span>
                              <span>
                                <span className="text-[var(--color-muted)]">Trạng thái</span>{' '}
                                <span className="font-medium">{formatCompactStatusLabel(row.status)}</span>
                              </span>
                              <span>
                                <span className="text-[var(--color-muted)]">SL</span>{' '}
                                <span className="font-medium">{formatNumber(row.actualQtyTotal)} / {formatNumber(row.requestedQtyTotal)}</span>
                              </span>
                              {rowHasReturnRequest ? (
                                <span
                                  className="inline-flex rounded-full border px-2 py-1 text-[11px] font-medium"
                                  style={{
                                    borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                    backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                    color: 'var(--color-primary)',
                                  }}
                                >
                                  Có trả hàng
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr className="border-t align-top" style={{ borderColor: 'var(--color-border)' }}>
                        <td className="px-4 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedVoucherIds.includes(row.voucherId)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => toggleVoucherSelected(row.voucherId, event.target.checked)}
                          />
                        </td>
                        <td className="px-4 py-4 font-semibold">
                          <Link
                            href={`/don-hang/phieu-xuat/${row.voucherId}?from=list`}
                            prefetch={false}
                            className="text-left font-semibold underline-offset-2 hover:underline"
                          >
                            {row.maPhieu}
                          </Link>
                        </td>
                        <td className="px-4 py-4">{row.sourceType === 'DON_HANG' ? 'Theo đơn hàng' : 'Bán tồn kho'}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.customerName || '-'}</div>
                          <div className="text-xs text-[var(--color-muted)]">{row.orderLabel || row.projectName || '-'}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div>{formatCompactStatusLabel(row.status)}</div>
                          {rowHasReturnRequest ? (
                            <div className="mt-2">
                              <span
                                className="inline-flex rounded-full border px-2 py-1 text-[11px] font-medium"
                                style={{
                                  borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                  backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                  color: 'var(--color-primary)',
                                }}
                              >
                                Có trả hàng
                              </span>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-right font-medium">{formatNumber(row.requestedQtyTotal)}</td>
                        <td className="px-4 py-4 text-right font-medium">{formatNumber(row.actualQtyTotal)}</td>
                      </tr>
                    )}
                    {expanded ? (
                      <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <td colSpan={7} className={detailPage ? 'px-4 py-0' : 'px-4 py-4'} style={{ backgroundColor: detailPage ? 'white' : 'color-mix(in srgb, var(--color-primary) 3%, white)' }}>
                            <div className="space-y-4">
                              {detail ? (
                                <div className="space-y-4">
                                  {canConfirm ? (
                                    <>
                                      <div className="space-y-4">
                                        <div className="inline-flex gap-6 border-b text-sm font-semibold" style={{ borderColor: 'var(--color-border)' }}>
                                          <button
                                            type="button"
                                            onClick={() => setShipmentInputMode('SCAN')}
                                            className={`border-b-2 px-1 pb-2 pt-1 ${shipmentInputMode === 'SCAN' ? '' : 'text-[var(--color-muted)]'}`}
                                            style={{
                                              borderColor: shipmentInputMode === 'SCAN' ? 'var(--color-primary)' : 'transparent',
                                              color: shipmentInputMode === 'SCAN' ? 'var(--color-primary)' : undefined,
                                            }}
                                          >
                                            Scan
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setShipmentInputMode('SELECT')}
                                            className={`border-b-2 px-1 pb-2 pt-1 ${shipmentInputMode === 'SELECT' ? '' : 'text-[var(--color-muted)]'}`}
                                            style={{
                                              borderColor: shipmentInputMode === 'SELECT' ? 'var(--color-primary)' : 'transparent',
                                              color: shipmentInputMode === 'SELECT' ? 'var(--color-primary)' : undefined,
                                            }}
                                          >
                                            Danh sách
                                          </button>
                                        </div>

                                        {shipmentInputMode === 'SCAN' ? (
                                        <div className="space-y-4 border-b pb-4" style={{ borderColor: 'var(--color-border)' }}>
                                          <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                              <ScanQrIcon className="h-7 w-7" />
                                              <div className="mt-1 text-sm text-[var(--color-muted)]">
                                                {adminViewer
                                                  ? 'Dùng điện thoại để quét ngoài xưởng hoặc chọn ảnh QR khi camera không tiện.'
                                                  : 'Dùng điện thoại để quét ngoài xưởng.'}
                                              </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={() => (shipmentScannerOpen ? stopShipmentScanner() : void startShipmentScanner())}
                                                disabled={shipmentScannerStarting || shipmentScanPending}
                                                className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                              >
                                                {shipmentScannerStarting ? 'Đang scan...' : shipmentScannerOpen ? 'Đang scan' : 'Scan'}
                                              </button>
                                              {adminViewer ? (
                                                <label className="app-outline rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">
                                                  {shipmentScanPending ? 'Đang đọc ảnh...' : 'Chọn ảnh QR'}
                                                  <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    disabled={shipmentScanPending}
                                                    onChange={(event) => {
                                                      const file = event.target.files?.[0]
                                                      if (file) {
                                                        void scanShipmentImageFile(file)
                                                      }
                                                      event.currentTarget.value = ''
                                                    }}
                                                  />
                                                </label>
                                              ) : null}
                                            </div>
                                          </div>

                                          <div className="space-y-3">
                                            <div className="overflow-hidden rounded-2xl" style={{ backgroundColor: '#0f172a' }}>
                                              <video
                                                ref={shipmentVideoRef}
                                                className="h-[360px] w-full object-cover"
                                                muted
                                                playsInline
                                                autoPlay
                                                onLoadedData={() => {
                                                  setShipmentCameraReady(true)
                                                  if (shipmentReadyTimeoutRef.current != null) {
                                                    clearTimeout(shipmentReadyTimeoutRef.current)
                                                    shipmentReadyTimeoutRef.current = null
                                                  }
                                                }}
                                              />
                                            </div>
                                            <div className="border px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                              Trạng thái camera: {shipmentCameraReady ? 'Đã lên hình' : shipmentScannerOpen ? 'Đang chờ camera' : 'Chưa bật'}
                                            </div>
                                            {shipmentScanError ? (
                                              <div className="app-accent-soft px-4 py-3 text-sm">{shipmentScanError}</div>
                                            ) : null}
                                            {shipmentScanInfo ? (
                                              <div
                                                className="border px-4 py-3 text-sm"
                                                style={{
                                                  borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                                  backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                                  color: 'var(--color-primary)',
                                                }}
                                              >
                                                {shipmentScanInfo}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                        ) : null}

                                        <div className="grid gap-3">
                                          {detail!.lines.map((line) => {
                                            const progress = shipmentProgressByLine.get(line.lineId) || {
                                              requestedQty: Number(line.requestedQty || 0),
                                              scannedQty: 0,
                                              remainingQty: Number(line.requestedQty || 0),
                                            }
                                            const isAccessory = line.loaiCoc === 'PHU_KIEN'
                                            const serialOptions = availableShipmentSerialOptionsByLine.get(line.lineId) || []
                                            const pickedSerials = scannedShipmentSerials.filter((item) => item.lineId === line.lineId)
                                            return (
                                              <div
                                                key={line.lineId}
                                                className="border-b px-1 py-4"
                                                style={{ borderColor: 'var(--color-border)' }}
                                              >
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                  <div>
                                                    <div className="font-semibold">{line.itemLabel}</div>
                                                    {formatShipmentLineMeta(line) ? (
                                                      <div className="mt-1 text-xs text-[var(--color-muted)]">{formatShipmentLineMeta(line)}</div>
                                                    ) : null}
                                                    <div className="mt-1 text-sm text-[var(--color-muted)]">
                                                      Khả dụng {formatNumber(line.availableQtySnapshot)} · Đề nghị {formatNumber(line.requestedQty)}
                                                    </div>
                                                  </div>
                                                  <div className="flex flex-wrap gap-2 text-xs font-medium">
                                                    <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--color-border)' }}>
                                                      Đã quét {formatNumber(progress.scannedQty)}
                                                    </span>
                                                    <span
                                                      className="rounded-full border px-3 py-1"
                                                      style={{
                                                        borderColor:
                                                          progress.remainingQty > 0
                                                            ? 'color-mix(in srgb, #d97706 25%, white)'
                                                            : 'color-mix(in srgb, #16a34a 24%, white)',
                                                        backgroundColor:
                                                          progress.remainingQty > 0
                                                            ? 'color-mix(in srgb, #f59e0b 10%, white)'
                                                            : 'color-mix(in srgb, #16a34a 10%, white)',
                                                        color: progress.remainingQty > 0 ? '#9a3412' : '#166534',
                                                      }}
                                                    >
                                                      {progress.remainingQty > 0
                                                        ? `Còn thiếu ${formatNumber(progress.remainingQty)}`
                                                        : 'Đã đủ serial'}
                                                    </span>
                                                  </div>
                                                </div>

                                                {isAccessory ? (
                                                  <div className="mt-4 max-w-[220px]">
                                                    <Field label="Thực xuất phụ kiện">
                                                      <input
                                                        type="number"
                                                        min={0}
                                                        max={line.requestedQty}
                                                        value={actualByLine[line.lineId] ?? String(line.actualQty || 0)}
                                                        onChange={(event) =>
                                                          setActualByLine((current) => ({
                                                            ...current,
                                                            [line.lineId]: event.target.value,
                                                          }))
                                                        }
                                                        className="app-input w-full rounded-xl px-3 py-2 text-right text-sm"
                                                      />
                                                    </Field>
                                                  </div>
                                                ) : shipmentInputMode === 'SELECT' ? (
                                                  <div className="mt-4 space-y-3">
                                                    {pickedSerials.length ? (
                                                      <div className="space-y-2">
                                                        {pickedSerials.map((item) => (
                                                          <div
                                                            key={`desktop-line-picked-${line.lineId}-${item.serialId}`}
                                                            className="rounded-xl px-3 py-2 text-sm"
                                                            style={{ backgroundColor: 'color-mix(in srgb, white 96%, var(--color-primary) 2%)' }}
                                                          >
                                                            <select
                                                              value={item.serialCode}
                                                              onChange={(event) =>
                                                                handlePickedShipmentSerialChange(
                                                                  item.serialId,
                                                                  line.lineId,
                                                                  event.target.value,
                                                                  [
                                                                    { serialId: item.serialId, serialCode: item.serialCode },
                                                                    ...serialOptions.filter((option) => option.serialId !== item.serialId),
                                                                  ]
                                                                )
                                                              }
                                                              className="app-input w-full rounded-xl px-3 py-2 text-sm font-mono"
                                                            >
                                                              {[{ serialId: item.serialId, serialCode: item.serialCode }, ...serialOptions.filter((option) => option.serialId !== item.serialId)].map((option) => (
                                                                <option key={option.serialId} value={option.serialCode}>
                                                                  {option.serialCode}
                                                                </option>
                                                              ))}
                                                            </select>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    ) : null}
                                                    {progress.remainingQty > 0 ? (
                                                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                                                        <select
                                                          value={selectedShipmentSerialByLine[line.lineId] ?? ''}
                                                          onChange={(event) => {
                                                            void handleShipmentSerialSelectionChange(line.lineId, event.target.value, serialOptions)
                                                          }}
                                                          className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                        >
                                                          <option value="">Chọn serial</option>
                                                          {serialOptions.map((option) => (
                                                            <option key={option.serialId} value={option.serialCode}>
                                                              {option.serialCode}
                                                            </option>
                                                          ))}
                                                        </select>
                                                      </div>
                                                    ) : null}
                                                  </div>
                                                ) : null}
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>

                                      <div className="space-y-4 border-b py-4" style={{ borderColor: 'var(--color-border)' }}>
                                        <div className="text-base font-semibold">Serial đã chọn</div>
                                        <div className="overflow-x-auto">
                                          <table className="min-w-full text-left text-sm">
                                            <thead>
                                              <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                                                <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Serial</th>
                                                <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Hàng</th>
                                                <th className="w-24 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-center">Xóa</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {scannedShipmentSerials.map((item) => (
                                                <tr key={item.serialId} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                                  <td className="px-4 py-3 font-mono text-sm">{item.serialCode}</td>
                                                  <td className="px-4 py-3">{item.itemLabel}</td>
                                                  <td className="px-4 py-3 text-center">
                                                    <button
                                                      type="button"
                                                      onClick={() => removeScannedShipmentSerial(item.serialId)}
                                                      className="app-outline rounded-xl px-3 py-1 text-sm font-semibold"
                                                    >
                                                      Xóa
                                                    </button>
                                                  </td>
                                                </tr>
                                              ))}
                                              {scannedShipmentSerials.length === 0 ? (
                                                <tr>
                                                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                                                    Chưa có serial thực xuất nào được thêm.
                                                  </td>
                                                </tr>
                                              ) : null}
                                            </tbody>
                                          </table>
                                        </div>

                                        <div className="flex flex-wrap items-end gap-3">
                                          <div className="min-w-[280px] flex-1">
                                            <Field label="Ghi chú xác nhận xuất hàng">
                                              <input
                                                value={confirmNote}
                                                onChange={(event) => setConfirmNote(event.target.value)}
                                                className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                placeholder="Ghi chú nếu thực xuất khác đề nghị"
                                              />
                                            </Field>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => void confirmVoucher()}
                                            disabled={pending}
                                            className="app-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                          >
                                            {pending ? 'Đang xác nhận...' : 'Thủ kho xác nhận xuất'}
                                          </button>
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <div
                                      className={detailPage ? 'overflow-x-auto border-b' : 'overflow-x-auto rounded-2xl border'}
                                      style={{ borderColor: 'var(--color-border)' }}
                                    >
                                      <table className="min-w-full text-left text-sm">
                                        <thead>
                                          <tr style={{ backgroundColor: detailPage ? 'color-mix(in srgb, var(--color-primary) 5%, white)' : 'white' }}>
                                            <th className="min-w-[320px] px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Hàng</th>
                                            <th className="w-28 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Khả dụng</th>
                                            <th className="w-28 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đề nghị</th>
                                            <th className="w-28 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Thực xuất</th>
                                            {showWarehouseFinanceColumns ? (
                                              <>
                                                <th className="w-36 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Đơn giá</th>
                                                <th className="w-40 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-right">Thành tiền</th>
                                              </>
                                            ) : null}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {detail.lines.map((line) => (
                                            <tr key={line.lineId} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                              <td className="px-4 py-3">
                                                <div className="font-semibold">{line.itemLabel}</div>
                                                {formatShipmentLineMeta(line) ? (
                                                  <div className="mt-1 text-xs text-[var(--color-muted)]">{formatShipmentLineMeta(line)}</div>
                                                ) : null}
                                              </td>
                                              <td className="px-4 py-3 text-right">{formatNumber(line.availableQtySnapshot)}</td>
                                              <td className="px-4 py-3 text-right">{formatNumber(line.requestedQty)}</td>
                                              <td className="px-4 py-3 text-right">{formatNumber(line.actualQty)}</td>
                                              {showWarehouseFinanceColumns ? (
                                                <>
                                                  <td className="px-4 py-3 text-right">
                                                    {line.unitPriceSnapshot != null
                                                      ? `${formatMoney(line.unitPriceSnapshot)}${line.sourceType === 'DON_HANG' ? ' /md' : ''}`
                                                      : '-'}
                                                  </td>
                                                  <td className="px-4 py-3 text-right">
                                                    {line.lineTotalSnapshot != null ? formatMoney(line.lineTotalSnapshot) : '-'}
                                                  </td>
                                                </>
                                              ) : null}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              ) : detailPending ? (
                                <div className="rounded-2xl border px-4 py-6 text-sm text-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)' }}>
                                  Đang tải chi tiết phiếu xuất...
                                </div>
                              ) : null}

                            {(canRequestReturn || canProcessReturn) && shouldShowReturnSection ? (
                              <div className={detailPage ? 'space-y-4 border-b py-4' : 'space-y-4'} style={detailPage ? { borderColor: 'var(--color-border)' } : undefined}>
                                <div
                                  data-return-request-anchor={row.voucherId}
                                  className={detailPage ? 'px-0 py-1' : 'rounded-2xl border px-4 py-3'}
                                  style={
                                    detailPage
                                      ? undefined
                                      : {
                                          borderColor: 'var(--color-border)',
                                          backgroundColor: 'color-mix(in srgb, var(--color-primary) 2%, white)',
                                        }
                                  }
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className={detailPage ? 'text-sm font-semibold' : 'text-base font-semibold'}>
                                      Đề nghị trả hàng
                                      {detailPage && returnRequest ? (
                                        <span className="ml-3 font-normal text-[var(--color-muted)]">
                                          Đề nghị {formatNumber(returnRequest.requestedQtyTotal)} · Đã xử lý {formatNumber(returnedSerials.length)}
                                        </span>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setReturnPanelVoucherId((current) => (current === row.voucherId ? '' : row.voucherId))
                                      }
                                      className="app-outline inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                                      aria-label={returnPanelOpen ? 'Thu gọn đề nghị trả hàng' : 'Mở đề nghị trả hàng'}
                                    >
                                      <span
                                        style={{
                                          display: 'inline-block',
                                          transform: returnPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                          transition: 'transform 180ms ease',
                                          lineHeight: 1,
                                        }}
                                      >
                                        v
                                      </span>
                                    </button>
                                  </div>
                                </div>

                                {returnPanelOpen && canEditReturnRequest ? (
                                  <div
                                    className="rounded-2xl border p-4 space-y-4"
                                    style={{ borderColor: 'var(--color-border)' }}
                                  >
                                    <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
                                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                        <span><span className="text-[var(--color-muted)]">Đã xuất</span> <span className="font-semibold">{formatNumber(detail!.confirmedSerials.length > 0 ? detail!.confirmedSerials.length : detail!.actualQtyTotal)}</span></span>
                                        <span><span className="text-[var(--color-muted)]">Có thể đề nghị</span> <span className="font-semibold">{formatNumber(hydratedReturnCapacity)}</span></span>
                                      </div>
                                      <div className="text-sm text-[var(--color-muted)]">
                                        Nhập tổng số đoạn cần trả. Serial sẽ do Thủ kho chọn khi hàng về.
                                      </div>
                                      <div className="max-w-[240px]">
                                        <Field label="Tổng số đoạn cần trả">
                                          <input
                                            type="number"
                                            min={0}
                                            max={hydratedReturnCapacity}
                                            value={returnRequestQty}
                                            onChange={(event) => setReturnRequestQty(event.target.value)}
                                            disabled={!canEditReturnRequest}
                                            className="app-input w-full rounded-xl px-3 py-2 text-right text-sm disabled:opacity-60"
                                            placeholder="Nhập tổng số đoạn"
                                          />
                                        </Field>
                                      </div>
                                    </div>
                                    {returnRequest ? (
                                      <div
                                        className="rounded-2xl border px-4 py-3 text-sm"
                                        style={{
                                          borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                          backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                          color: 'var(--color-primary)',
                                        }}
                                      >
                                        {returnRequest.status === 'PENDING'
                                          ? 'Đã có đề nghị trả hàng đang chờ Thủ kho xử lý.'
                                          : 'Đề nghị trả hàng gần nhất đã được Thủ kho xử lý.'}
                                      </div>
                                    ) : null}
                                    <div className="flex flex-wrap items-end gap-3">
                                      <div className="min-w-[280px] flex-1">
                                        <Field label="Ghi chú đề nghị trả hàng">
                                          <input
                                            value={returnRequestNote}
                                            onChange={(event) => setReturnRequestNote(event.target.value)}
                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                            placeholder="Ghi chú nếu khách báo không nhận hàng"
                                          />
                                        </Field>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void submitReturnRequest()}
                                        disabled={pending}
                                        className="app-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                      >
                                        {pending ? 'Đang gửi đề nghị...' : 'Gửi đề nghị trả hàng'}
                                      </button>
                                    </div>
                                  </div>
                                ) : null}

                                {returnPanelOpen && returnRequest && !canEditReturnRequest && !canProcessReturn ? (
                                  <div
                                    className="rounded-2xl border p-4 space-y-4"
                                    style={{ borderColor: 'var(--color-border)' }}
                                  >
                                    <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
                                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                        <span><span className="text-[var(--color-muted)]">Đã xuất</span> <span className="font-semibold">{formatNumber(detail!.confirmedSerials.length > 0 ? detail!.confirmedSerials.length : detail!.actualQtyTotal)}</span></span>
                                        <span><span className="text-[var(--color-muted)]">Đề nghị trả</span> <span className="font-semibold">{formatNumber(returnRequest.requestedQtyTotal)}</span></span>
                                      </div>
                                      <div className="text-sm text-[var(--color-muted)]">
                                        Đề nghị trả hàng đã được gửi. Chờ Thủ kho chọn serial thực tế khi hàng về.
                                      </div>
                                    </div>
                                    <div
                                      className="rounded-2xl border px-4 py-3 text-sm"
                                      style={{
                                        borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                        backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                        color: 'var(--color-primary)',
                                      }}
                                    >
                                      {returnRequest.status === 'PENDING'
                                        ? 'Đề nghị trả hàng đang chờ Thủ kho xử lý.'
                                        : 'Đề nghị trả hàng gần nhất đã được Thủ kho xử lý.'}
                                    </div>
                                    <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
                                      <div className="text-sm font-semibold">Chi tiết đề nghị</div>
                                      <div className="mt-2 text-sm text-[var(--color-muted)]">
                                        KTBH chỉ gửi tổng số cần trả. Thủ kho có thể scan bất kỳ serial đã xuất nào; hệ thống sẽ tự xác định đúng đoạn theo serial thực tế, kể cả dòng thay thế.
                                      </div>
                                      <div className="mt-3 rounded-xl border px-3 py-3" style={{ borderColor: 'var(--color-border)' }}>
                                        <div className="font-medium">Tổng đề nghị trả</div>
                                        <div className="mt-1 text-sm text-[var(--color-muted)]">
                                          {formatNumber(returnRequest.requestedQtyTotal)} đoạn
                                        </div>
                                      </div>
                                    </div>
                                    {returnRequest.note ? (
                                      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
                                        <div className="text-sm font-semibold">Ghi chú đề nghị trả hàng</div>
                                        <div className="mt-2 text-sm text-[var(--color-muted)]">{returnRequest.note}</div>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}

                                {returnPanelOpen && canProcessReturn ? (
                                  <div
                                    className={detailPage ? 'space-y-4' : 'rounded-2xl border p-4 space-y-4'}
                                    style={detailPage ? undefined : { borderColor: 'var(--color-border)' }}
                                  >
                                    <div className={detailPage ? 'hidden' : 'flex flex-wrap items-start justify-between gap-3'}>
                                      <div>
                                        <div className="text-base font-semibold">Thủ kho xác nhận hàng trả lại</div>
                                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-muted)]">
                                          <span>Đã xuất: {formatNumber(confirmedSerials.length)}</span>
                                          {returnRequest ? (
                                            <span>Đề nghị trả: {formatNumber(returnRequest.requestedQtyTotal)}</span>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>

                                    {returnRequest?.status === 'PENDING' ? (
                                      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
                                        <div className="grid grid-cols-2 rounded-2xl p-1" style={{ backgroundColor: 'color-mix(in srgb, white 90%, var(--color-primary) 4%)' }}>
                                          <button
                                            type="button"
                                            onClick={() => setReturnInputMode('SELECT')}
                                            className={`rounded-xl px-4 py-2 text-sm font-semibold ${returnInputMode === 'SELECT' ? 'app-primary text-white' : ''}`}
                                          >
                                            Danh sách
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setReturnInputMode('SCAN')}
                                            className={`rounded-xl px-4 py-2 text-sm font-semibold ${returnInputMode === 'SCAN' ? 'app-primary text-white' : ''}`}
                                          >
                                            Scan
                                          </button>
                                        </div>
                                      </div>
                                    ) : returnRequest ? (
                                      detailPage ? null : (
                                        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
                                          <>
                                            <div className="text-sm font-semibold">Đề nghị trả hàng đã được xử lý</div>
                                            <div className="mt-2 text-sm text-[var(--color-muted)]">
                                              Phiếu này đã có đề nghị trả từ KTBH và Thủ kho đã xác nhận xong.
                                            </div>
                                            <div className="mt-3 rounded-xl border px-3 py-3" style={{ borderColor: 'var(--color-border)' }}>
                                              <div className="font-medium">Tổng đề nghị trả</div>
                                              <div className="mt-1 text-sm text-[var(--color-muted)]">
                                                {formatNumber(returnRequest.requestedQtyTotal)} đoạn
                                              </div>
                                            </div>
                                          </>
                                        </div>
                                      )
                                    ) : (
                                      <div className="rounded-2xl border px-4 py-3 text-sm text-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)' }}>
                                        {returnedSerials.length > 0
                                          ? 'Phiếu này đã có serial trả hàng được kho xử lý trực tiếp, nhưng không có đề nghị trả hàng từ KTBH.'
                                          : 'Chưa có đề nghị trả hàng nào từ KTBH cho phiếu này.'}
                                      </div>
                                    )}

                                    {returnRequest?.status === 'PENDING' ? (
                                      <>
                                        {returnInputMode === 'SELECT' ? (
                                          <div className="space-y-4">
                                            <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--color-border)' }}>
                                              <table className="min-w-full text-left text-sm">
                                                <thead>
                                                  <tr style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 5%, white)' }}>
                                                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Serial</th>
                                                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Hướng xử lý</th>
                                                    <th className="px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase">Ghi chú</th>
                                                    <th className="w-24 px-4 py-3 text-xs font-semibold tracking-[0.14em] uppercase text-center">Xóa</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {returnDraftRows.map((row) => {
                                                    const pickedSerialIds = new Set(
                                                      returnDraftRows
                                                        .filter((item) => item.id !== row.id)
                                                        .map((item) => item.serialId)
                                                        .filter(Boolean)
                                                    )
                                                    const returnedSerialIds = new Set(returnedSerials.map((item) => item.serialId))
                                                    const availableSerialOptions = confirmedSerials.filter(
                                                      (item) =>
                                                        (!returnedSerialIds.has(item.serialId) || item.serialId === row.serialId) &&
                                                        (!pickedSerialIds.has(item.serialId) || item.serialId === row.serialId)
                                                    )
                                                    return (
                                                      <tr key={row.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                                                        <td className="px-4 py-3">
                                                          <select
                                                            value={row.serialId}
                                                            onChange={(event) =>
                                                              setReturnDraftRows((current) =>
                                                                current.map((item) =>
                                                                  item.id === row.id ? { ...item, serialId: event.target.value } : item
                                                                )
                                                              )
                                                            }
                                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                          >
                                                            <option value="">Chọn serial đã xuất</option>
                                                            {availableSerialOptions.map((item) => (
                                                              <option key={item.serialId} value={item.serialId}>
                                                                {item.serialCode}
                                                              </option>
                                                            ))}
                                                          </select>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                          <select
                                                            value={row.resolutionStatus}
                                                            onChange={(event) =>
                                                              setReturnDraftRows((current) =>
                                                                current.map((item) =>
                                                                  item.id === row.id
                                                                    ? {
                                                                        ...item,
                                                                        resolutionStatus: (event.target.value === 'NHAP_KHACH_LE'
                                                                          ? 'NHAP_KHACH_LE'
                                                                          : event.target.value === 'HUY'
                                                                            ? 'HUY'
                                                                            : event.target.value === 'NHAP_DU_AN'
                                                                              ? 'NHAP_DU_AN'
                                                                              : '') as ShipmentReturnDraftRow['resolutionStatus'],
                                                                      }
                                                                    : item
                                                                )
                                                              )
                                                            }
                                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                          >
                                                            <option value="">Chọn hướng xử lý</option>
                                                            <option value="NHAP_DU_AN">Nhập về cho dự án</option>
                                                            <option value="NHAP_KHACH_LE">Nhập về khách lẻ</option>
                                                            <option value="HUY">Hủy bỏ</option>
                                                          </select>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                          <input
                                                            value={row.note}
                                                            onChange={(event) =>
                                                              setReturnDraftRows((current) =>
                                                                current.map((item) =>
                                                                  item.id === row.id ? { ...item, note: event.target.value } : item
                                                                )
                                                              )
                                                            }
                                                            className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                            placeholder="Ghi chú nếu cần"
                                                          />
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                          <button
                                                            type="button"
                                                            onClick={() => removeReturnDraftRow(row.id)}
                                                            className="app-outline rounded-xl px-3 py-1 text-sm font-semibold"
                                                          >
                                                            ×
                                                          </button>
                                                        </td>
                                                      </tr>
                                                    )
                                                  })}
                                                  {returnDraftRows.length === 0 ? (
                                                    <tr>
                                                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">
                                                        Chưa có serial trả lại mới.
                                                      </td>
                                                    </tr>
                                                  ) : null}
                                                </tbody>
                                              </table>
                                            </div>
                                            <div className="flex justify-end">
                                              <button
                                                type="button"
                                                onClick={addReturnDraftRow}
                                                disabled={!returnRequest || returnRequest.status !== 'PENDING'}
                                                className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                                aria-label="Thêm serial trả lại"
                                                title="Thêm serial trả lại"
                                              >
                                                +
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)' }}>
                                              <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                  <div className="text-sm font-semibold">Quét QR hàng trả lại</div>
                                                  <div className="mt-1 text-sm text-[var(--color-muted)]">
                                                    Có thể quét live, dán mã hoặc chọn ảnh QR để thêm serial hàng trả lại.
                                                  </div>
                                                </div>
                                                <button
                                                  type="button"
                                                  onClick={() => (returnScannerOpen ? stopReturnScanner() : void startReturnScanner())}
                                                  disabled={returnScannerStarting || returnImageScanPending}
                                                  className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                                >
                                                  {returnScannerOpen ? 'Tắt camera' : returnScannerStarting ? 'Đang bật camera...' : 'Bật camera quét QR'}
                                                </button>
                                              </div>
                                              <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                                                <div className="space-y-2">
                                                  <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: '#0f172a' }}>
                                                    <video
                                                      ref={returnVideoRef}
                                                      className="h-[260px] w-full object-cover"
                                                      muted
                                                      playsInline
                                                      autoPlay
                                                      onLoadedData={() => {
                                                        setReturnCameraReady(true)
                                                        if (returnReadyTimeoutRef.current != null) {
                                                          clearTimeout(returnReadyTimeoutRef.current)
                                                          returnReadyTimeoutRef.current = null
                                                        }
                                                      }}
                                                    />
                                                  </div>
                                                  <div className="rounded-2xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                                    Trạng thái camera: {returnCameraReady ? 'Đã lên hình' : returnScannerOpen ? 'Đang chờ camera' : 'Chưa bật'}
                                                  </div>
                                                </div>
                                                <div className="space-y-3">
                                                  <div className="rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                                                    Đưa QR vào giữa khung. Scan trúng serial nào thì hệ thống tự thêm vào danh sách trả lại.
                                                  </div>
                                                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                                                    <input
                                                      value={returnManualScanValue}
                                                      onChange={(event) => setReturnManualScanValue(event.target.value)}
                                                      className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                      placeholder="Dán serial_code hoặc nội dung QR để thêm trả lại nhanh"
                                                    />
                                                    <div className="flex flex-wrap gap-2">
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          upsertReturnedSerialByCode(returnManualScanValue)
                                                          setReturnManualScanValue('')
                                                        }}
                                                        className="app-outline rounded-xl px-4 py-2 text-sm font-semibold"
                                                      >
                                                        Thêm từ mã
                                                      </button>
                                                      <label className="app-outline rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer">
                                                        {returnImageScanPending ? 'Đang đọc ảnh...' : 'Chọn ảnh QR'}
                                                        <input
                                                          type="file"
                                                          accept="image/*"
                                                          className="hidden"
                                                          disabled={returnImageScanPending}
                                                          onChange={(event) => {
                                                            const file = event.target.files?.[0]
                                                            if (file) {
                                                              void scanReturnedImageFile(file)
                                                            }
                                                            event.currentTarget.value = ''
                                                          }}
                                                        />
                                                      </label>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                            {returnScanError ? (
                                              <div className="app-accent-soft rounded-2xl px-4 py-3 text-sm">{returnScanError}</div>
                                            ) : null}
                                            {returnScanInfo ? (
                                              <div
                                                className="rounded-2xl border px-4 py-3 text-sm"
                                                style={{
                                                  borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                                  backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                                  color: 'var(--color-primary)',
                                                }}
                                              >
                                                {returnScanInfo}
                                              </div>
                                            ) : null}
                                          </>
                                        )}

                                        <div className="flex flex-wrap items-end gap-3">
                                          <div className="min-w-[280px] flex-1">
                                            <Field label="Ghi chú kho khi nhận hàng trả lại">
                                              <input
                                                value={returnNote}
                                                onChange={(event) => setReturnNote(event.target.value)}
                                                className="app-input w-full rounded-xl px-3 py-2 text-sm"
                                                placeholder="Ghi chú nếu serial thực tế khác đề nghị"
                                              />
                                            </Field>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => void submitReturnedSerials()}
                                            disabled={pending || !returnDraftRows.length}
                                            className="app-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                                          >
                                            {pending ? 'Đang xử lý...' : 'Thủ kho xác nhận hàng trả lại'}
                                          </button>
                                        </div>
                                      </>
                                    ) : null}

                                    {returnedSerials.length ? (
                                      <div className={detailPage ? 'border-t pt-3' : 'rounded-2xl border p-4'} style={{ borderColor: 'var(--color-border)' }}>
                                        <div className="text-sm font-semibold">Serial đã xử lý trả lại</div>
                                        <div className={`${detailPage ? 'mt-2' : 'mt-3'} flex flex-wrap gap-2`}>
                                          {returnedSerials.map((item) => (
                                            <span
                                              key={item.returnSerialId || `${item.serialId}-${item.resolutionStatus}`}
                                              className="rounded-full border px-3 py-1 text-xs font-medium"
                                              style={{ borderColor: 'var(--color-border)' }}
                                            >
                                              {item.serialCode} · {formatReturnResolutionLabel(item.resolutionStatus)}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {detail?.locked && !detailPage ? (
                              <div
                                className="rounded-2xl border px-4 py-3 text-sm"
                                style={{
                                  borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
                                  backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)',
                                  color: 'var(--color-primary)',
                                }}
                              >
                                Phiếu xuất hàng này đã được xác nhận, hiện chỉ còn xem.
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
              {visibleVoucherRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-muted)]">
                    Chưa có phiếu xuất hàng nào.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>

        {!detailPage && voucherPageCount > 1 ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setVoucherPage((current) => Math.max(current - 1, 1))}
              disabled={voucherPage <= 1}
              className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Trang trước
            </button>
            <button
              type="button"
              onClick={() => setVoucherPage((current) => Math.min(current + 1, voucherPageCount))}
              disabled={voucherPage >= voucherPageCount}
              className="app-outline rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              Trang sau
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-muted)]">Đi tới trang</span>
              <input
                type="number"
                min={1}
                max={voucherPageCount}
                value={voucherPageInput}
                onChange={(event) => setVoucherPageInput(event.target.value)}
                onBlur={() => {
                  const nextPage = Math.min(Math.max(Number(voucherPageInput || voucherPage), 1), voucherPageCount)
                  setVoucherPage(nextPage)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const nextPage = Math.min(Math.max(Number(voucherPageInput || voucherPage), 1), voucherPageCount)
                    setVoucherPage(nextPage)
                  }
                }}
                className="app-input w-20 rounded-xl px-3 py-2 text-center text-sm"
              />
            </div>
          </div>
        ) : null}
          </div>
        ) : null}
      </section>

      {message ? (
        <div
          className="fixed bottom-5 right-5 z-[60] max-w-md rounded-2xl border px-4 py-3 text-sm shadow-lg"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-primary) 24%, white)',
            backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)',
            color: 'var(--color-primary)',
          }}
        >
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="fixed bottom-5 right-5 z-[61] max-w-md rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeCode(value: string) {
  return String(value || '').trim().toUpperCase()
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0))
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatStatusLabel(status: XuatHangStatus) {
  if (status === 'CHO_XAC_NHAN') return 'Chờ Thủ kho xác nhận'
  if (status === 'DA_XUAT') return 'Đã xuất'
  if (status === 'XUAT_MOT_PHAN') return 'Xuất một phần'
  return status
}

function ScanQrIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="7" y="7" width="3" height="3" rx="0.4" />
      <rect x="14" y="7" width="3" height="3" rx="0.4" />
      <rect x="7" y="14" width="3" height="3" rx="0.4" />
      <path d="M14 14h1v1h-1zM16 15h1v1h-1zM15 16h1v1h-1zM14 17h1v1h-1zM17 17h1v1h-1z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function formatCompactStatusLabel(status: XuatHangStatus) {
  if (status === 'CHO_XAC_NHAN') return 'Chờ xác nhận'
  return formatStatusLabel(status)
}

function formatReturnResolutionLabel(status: 'NHAP_DU_AN' | 'NHAP_KHACH_LE' | 'HUY') {
  if (status === 'NHAP_DU_AN') return 'Nhập về cho dự án'
  if (status === 'NHAP_KHACH_LE') return 'Nhập về khách lẻ'
  return 'Hủy bỏ'
}

function formatMonthLabel(value: string) {
  const [year, month] = String(value || '').split('-')
  if (!year || !month) return value
  return `Tháng ${month}/${year}`
}

function buildVoucherListItemFromDetail(detail: XuatHangVoucherDetail): XuatHangPageData['vouchers'][number] {
  const nowIso = new Date().toISOString()
  return {
    voucherId: detail.voucherId,
    maPhieu: detail.maPhieu,
    sourceType: detail.sourceType,
    status: detail.status,
    customerName: detail.customerName,
    projectName: detail.projectName,
    orderLabel: detail.orderLabel,
    requestedQtyTotal: detail.requestedQtyTotal,
    actualQtyTotal: detail.actualQtyTotal,
    operationDate: null,
    createdAt: nowIso,
    detail,
  }
}

function formatMonthShortLabel(value: string) {
  const [year, month] = String(value || '').split('-')
  if (!year || !month) return value
  return `${month}/${year}`
}

function isSubstitutedShipmentLine(line: {
  isSubstituted?: boolean
  originalItemLabel?: string | null
  itemLabel: string
}) {
  if (line.isSubstituted) return true
  const original = String(line.originalItemLabel || '').trim()
  return Boolean(original && original !== String(line.itemLabel || '').trim())
}

function formatShipmentLineMeta(line: {
  itemLabel: string
  originalItemLabel?: string | null
  substitutionReason?: string | null
  isSubstituted?: boolean
  sourceType?: XuatHangSourceMode
}) {
  const originalLabel = String(line.originalItemLabel || line.itemLabel || '').trim()
  if (!originalLabel) return null
  if (line.sourceType !== 'DON_HANG' && !isSubstitutedShipmentLine(line)) return null
  const substituted = isSubstitutedShipmentLine(line)
  const parts = [substituted ? `Thay thế cho: ${originalLabel}` : `Theo đơn: ${originalLabel}`]
  if (substituted && line.substitutionReason) {
    parts.push(`Lý do: ${String(line.substitutionReason).trim()}`)
  }
  return parts.join(' · ')
}

function Field(props: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={['space-y-2 block', props.className].filter(Boolean).join(' ')}>
      <span className="text-sm font-semibold">{props.label}</span>
      {props.children}
    </label>
  )
}

function Info(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="text-sm text-[var(--color-muted)]">{props.label}</div>
      <div className="mt-1 font-semibold">{props.value}</div>
    </div>
  )
}

function ShipmentAvailabilityCell(props: {
  availableQty: number
  reservedQty: number
  reservedByVouchers: Array<{
    voucherId: string
    maPhieu: string
    requestedQty: number
    customerName: string | null
    projectName: string | null
    createdAt: string
  }>
}) {
  if (!props.reservedQty || props.reservedByVouchers.length === 0) {
    return <span className="font-semibold">{formatNumber(props.availableQty)}</span>
  }

  return (
    <div className="flex justify-end">
      <div className="group relative inline-flex items-center gap-2">
        <span className="font-semibold">{formatNumber(props.availableQty)}</span>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold"
          style={{ borderColor: 'var(--color-border)' }}
          aria-label="Xem phiếu xuất đang giữ chỗ"
          title="Xem phiếu xuất đang giữ chỗ"
        >
          i
        </button>
        <div
          className="absolute right-0 top-full z-20 mt-2 hidden w-80 rounded-2xl border bg-white p-3 text-left shadow-xl group-hover:block group-focus-within:block"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="text-sm font-semibold">Đang chờ : {formatNumber(props.reservedQty)}</div>
          <div className="mt-3 space-y-2">
            {props.reservedByVouchers.map((item) => (
              <Link
                key={`${item.voucherId}-${item.maPhieu}`}
                href={`/don-hang/phieu-xuat/${item.voucherId}`}
                prefetch={false}
                className="block rounded-xl border px-3 py-2 transition hover:bg-black/[0.03]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                      {item.maPhieu}
                    </div>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {[item.customerName, item.projectName].filter(Boolean).join(' · ') || 'Phiếu xuất chờ kho xác nhận'}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold">{formatNumber(item.requestedQty)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

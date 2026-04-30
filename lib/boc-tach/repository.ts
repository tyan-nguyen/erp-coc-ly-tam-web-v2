import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdminRole, isCommercialRole, isQlsxRole } from '@/lib/auth/roles'
import { writeAuditLog } from '@/lib/audit-log/write'
import { computeBocTachPreview, sanitizeItems, sanitizeSegments } from '@/lib/boc-tach/calc'
import type {
  AuxiliaryMaterialReference,
  BocTachDetailPayload,
  BocTachReferenceData,
  ConcreteMixReference,
  CustomerReference,
  HeaderStatus,
  PileTemplateReference,
  ProjectReference,
} from '@/lib/boc-tach/types'

type AnySupabase = SupabaseClient

const HEADER_ID_CANDIDATES = ['boc_id', 'boc_tach_id', 'id']
const CHILD_PARENT_CANDIDATES = ['boc_id', 'boc_tach_id', 'boc_tach_nvl_id']
const TEMPLATE_META_PREFIX = 'ERP_TEMPLATE_META::'
const BOC_META_PREFIX = 'ERP_BOC_META::'
const ADDRESS_NOTE_PREFIX = '[VI_TRI_CONG_TRINH]:'
const AREA_NOTE_PREFIX = '[KHU_VUC]:'
const TEMPLATE_CANDIDATE_COLUMNS = {
  code: ['ma_coc', 'ma_coc_template'],
  steelGrade: ['mac_thep'],
  cuongDo: ['cuong_do'],
  pcNvlId: ['pc_nvl_id', 'thep_pc_nvl_id'],
  daiNvlId: ['dai_nvl_id', 'thep_dai_nvl_id'],
  buocNvlId: ['buoc_nvl_id', 'thep_buoc_nvl_id'],
  matBichNvlId: ['mat_bich_nvl_id'],
  mangXongNvlId: ['mang_xong_nvl_id'],
  tapNvlId: ['tap_nvl_id', 'tap_vuong_nvl_id'],
  muiCocNvlId: ['mui_coc_nvl_id'],
  pcLabel: ['thep_pc', 'pc_label'],
  daiLabel: ['thep_dai', 'dai_label'],
  buocLabel: ['thep_buoc', 'buoc_label'],
  matBichLabel: ['mat_bich', 'mat_bich_label'],
  mangXongLabel: ['mang_xong', 'mang_xong_label'],
  tapLabel: ['tap_vuong', 'tap_label'],
  muiCocLabel: ['mui_coc', 'mui_coc_label'],
  kgMd: ['khoi_luong_kg_md', 'kg_md', 'trong_luong_kg_md'],
} as const

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Unknown error'
}

function readStringCandidate(
  row: Record<string, unknown>,
  candidates: string[],
  fallback = ''
): string {
  for (const key of candidates) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return fallback
}

function parseTemplateMeta(row: Record<string, unknown>) {
  const raw = String(row.ghi_chu || '').trim()
  const markerIndex = raw.indexOf(TEMPLATE_META_PREFIX)
  if (markerIndex < 0) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw.slice(markerIndex + TEMPLATE_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

function parseBocMeta(row: Record<string, unknown>) {
  const raw = String(row.ghi_chu || '').trim()
  if (!raw.startsWith(BOC_META_PREFIX)) return {} as Record<string, unknown>
  try {
    return JSON.parse(raw.slice(BOC_META_PREFIX.length)) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

function buildStoredBocNote(note: string | null, meta: Record<string, unknown>) {
  return `${BOC_META_PREFIX}${JSON.stringify({
    ...meta,
    note: note ?? '',
  })}`
}

function cleanProjectLocationText(value: string | null | undefined) {
  return String(value || '')
    .replaceAll(ADDRESS_NOTE_PREFIX, '')
    .replaceAll(AREA_NOTE_PREFIX, '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*([^,]+),\s*\1$/u, ', $1')
    .trim()
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function isMissingRelationError(message?: string) {
  return /relation .* does not exist/i.test(String(message ?? '')) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(String(message ?? ''))
}

function resolveSteelKindForItem(
  item: BocTachDetailPayload['items'][number],
  materials: BocTachReferenceData['materials']
) {
  if (item.loai_nvl !== 'THEP') return null
  const normalizedName = normalizeText(item.ten_nvl)
  if (normalizedName.includes('PC')) return 'pc'
  if (normalizedName.includes('DAI')) return 'dai'
  if (normalizedName.includes('BUOC')) return 'buoc'
  if (!String(item.nvl_id || '').trim()) return null
  const material = materials.find((row) => row.nvl_id === item.nvl_id)
  if (!material) return null
  const normalizedMaterialName = normalizeText(material.ten_hang)
  if (normalizedMaterialName.includes('PC')) return 'pc'
  if (normalizedMaterialName.includes('DAI')) return 'dai'
  if (normalizedMaterialName.includes('BUOC')) return 'buoc'
  return null
}

function pickSteelItemByKind(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'pc' | 'dai' | 'buoc'
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!String(item.nvl_id || '').trim()) continue
    if (resolveSteelKindForItem(item, materials) === kind) {
      return item
    }
  }
  return null
}

function resolveItemLabel(
  item:
    | BocTachDetailPayload['items'][number]
    | BocTachReferenceData['materials'][number]
    | null,
  materials: BocTachReferenceData['materials']
) {
  if (!item) return ''
  const label = String('ten_nvl' in item ? item.ten_nvl : item.ten_hang || '').trim()
  if (label) return label
  const material = materials.find((row) => row.nvl_id === item.nvl_id)
  return String(material?.ten_hang || '').trim()
}

function pickAccessoryItemByKind(
  items: BocTachDetailPayload['items'],
  materials: BocTachReferenceData['materials'],
  kind: 'mat_bich' | 'mang_xong' | 'mui_coc' | 'tap'
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!String(item.nvl_id || '').trim()) continue
    if (resolveAccessoryKindForItem(item, materials) === kind) {
      return item
    }
  }
  return null
}

function readTemplateStringCandidate(
  row: Record<string, unknown>,
  meta: Record<string, unknown>,
  candidates: string[],
  fallback = ''
) {
  for (const key of candidates) {
    const direct = String(row[key] ?? '').trim()
    if (direct) return direct
    const fromMeta = String(meta[key] ?? '').trim()
    if (fromMeta) return fromMeta
  }
  return fallback
}

function readTemplateNumberCandidate(
  row: Record<string, unknown>,
  meta: Record<string, unknown>,
  candidates: string[]
): number | undefined {
  for (const key of candidates) {
    const direct = Number(row[key])
    if (Number.isFinite(direct) && direct !== 0) return direct
    if (row[key] === 0) return 0

    const fromMeta = Number(meta[key])
    if (Number.isFinite(fromMeta) && fromMeta !== 0) return fromMeta
    if (meta[key] === 0) return 0
  }
  return undefined
}

function parseUnknownColumn(message: string) {
  const relationMatch = message.match(/column ["']?([a-zA-Z0-9_]+)["']? of relation .* does not exist/i)
  if (relationMatch?.[1]) return relationMatch[1]
  const schemaCacheMatch = message.match(
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column of ['"][a-zA-Z0-9_]+['"] in the schema cache/i
  )
  return schemaCacheMatch?.[1] ?? ''
}

function normalizeTemplateText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function normalizeSignatureNumber(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? String(numeric) : '0'
}

function normalizeSignatureRef(idValue: unknown, labelValue: unknown) {
  const id = String(idValue ?? '').trim()
  if (id) return `ID:${id}`
  const label = normalizeTemplateText(String(labelValue ?? ''))
  return label ? `LABEL:${label}` : ''
}

function buildExistingTemplateSignature(merged: Record<string, unknown>) {
  return [
    normalizeTemplateText(String(merged.loai_coc ?? '')),
    normalizeSignatureNumber(merged.mac_be_tong),
    normalizeSignatureNumber(merged.do_ngoai),
    normalizeSignatureNumber(merged.chieu_day),
    normalizeSignatureNumber(merged.pc_dia_mm),
    normalizeSignatureNumber(merged.pc_nos),
    normalizeSignatureNumber(merged.dai_dia_mm),
    normalizeSignatureNumber(merged.buoc_dia_mm),
    normalizeSignatureNumber(merged.dtam_mm),
    normalizeSignatureNumber(merged.a1_mm),
    normalizeSignatureNumber(merged.a2_mm),
    normalizeSignatureNumber(merged.a3_mm),
    normalizeSignatureNumber(merged.p1_pct),
    normalizeSignatureNumber(merged.p2_pct),
    normalizeSignatureNumber(merged.p3_pct),
    normalizeSignatureNumber(merged.don_kep_factor),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.pcNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.pcLabel)
    ),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.daiNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.daiLabel)
    ),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.buocNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.buocLabel)
    ),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.matBichNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.matBichLabel)
    ),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.mangXongNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.mangXongLabel)
    ),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.tapNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.tapLabel)
    ),
    normalizeSignatureRef(
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.muiCocNvlId),
      readCandidateValue(merged, TEMPLATE_CANDIDATE_COLUMNS.muiCocLabel)
    ),
  ].join('__')
}

function buildDraftTemplateSignature(
  payload: BocTachDetailPayload,
  rowMeta: Record<string, unknown>,
  loaiCoc: string,
  macBeTong: string,
  doNgoai: number,
  chieuDay: number
) {
  return [
    normalizeTemplateText(loaiCoc),
    normalizeSignatureNumber(macBeTong),
    normalizeSignatureNumber(doNgoai),
    normalizeSignatureNumber(chieuDay),
    normalizeSignatureNumber(payload.header.pc_dia_mm),
    normalizeSignatureNumber(rowMeta.pc_nos),
    normalizeSignatureNumber(payload.header.dai_dia_mm),
    normalizeSignatureNumber(payload.header.buoc_dia_mm),
    normalizeSignatureNumber(rowMeta.dtam_mm),
    normalizeSignatureNumber(rowMeta.a1_mm),
    normalizeSignatureNumber(rowMeta.a2_mm),
    normalizeSignatureNumber(rowMeta.a3_mm),
    normalizeSignatureNumber(rowMeta.p1_pct),
    normalizeSignatureNumber(rowMeta.p2_pct),
    normalizeSignatureNumber(rowMeta.p3_pct),
    normalizeSignatureNumber(rowMeta.don_kep_factor),
    normalizeSignatureRef(rowMeta.pc_nvl_id, rowMeta.pc_label),
    normalizeSignatureRef(rowMeta.dai_nvl_id, rowMeta.dai_label),
    normalizeSignatureRef(rowMeta.buoc_nvl_id, rowMeta.buoc_label),
    normalizeSignatureRef(rowMeta.mat_bich_nvl_id, rowMeta.mat_bich_label),
    normalizeSignatureRef(rowMeta.mang_xong_nvl_id, rowMeta.mang_xong_label),
    normalizeSignatureRef(rowMeta.tap_nvl_id, rowMeta.tap_label),
    normalizeSignatureRef(rowMeta.mui_coc_nvl_id, rowMeta.mui_coc_label),
  ].join('__')
}

function accessoryKindFromName(value: string | null | undefined) {
  const normalized = normalizeTemplateText(value)
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
  if (!String(item.nvl_id || '').trim()) return null
  const material = materials.find((row) => row.nvl_id === item.nvl_id)
  return material ? accessoryKindFromName(material.ten_hang) : null
}

function extractSteelGradeFromPileType(value: string | null | undefined) {
  const normalized = normalizeTemplateText(value)
  const match = normalized.match(/-\s*([ABC])\d+/)
  return match?.[1] ?? ''
}

function extractTemplateSteelGrade(row: Record<string, unknown>) {
  const meta = parseTemplateMeta(row)
  const explicit = normalizeTemplateText(row.mac_thep || meta.mac_thep)
  const direct = explicit.match(/^([ABC])/)
  if (direct?.[1]) return direct[1]
  return extractSteelGradeFromPileType(String(row.loai_coc || meta.loai_coc || ''))
}

function extractTemplateDiameter(row: Record<string, unknown>) {
  const meta = parseTemplateMeta(row)
  const explicit = normalizeTemplateText(row.do_ngoai || meta.do_ngoai)
  if (explicit) return explicit
  const match = normalizeTemplateText(row.loai_coc || meta.loai_coc).match(/[ABC](\d+)/)
  return match?.[1] || ''
}

function extractTemplateThickness(row: Record<string, unknown>) {
  const meta = parseTemplateMeta(row)
  const explicit = normalizeTemplateText(row.chieu_day || meta.chieu_day)
  if (explicit) return explicit
  const match = normalizeTemplateText(row.loai_coc || meta.loai_coc).match(/-\s*[ABC]\d+\s*-\s*(\d+(?:\.\d+)?)/)
  return match?.[1] || ''
}

function extractCuongDoFromPileType(value: string | null | undefined) {
  const normalized = normalizeTemplateText(value)
  if (normalized.startsWith('PHC')) return 'PHC'
  if (normalized.startsWith('PC')) return 'PC'
  return ''
}

function buildLoaiCoc(cuongDo: string, steelGrade: string, doNgoai: number, chieuDay: number) {
  return `${cuongDo} - ${steelGrade}${doNgoai} - ${chieuDay}`
}

function buildCodePrefix(macBeTong: string, steelGrade: string, doNgoai: number, chieuDay: number) {
  return `M${macBeTong} - ${steelGrade}${doNgoai} - ${chieuDay}`
}

function isCanonicalTemplateCode(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  return /^M\d+(?:\.\d+)?\s*-\s*[ABC]\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:\s*-\s*\d+)?$/.test(normalized)
}

function resolveTemplateDisplayCode(row: Record<string, unknown>) {
  const meta = parseTemplateMeta(row)
  for (const field of ['ma_coc', 'ma_coc_template', 'ma_template']) {
    const value = readTemplateStringCandidate(row, meta, [field])
    if (isCanonicalTemplateCode(value)) return value
  }
  const macBeTong = normalizeTemplateText(row.mac_be_tong || meta.mac_be_tong).replace(/^M/, '')
  const steelGrade = extractTemplateSteelGrade(row)
  const diameter = extractTemplateDiameter(row)
  const thickness = extractTemplateThickness(row)
  if (!macBeTong || !steelGrade || !diameter || !thickness) return '-'
  return `M${macBeTong} - ${steelGrade}${diameter} - ${thickness}`
}

function buildTemplateCodeMap(rows: Array<Record<string, unknown>>) {
  const sorted = [...rows].sort((a, b) => {
    const aTime = new Date(String(a.created_at ?? a.updated_at ?? '')).getTime() || 0
    const bTime = new Date(String(b.created_at ?? b.updated_at ?? '')).getTime() || 0
    if (aTime !== bTime) return aTime - bTime
    return normalizeText(a.template_id || a.id).localeCompare(normalizeText(b.template_id || b.id), 'vi')
  })

  const prefixCount = new Map<string, number>()
  const codeByTemplateId = new Map<string, string>()

  for (const row of sorted) {
    const templateId = readStringCandidate(row, ['template_id', 'id'])
    if (!templateId) continue

    const explicitCode = resolveTemplateDisplayCode(row)
    const macBeTong = normalizeTemplateText(row.mac_be_tong || parseTemplateMeta(row).mac_be_tong).replace(/^M/, '')
    const steelGrade = extractTemplateSteelGrade(row)
    const diameter = extractTemplateDiameter(row)
    const thickness = extractTemplateThickness(row)
    const prefix =
      macBeTong && steelGrade && diameter && thickness ? `M${macBeTong} - ${steelGrade}${diameter} - ${thickness}` : ''

    if (!prefix) {
      codeByTemplateId.set(templateId, explicitCode)
      continue
    }

    const next = (prefixCount.get(prefix) ?? 0) + 1
    prefixCount.set(prefix, next)
    codeByTemplateId.set(templateId, explicitCode.startsWith(`${prefix} - `) ? explicitCode : `${prefix} - ${next}`)
  }

  return codeByTemplateId
}

function parseMaterialDiameter(value: string | null | undefined) {
  const normalized = normalizeTemplateText(value)
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function findSteelMaterialByDiameter(
  materials: BocTachReferenceData['materials'],
  kind: 'pc' | 'dai' | 'buoc',
  diameter: number | null | undefined
) {
  const target = Number(diameter || 0)
  if (!Number.isFinite(target) || target <= 0) return null
  const token = kind === 'pc' ? 'PC' : kind === 'dai' ? 'DAI' : 'BUOC'
  return (
    materials.find((item) => {
      const normalizedName = normalizeTemplateText(item.ten_hang)
      const normalizedGroup = normalizeTemplateText(item.nhom_hang || '')
      return (
        normalizedGroup === 'THEP' &&
        normalizedName.includes(token) &&
        parseMaterialDiameter(item.ten_hang) === target
      )
    }) || null
  )
}

function buildStoredNote(note: string | null, metadata: Record<string, unknown>) {
  return `${TEMPLATE_META_PREFIX}${JSON.stringify({
    ...metadata,
    note: note ?? '',
  })}`
}

function resolveTemplateScope(
  row: Record<string, unknown>,
  meta: Record<string, unknown>
): 'FACTORY' | 'CUSTOM' {
  const direct = String(row.template_scope ?? row.template_kind ?? '').trim().toUpperCase()
  if (direct === 'CUSTOM') return 'CUSTOM'
  if (direct === 'FACTORY') return 'FACTORY'

  const fromMeta = String(meta.template_scope ?? meta.template_kind ?? '').trim().toUpperCase()
  if (fromMeta === 'CUSTOM') return 'CUSTOM'
  if (fromMeta === 'FACTORY') return 'FACTORY'

  return 'FACTORY'
}

function readCandidateValue(row: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const value = String(row[field] ?? '').trim()
    if (value) return value
  }
  return ''
}

async function executeTemplateInsertWithFallback(
  supabase: AnySupabase,
  payload: Record<string, unknown>
) {
  const working = { ...payload }
  while (true) {
    const attempt = await supabase.from('dm_coc_template').insert(working).select('*').maybeSingle()
    if (!attempt.error) return attempt

    if (attempt.error.message.includes(`'created_by'`)) {
      delete working.created_by
      continue
    }

    const missingColumn = parseUnknownColumn(attempt.error.message)
    if (missingColumn && missingColumn in working) {
      delete working[missingColumn]
      continue
    }

    return attempt
  }
}

async function executeTemplateUpdateWithFallback(
  supabase: AnySupabase,
  templateId: string,
  payload: Record<string, unknown>
) {
  const working = { ...payload }
  while (true) {
    const attempt = await supabase
      .from('dm_coc_template')
      .update(working)
      .eq('template_id', templateId)
      .select('*')
      .maybeSingle()
    if (!attempt.error) return attempt

    if (attempt.error.message.includes(`'updated_by'`)) {
      delete working.updated_by
      continue
    }

    const missingColumn = parseUnknownColumn(attempt.error.message)
    if (missingColumn && missingColumn in working) {
      delete working[missingColumn]
      continue
    }

    return attempt
  }
}

async function executeHeaderInsertWithFallback(
  supabase: AnySupabase,
  payload: Record<string, unknown>
) {
  const working = { ...payload }
  while (true) {
    const attempt = await supabase.from('boc_tach_nvl').insert(working).select('*').maybeSingle()
    if (!attempt.error) return attempt

    const missingColumn = parseUnknownColumn(attempt.error.message)
    if (missingColumn && missingColumn in working) {
      delete working[missingColumn]
      continue
    }

    return attempt
  }
}

async function executeHeaderUpdateWithFallback(
  supabase: AnySupabase,
  idField: string,
  idValue: string,
  payload: Record<string, unknown>
) {
  const working = { ...payload }
  while (true) {
    const attempt = await supabase
      .from('boc_tach_nvl')
      .update(working)
      .eq(idField, idValue)
      .select('*')
      .maybeSingle()

    if (!attempt.error) return attempt

    const missingColumn = parseUnknownColumn(attempt.error.message)
    if (missingColumn && missingColumn in working) {
      delete working[missingColumn]
      continue
    }

    return attempt
  }
}

async function executeChildInsertWithFallback(
  supabase: AnySupabase,
  tableName: 'boc_tach_nvl_items' | 'boc_tach_seg_nvl',
  rows: Array<Record<string, unknown>>
) {
  const working = rows.map((row) => ({ ...row }))
  while (true) {
    const attempt = await supabase.from(tableName).insert(working)
    if (!attempt.error) return attempt

    const missingColumn = parseUnknownColumn(attempt.error.message)
    if (missingColumn) {
      let removed = false
      for (const row of working) {
        if (missingColumn in row) {
          delete row[missingColumn]
          removed = true
        }
      }
      if (removed) continue
    }

    return attempt
  }
}

async function ensureTemplateForSend(
  supabase: AnySupabase,
  userId: string,
  payload: BocTachDetailPayload,
  materials: BocTachReferenceData['materials']
) {
  const cuongDo = extractCuongDoFromPileType(payload.header.loai_coc)
  const steelGrade = extractSteelGradeFromPileType(payload.header.loai_coc)
  const doNgoai = Number(payload.header.do_ngoai || 0)
  const chieuDay = Number(payload.header.chieu_day || 0)
  const macBeTong = String(payload.header.mac_be_tong || '').trim()
  if (!cuongDo || !steelGrade || doNgoai <= 0 || chieuDay <= 0 || !macBeTong) return null

  const loaiCoc = buildLoaiCoc(cuongDo, steelGrade, doNgoai, chieuDay)
  const firstSegment = payload.segments[0]
  const pcItem =
    pickSteelItemByKind(payload.items, materials, 'pc') ??
    findSteelMaterialByDiameter(materials, 'pc', payload.header.pc_dia_mm)
  const daiItem =
    pickSteelItemByKind(payload.items, materials, 'dai') ??
    findSteelMaterialByDiameter(materials, 'dai', payload.header.dai_dia_mm)
  const buocItem =
    pickSteelItemByKind(payload.items, materials, 'buoc') ??
    findSteelMaterialByDiameter(materials, 'buoc', payload.header.buoc_dia_mm)
  const matBichItem = pickAccessoryItemByKind(payload.items, materials, 'mat_bich')
  const mangXongItem = pickAccessoryItemByKind(payload.items, materials, 'mang_xong')
  const tapItem = pickAccessoryItemByKind(payload.items, materials, 'tap')
  const muiCocItem = pickAccessoryItemByKind(payload.items, materials, 'mui_coc')

  const rowMeta = {
    template_scope: 'CUSTOM',
    loai_coc: loaiCoc,
    cuong_do: cuongDo,
    mac_thep: steelGrade,
    do_ngoai: doNgoai,
    chieu_day: chieuDay,
    mac_be_tong: macBeTong,
    khoi_luong_kg_md: Number(payload.header.kg_md || 0),
    pc_nos: Number(payload.header.pc_nos || 0),
    don_kep_factor: Number(firstSegment?.don_kep_factor || 1),
    a1_mm: Number(firstSegment?.a1_mm || 0),
    a2_mm: Number(firstSegment?.a2_mm || 0),
    a3_mm: Number(firstSegment?.a3_mm || 0),
    p1_pct: Number(firstSegment?.p1_pct || 0),
    p2_pct: Number(firstSegment?.p2_pct || 0),
    p3_pct: Number(firstSegment?.p3_pct || 0),
    dtam_mm: Number(payload.header.dtam_mm || 0),
    pc_nvl_id: pcItem?.nvl_id || '',
    dai_nvl_id: daiItem?.nvl_id || '',
    buoc_nvl_id: buocItem?.nvl_id || '',
    mat_bich_nvl_id: matBichItem?.nvl_id || '',
    mang_xong_nvl_id: mangXongItem?.nvl_id || '',
    tap_nvl_id: tapItem?.nvl_id || '',
    mui_coc_nvl_id: muiCocItem?.nvl_id || '',
    pc_label: resolveItemLabel(pcItem, materials) || String(payload.header.loai_thep || '').trim(),
    dai_label:
      resolveItemLabel(daiItem, materials) ||
      (Number(payload.header.dai_dia_mm || 0) > 0 ? `Thép đai ${payload.header.dai_dia_mm}` : ''),
    buoc_label:
      resolveItemLabel(buocItem, materials) ||
      (Number(payload.header.buoc_dia_mm || 0) > 0 ? `Thép buộc ${payload.header.buoc_dia_mm}` : ''),
    mat_bich_label: resolveItemLabel(matBichItem, materials),
    mang_xong_label: resolveItemLabel(mangXongItem, materials),
    tap_label: resolveItemLabel(tapItem, materials),
    mui_coc_label: resolveItemLabel(muiCocItem, materials),
  }

  const { data: existingRows, error } = await supabase
    .from('dm_coc_template')
    .select('*')
    .eq('is_active', true)
    .limit(1000)
  if (error) throw error

  const rows = ((existingRows ?? []) as Array<Record<string, unknown>>).map(
    (row): Record<string, unknown> & { __meta: Record<string, unknown> } => ({
      ...row,
      __meta: parseTemplateMeta(row),
    })
  )
  const draftSignature = buildDraftTemplateSignature(
    payload,
    rowMeta,
    loaiCoc,
    macBeTong,
    doNgoai,
    chieuDay
  )

  const duplicate = rows.find((row) => {
    const meta = (row.__meta as Record<string, unknown>) || {}
    const merged = { ...meta, ...row }
    return buildExistingTemplateSignature(merged) === draftSignature
  }) ?? null

  if (duplicate) {
    return {
      loai_coc: loaiCoc,
      ma_coc: readCandidateValue(duplicate, TEMPLATE_CANDIDATE_COLUMNS.code),
      template_id: String(duplicate.template_id ?? duplicate.id ?? ''),
      created: false,
    }
  }

  const sameUniqueKeyRow = null as (Record<string, unknown> & { __meta: Record<string, unknown> }) | null

  const siblingCount = rows.filter((row) => {
    const meta = (row.__meta as Record<string, unknown>) || {}
    const merged = { ...meta, ...row }
    return (
      String(merged.mac_be_tong ?? '').trim() === macBeTong &&
      Number(merged.do_ngoai ?? 0) === doNgoai &&
      Number(merged.chieu_day ?? 0) === chieuDay &&
      String(merged.mac_thep ?? '').trim().toUpperCase() === steelGrade
    )
  }).length

  const maCoc = `${buildCodePrefix(macBeTong, steelGrade, doNgoai, chieuDay)} - ${siblingCount + 1}`
  const insertPayload: Record<string, unknown> = {
    loai_coc: loaiCoc,
    cuong_do: cuongDo,
    mac_thep: steelGrade,
    do_ngoai: doNgoai,
    chieu_day: chieuDay,
    mac_be_tong: macBeTong,
    pc_dia_mm: Number(payload.header.pc_dia_mm || 0) || null,
    pc_nos: Number(rowMeta.pc_nos || 0) || null,
    dai_dia_mm: Number(payload.header.dai_dia_mm || 0) || null,
    buoc_dia_mm: Number(payload.header.buoc_dia_mm || 0) || null,
    a1_mm: Number(rowMeta.a1_mm || 0) || null,
    a2_mm: Number(rowMeta.a2_mm || 0) || null,
    a3_mm: Number(rowMeta.a3_mm || 0) || null,
    p1_pct: Number(rowMeta.p1_pct || 0) || null,
    p2_pct: Number(rowMeta.p2_pct || 0) || null,
    p3_pct: Number(rowMeta.p3_pct || 0) || null,
    don_kep_factor: Number(rowMeta.don_kep_factor || 0) || null,
    dtam_mm: Number(rowMeta.dtam_mm || 0) || null,
    khoi_luong_kg_md: Number(rowMeta.khoi_luong_kg_md || 0) || null,
    is_active: true,
    deleted_at: null,
    created_by: userId,
    ghi_chu: buildStoredNote(null, rowMeta),
  }

  for (const field of TEMPLATE_CANDIDATE_COLUMNS.code) insertPayload[field] = maCoc
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.cuongDo) insertPayload[field] = cuongDo
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.steelGrade) insertPayload[field] = steelGrade
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.pcNvlId) insertPayload[field] = rowMeta.pc_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.daiNvlId) insertPayload[field] = rowMeta.dai_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.buocNvlId) insertPayload[field] = rowMeta.buoc_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.matBichNvlId) insertPayload[field] = rowMeta.mat_bich_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.mangXongNvlId) insertPayload[field] = rowMeta.mang_xong_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.tapNvlId) insertPayload[field] = rowMeta.tap_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.muiCocNvlId) insertPayload[field] = rowMeta.mui_coc_nvl_id || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.pcLabel) insertPayload[field] = rowMeta.pc_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.daiLabel) insertPayload[field] = rowMeta.dai_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.buocLabel) insertPayload[field] = rowMeta.buoc_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.matBichLabel) insertPayload[field] = rowMeta.mat_bich_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.mangXongLabel) insertPayload[field] = rowMeta.mang_xong_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.tapLabel) insertPayload[field] = rowMeta.tap_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.muiCocLabel) insertPayload[field] = rowMeta.mui_coc_label || null
  for (const field of TEMPLATE_CANDIDATE_COLUMNS.kgMd) insertPayload[field] = rowMeta.khoi_luong_kg_md || null

  if (sameUniqueKeyRow) {
    const sameMeta = (sameUniqueKeyRow.__meta as Record<string, unknown>) || {}
    const sameScope = resolveTemplateScope(sameUniqueKeyRow, sameMeta)
    const sameTemplateId = String(sameUniqueKeyRow.template_id ?? sameUniqueKeyRow.id ?? '')
    const sameCode = readCandidateValue(sameUniqueKeyRow, TEMPLATE_CANDIDATE_COLUMNS.code)

    if (sameScope === 'CUSTOM' && sameTemplateId) {
      const updatePayload: Record<string, unknown> = {
        ...insertPayload,
        updated_by: userId,
      }
      for (const field of TEMPLATE_CANDIDATE_COLUMNS.code) updatePayload[field] = sameCode || maCoc

      const updateResult = await executeTemplateUpdateWithFallback(
        supabase,
        sameTemplateId,
        updatePayload
      )
      if (updateResult.error) throw new Error(toErrorMessage(updateResult.error))

      return {
        loai_coc: loaiCoc,
        ma_coc: sameCode || maCoc,
        template_id: sameTemplateId,
        created: false,
      }
    }

    return {
      loai_coc: loaiCoc,
      ma_coc: sameCode || maCoc,
      template_id: sameTemplateId,
      created: false,
    }
  }

  const insertResult = await executeTemplateInsertWithFallback(supabase, insertPayload)
  if (insertResult.error) throw new Error(toErrorMessage(insertResult.error))

  const inserted = (insertResult.data ?? null) as Record<string, unknown> | null
  return {
    loai_coc: loaiCoc,
    ma_coc: maCoc,
    template_id: String(inserted?.template_id ?? inserted?.id ?? ''),
    created: true,
  }
}

function buildTemplateLabel(row: Record<string, unknown>): string {
  const resolved = resolveTemplateDisplayCode(row)
  return resolved === '-' ? '' : resolved
}

function parseConcreteMixVariant(row: Record<string, unknown>): string {
  const direct = readStringCandidate(row, ['variant', 'cap_phoi_variant', 'loai_cap_phoi'])
  if (direct) return direct

  const ghiChu = readStringCandidate(row, ['ghi_chu'])
  const match = ghiChu.match(/variant\s*:\s*([A-Z0-9_ -]+)/i)
  if (match?.[1]) return match[1].trim()

  return 'FULL_XI_TRO_XI'
}

export async function loadBocTachReferenceData(
  supabase: AnySupabase,
  options?: { includeFinancialData?: boolean }
): Promise<BocTachReferenceData> {
  const includeFinancialData = options?.includeFinancialData ?? true
  const [
    { data: mixRows, error: mixError },
    { data: auxRows, error: auxError },
    { data: templateRows, error: templateError },
    { data: projectRows, error: projectError },
    { data: customerRows, error: customerError },
    { data: materialRows, error: materialError },
    { data: priceRows, error: priceError },
    { data: otherCostRows, error: otherCostError },
  ] = await Promise.all([
    supabase
      .from('dm_capphoi_bt')
      .select('*')
      .eq('is_active', true),
    supabase
      .from('dm_dinh_muc_phu_md')
      .select('dm_id, nvl_id, nhom_d, dinh_muc, dvt, is_active')
      .eq('is_active', true),
    supabase.from('dm_coc_template').select('*').eq('is_active', true),
    supabase.from('dm_duan').select('*').eq('is_active', true),
    supabase.from('dm_kh').select('*').eq('is_active', true),
    supabase.from('nvl').select('nvl_id, ten_hang, nhom_hang, dvt').eq('is_active', true).limit(1000),
    includeFinancialData
      ? supabase.from('gia_nvl').select('gia_nvl_id, nvl_id, don_gia, created_at, updated_at').limit(2000)
      : Promise.resolve({ data: [], error: null }),
    includeFinancialData
      ? supabase.from('dm_chi_phi_khac_md').select('duong_kinh_mm, chi_phi_vnd_md, is_active').eq('is_active', true).limit(4000)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (mixError && !isMissingRelationError(mixError.message)) throw mixError
  if (auxError && !isMissingRelationError(auxError.message)) throw auxError
  if (templateError && !isMissingRelationError(templateError.message)) throw templateError
  if (projectError && !isMissingRelationError(projectError.message)) throw projectError
  if (customerError && !isMissingRelationError(customerError.message)) throw customerError
  if (materialError && !isMissingRelationError(materialError.message)) throw materialError
  if (priceError && !isMissingRelationError(priceError.message)) throw priceError
  if (otherCostError && !isMissingRelationError(otherCostError.message)) throw otherCostError

  const concreteMixRows = ((mixError && isMissingRelationError(mixError.message) ? [] : mixRows) ?? []) as Array<Record<string, unknown>>
  const auxiliaryRateRows = ((auxError && isMissingRelationError(auxError.message) ? [] : auxRows) ?? []) as Array<Record<string, unknown>>
  const pileTemplateRows = ((templateError && isMissingRelationError(templateError.message) ? [] : templateRows) ?? []) as Array<Record<string, unknown>>
  const templateCodeMap = buildTemplateCodeMap(pileTemplateRows)
  const projectRefRows = ((projectError && isMissingRelationError(projectError.message) ? [] : projectRows) ?? []) as Array<Record<string, unknown>>
  const customerRefRows = ((customerError && isMissingRelationError(customerError.message) ? [] : customerRows) ?? []) as Array<Record<string, unknown>>
  const materialRefRows = ((materialError && isMissingRelationError(materialError.message) ? [] : materialRows) ?? []) as Array<Record<string, unknown>>
  const materialPriceRows = ((priceError && isMissingRelationError(priceError.message) ? [] : priceRows) ?? []) as Array<Record<string, unknown>>
  const otherCostRefRows = ((otherCostError && isMissingRelationError(otherCostError.message) ? [] : otherCostRows) ?? []) as Array<Record<string, unknown>>

  const [{ data: vatRows, error: vatError }, { data: profitRows, error: profitError }] = await Promise.all(
    includeFinancialData
      ? [
          supabase.from('dm_thue_vat').select('*').limit(20),
          supabase.from('dm_bien_loi_nhuan').select('*').eq('is_active', true).limit(500),
        ]
      : [
          Promise.resolve({ data: [], error: null }),
          Promise.resolve({ data: [], error: null }),
        ]
  )

  if (vatError && !isMissingRelationError(vatError.message)) throw vatError
  if (profitError && !isMissingRelationError(profitError.message)) throw profitError

  const vatConfigRows = ((vatError && isMissingRelationError(vatError.message) ? [] : vatRows) ?? []) as Array<Record<string, unknown>>
  const profitRuleRows = ((profitError && isMissingRelationError(profitError.message) ? [] : profitRows) ?? []) as Array<Record<string, unknown>>
  const cocVatRow = vatConfigRows.find(
    (row) => String(row.loai_ap_dung || '').trim().toUpperCase() === 'COC'
  )
  const phuKienVatRow = vatConfigRows.find(
    (row) => String(row.loai_ap_dung || '').trim().toUpperCase() === 'PHU_KIEN'
  )

  const nvlIds = Array.from(
    new Set(
      [...concreteMixRows, ...auxiliaryRateRows]
        .map((row) => String(row.nvl_id || ''))
        .filter((value) => value.length > 0)
    )
  )

  const nvlNameMap = new Map(
    materialRefRows.map((row) => [
      readStringCandidate(row, ['nvl_id', 'id']),
      readStringCandidate(row, ['ten_hang'], readStringCandidate(row, ['nvl_id', 'id'])),
    ])
  )
  const missingNvlIds = nvlIds.filter((id) => id.length > 0 && !nvlNameMap.has(id))
  if (missingNvlIds.length > 0) {
    const { data: nvlRows, error: nvlError } = await supabase
      .from('nvl')
      .select('nvl_id, ten_hang, is_active')
      .in('nvl_id', missingNvlIds)

    if (nvlError && !isMissingRelationError(nvlError.message)) {
      throw nvlError
    }
    if (nvlError && isMissingRelationError(nvlError.message)) {
      return {
        concreteMixes: concreteMixRows.map(
          (row): ConcreteMixReference => ({
            cp_id: String(row.cp_id || ''),
            nvl_id: String(row.nvl_id || ''),
            ten_nvl: String(row.nvl_id || ''),
            mac_be_tong: String(row.mac_be_tong || ''),
            variant: parseConcreteMixVariant(row),
            dinh_muc_m3: Number(row.dinh_muc_m3 || 0),
            dvt: String(row.dvt || 'kg'),
          })
        ),
        auxiliaryRates: auxiliaryRateRows.map(
          (row): AuxiliaryMaterialReference => ({
            dm_id: String(row.dm_id || ''),
            nvl_id: String(row.nvl_id || ''),
            ten_nvl: String(row.nvl_id || ''),
            nhom_d: String(row.nhom_d || ''),
            dinh_muc: Number(row.dinh_muc || 0),
            dvt: String(row.dvt || 'kg'),
          })
        ),
        pileTemplates: pileTemplateRows.map(
          (row): PileTemplateReference => ({
            template_id: readStringCandidate(row, ['template_id', 'id']),
            label: buildTemplateLabel(row),
            ma_coc: readStringCandidate(row, ['ma_coc', 'ma_coc_template']),
          })
        ),
        customers: customerRefRows.map(
          (row): CustomerReference => ({
            kh_id: String(row.kh_id || ''),
            ma_kh: String(row.ma_kh || ''),
            ten_kh: String(row.ten_kh || row.kh_id || ''),
            thong_tin: String(row.lien_he || row.email || row.sdt || ''),
          })
        ),
        projects: projectRefRows.map(
          (row): ProjectReference => ({
            da_id: String(row.da_id || ''),
            ma_da: String(row.ma_da || row.ma_duan || ''),
            ten_da: String(row.ten_da || row.da_id || ''),
            kh_id: String(row.kh_id || ''),
            vi_tri_cong_trinh: cleanProjectLocationText(String(row.vi_tri_cong_trinh || row.dia_chi_cong_trinh || row.dia_diem || '')),
          })
        ),
        materials: [],
        hasFullReferenceData: false,
        vatConfig: {
          coc_vat_pct: Number(cocVatRow?.vat_pct || 0),
          phu_kien_vat_pct: Number(phuKienVatRow?.vat_pct || 0),
        },
        profitRules: [],
        otherCostsByDiameter: [],
      }
    }

    for (const row of (nvlRows ?? []) as Array<Record<string, unknown>>) {
      nvlNameMap.set(String(row.nvl_id || ''), String(row.ten_hang || row.nvl_id || ''))
    }
  }

  const latestPriceMap = new Map<string, number>()
  for (const row of [...materialPriceRows].sort((left, right) => {
    const leftTime = new Date(String(left.created_at ?? left.updated_at ?? '')).getTime()
    const rightTime = new Date(String(right.created_at ?? right.updated_at ?? '')).getTime()
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
  })) {
    const nvlId = String(row.nvl_id || '')
    if (!nvlId || latestPriceMap.has(nvlId)) continue
    latestPriceMap.set(nvlId, Number(row.don_gia || 0))
  }

  const otherCostMap = new Map<number, number>()
  for (const row of otherCostRefRows) {
    const diameter = Number(row.duong_kinh_mm || 0)
    if (!Number.isFinite(diameter) || diameter <= 0) continue
    const amount = Number(row.chi_phi_vnd_md || 0)
    otherCostMap.set(diameter, Number((otherCostMap.get(diameter) || 0) + (Number.isFinite(amount) ? amount : 0)))
  }

  return {
    concreteMixes: concreteMixRows.map(
      (row): ConcreteMixReference => ({
        cp_id: String(row.cp_id || ''),
        nvl_id: String(row.nvl_id || ''),
        ten_nvl: nvlNameMap.get(String(row.nvl_id || '')) || String(row.nvl_id || ''),
        mac_be_tong: String(row.mac_be_tong || ''),
        variant: parseConcreteMixVariant(row),
        dinh_muc_m3: Number(row.dinh_muc_m3 || 0),
        dvt: String(row.dvt || ''),
      })
    ),
    auxiliaryRates: auxiliaryRateRows.map(
      (row): AuxiliaryMaterialReference => ({
        dm_id: String(row.dm_id || ''),
        nvl_id: String(row.nvl_id || ''),
        ten_nvl: nvlNameMap.get(String(row.nvl_id || '')) || String(row.nvl_id || ''),
        nhom_d: String(row.nhom_d || ''),
        dinh_muc: Number(row.dinh_muc || 0),
        dvt: String(row.dvt || ''),
      })
    ),
    pileTemplates: pileTemplateRows
      .map((row): PileTemplateReference | null => {
        const meta = parseTemplateMeta(row)
        const templateId = readStringCandidate(row, ['template_id', 'id'])
        const maCoc = templateCodeMap.get(templateId) || undefined
        if (!maCoc || maCoc === '-') return null
        return {
          template_id: templateId,
          ma_coc: maCoc,
          label: maCoc || buildTemplateLabel(row),
          template_scope: resolveTemplateScope(row, meta),
          loai_coc: readTemplateStringCandidate(row, meta, ['loai_coc']) || undefined,
          mac_be_tong:
            readTemplateStringCandidate(row, meta, ['mac_be_tong']) || undefined,
          do_ngoai: readTemplateNumberCandidate(row, meta, ['do_ngoai', 'do_mm']),
          chieu_day: readTemplateNumberCandidate(row, meta, ['chieu_day', 't_mm']),
          kg_md: readTemplateNumberCandidate(
            row,
            meta,
            ['khoi_luong_kg_md', 'kg_md', 'trong_luong_kg_md']
          ),
          pc_dia_mm: readTemplateNumberCandidate(row, meta, ['pc_dia_mm']),
          pc_nos: readTemplateNumberCandidate(row, meta, ['pc_nos']),
          dai_dia_mm: readTemplateNumberCandidate(row, meta, ['dai_dia_mm']),
          buoc_dia_mm: readTemplateNumberCandidate(row, meta, ['buoc_dia_mm']),
          dtam_mm: readTemplateNumberCandidate(row, meta, ['dtam_mm']),
          a1_mm: readTemplateNumberCandidate(row, meta, ['a1_mm']),
          a2_mm: readTemplateNumberCandidate(row, meta, ['a2_mm']),
          a3_mm: readTemplateNumberCandidate(row, meta, ['a3_mm']),
          p1_pct: readTemplateNumberCandidate(row, meta, ['p1_pct']),
          p2_pct: readTemplateNumberCandidate(row, meta, ['p2_pct']),
          p3_pct: readTemplateNumberCandidate(row, meta, ['p3_pct']),
          don_kep_factor: readTemplateNumberCandidate(row, meta, ['don_kep_factor', 'don_kep']),
          pc_nvl_id:
            readTemplateStringCandidate(row, meta, ['pc_nvl_id', 'thep_pc_nvl_id']) ||
            undefined,
          dai_nvl_id:
            readTemplateStringCandidate(row, meta, ['dai_nvl_id', 'thep_dai_nvl_id']) ||
            undefined,
          buoc_nvl_id:
            readTemplateStringCandidate(row, meta, ['buoc_nvl_id', 'thep_buoc_nvl_id']) ||
            undefined,
          pc_label:
            readTemplateStringCandidate(row, meta, ['thep_pc', 'pc_label']) || undefined,
          dai_label:
            readTemplateStringCandidate(row, meta, ['thep_dai', 'dai_label']) || undefined,
          buoc_label:
            readTemplateStringCandidate(row, meta, ['thep_buoc', 'buoc_label']) || undefined,
          mat_bich_nvl_id:
            readTemplateStringCandidate(row, meta, ['mat_bich_nvl_id']) || undefined,
          mang_xong_nvl_id:
            readTemplateStringCandidate(row, meta, ['mang_xong_nvl_id']) || undefined,
          tap_nvl_id:
            readTemplateStringCandidate(row, meta, ['tap_nvl_id', 'tap_vuong_nvl_id']) ||
            undefined,
          mui_coc_nvl_id:
            readTemplateStringCandidate(row, meta, ['mui_coc_nvl_id']) || undefined,
          mat_bich_label:
            readTemplateStringCandidate(row, meta, ['mat_bich', 'mat_bich_label']) || undefined,
          mang_xong_label:
            readTemplateStringCandidate(row, meta, ['mang_xong', 'mang_xong_label']) ||
            undefined,
          tap_label:
            readTemplateStringCandidate(row, meta, ['tap_vuong', 'tap_label']) || undefined,
          mui_coc_label:
            readTemplateStringCandidate(row, meta, ['mui_coc', 'mui_coc_label']) || undefined,
        }
      })
      .filter((row): row is PileTemplateReference => row !== null),
    customers: customerRefRows.map(
      (row): CustomerReference => ({
        kh_id: readStringCandidate(row, ['kh_id', 'id']),
        ma_kh: readStringCandidate(row, ['ma_kh']) || undefined,
        ten_kh: readStringCandidate(row, ['ten_kh'], readStringCandidate(row, ['kh_id', 'id'])),
        thong_tin:
          readStringCandidate(row, ['thong_tin_khach_hang', 'nguoi_lien_he', 'dia_chi']) ||
          undefined,
      })
    ),
    projects: projectRefRows.map(
      (row): ProjectReference => ({
        da_id: readStringCandidate(row, ['da_id', 'id']),
        ma_da: readStringCandidate(row, ['ma_da']) || undefined,
        ten_da: readStringCandidate(row, ['ten_da'], readStringCandidate(row, ['da_id', 'id'])),
        kh_id: readStringCandidate(row, ['kh_id']),
        vi_tri_cong_trinh:
          cleanProjectLocationText(
            readStringCandidate(row, ['vi_tri_cong_trinh', 'dia_diem', 'ghi_chu']) || undefined
          ) || undefined,
      })
    ),
    materials: materialRefRows.map((row) => ({
      nvl_id: readStringCandidate(row, ['nvl_id', 'id']),
      ten_hang: readStringCandidate(row, ['ten_hang'], readStringCandidate(row, ['nvl_id', 'id'])),
      nhom_hang: readStringCandidate(row, ['nhom_hang']),
      dvt: readStringCandidate(row, ['dvt']) || undefined,
      don_gia_hien_hanh:
        latestPriceMap.get(readStringCandidate(row, ['nvl_id', 'id'])) ?? 0,
    })),
    hasFullReferenceData: includeFinancialData,
    vatConfig: {
      coc_vat_pct: Number(cocVatRow?.vat_pct || 0),
      phu_kien_vat_pct: Number(phuKienVatRow?.vat_pct || 0),
    },
    profitRules: profitRuleRows
      .map((row) => ({
        duong_kinh_mm: Number(row.duong_kinh_mm || 0),
        min_md: Number(row.min_md || 0),
        loi_nhuan_pct: Number(row.loi_nhuan_pct || 0),
      }))
      .filter(
        (row) =>
          Number.isFinite(row.duong_kinh_mm) &&
          row.duong_kinh_mm > 0 &&
          Number.isFinite(row.min_md) &&
          Number.isFinite(row.loi_nhuan_pct) &&
          row.loi_nhuan_pct > 0
      ),
    otherCostsByDiameter: Array.from(otherCostMap.entries())
      .map(([duong_kinh_mm, tong_chi_phi_vnd_md]) => ({
        duong_kinh_mm,
        tong_chi_phi_vnd_md: Number(tong_chi_phi_vnd_md || 0),
      }))
      .sort((left, right) => left.duong_kinh_mm - right.duong_kinh_mm),
  }
}

export async function findHeaderById(supabase: AnySupabase, bocId: string) {
  for (const idField of HEADER_ID_CANDIDATES) {
    const { data, error } = await supabase
      .from('boc_tach_nvl')
      .select('*')
      .eq(idField, bocId)
      .maybeSingle()

    if (error) {
      if (error.message.toLowerCase().includes('column')) {
        continue
      }
      throw error
    }

    if (data) {
      return { row: data as Record<string, unknown>, idField }
    }
  }

  return { row: null as Record<string, unknown> | null, idField: HEADER_ID_CANDIDATES[0] }
}

async function resolveChildParentField(
  supabase: AnySupabase,
  tableName: 'boc_tach_nvl_items' | 'boc_tach_seg_nvl',
  bocId: string
) {
  let firstExistingField: string | null = null

  for (const parentField of CHILD_PARENT_CANDIDATES) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq(parentField, bocId)
      .limit(1)

    if (!error) {
      if (!firstExistingField) firstExistingField = parentField
      if (Array.isArray(data) && data.length > 0) {
        return parentField
      }
      continue
    }

    if (!error.message.toLowerCase().includes('column')) {
      throw error
    }
  }

  return firstExistingField ?? CHILD_PARENT_CANDIDATES[0]
}

async function resolveCanonicalChildParentField(
  supabase: AnySupabase,
  tableName: 'boc_tach_nvl_items' | 'boc_tach_seg_nvl'
) {
  for (const parentField of CHILD_PARENT_CANDIDATES) {
    const { error } = await supabase.from(tableName).select(parentField).limit(1)
    if (!error) return parentField
    if (!error.message.toLowerCase().includes('column')) {
      throw error
    }
  }
  return CHILD_PARENT_CANDIDATES[0]
}

async function deleteChildRowsByAllParentFields(
  supabase: AnySupabase,
  tableName: 'boc_tach_nvl_items' | 'boc_tach_seg_nvl',
  bocId: string
) {
  for (const parentField of CHILD_PARENT_CANDIDATES) {
    const { error } = await supabase.from(tableName).delete().eq(parentField, bocId)
    if (!error) continue
    if (!error.message.toLowerCase().includes('column')) {
      throw error
    }
  }
}

export async function loadBocTachDetail(supabase: AnySupabase, bocId: string) {
  const header = await findHeaderById(supabase, bocId)
  if (!header.row) {
    return {
      header: null,
      idField: header.idField,
      items: [] as Record<string, unknown>[],
      segments: [] as Record<string, unknown>[],
      itemParentField: CHILD_PARENT_CANDIDATES[0],
      segParentField: CHILD_PARENT_CANDIDATES[0],
    }
  }

  const itemParentField = await resolveChildParentField(supabase, 'boc_tach_nvl_items', bocId)
  const segParentField = await resolveChildParentField(supabase, 'boc_tach_seg_nvl', bocId)

  const [{ data: items, error: itemsError }, { data: segments, error: segError }] = await Promise.all([
    supabase.from('boc_tach_nvl_items').select('*').eq(itemParentField, bocId),
    supabase.from('boc_tach_seg_nvl').select('*').eq(segParentField, bocId),
  ])

  if (itemsError) throw itemsError
  if (segError) throw segError

  return {
    header: header.row,
    idField: header.idField,
    items: (items ?? []) as Record<string, unknown>[],
    segments: (segments ?? []) as Record<string, unknown>[],
    itemParentField,
    segParentField,
  }
}

async function hasBocTachDownstreamRecords(supabase: AnySupabase, bocId: string) {
  const [
    { count: orderCount, error: orderError },
    { count: planCount, error: planError },
    { data: quoteLinkRows, error: quoteLinkError },
  ] = await Promise.all([
    supabase
      .from('don_hang')
      .select('order_id', { count: 'exact', head: true })
      .eq('boc_id', bocId)
      .eq('is_active', true),
    supabase
      .from('ke_hoach_sx_line')
      .select('line_id', { count: 'exact', head: true })
      .eq('boc_id', bocId)
      .eq('is_active', true),
    supabase
      .from('bao_gia_boc_tach')
      .select('quote_id')
      .eq('boc_id', bocId),
  ])

  if (orderError) throw orderError
  if (planError) throw planError
  if (quoteLinkError) throw quoteLinkError

  const quoteIds = ((quoteLinkRows ?? []) as Array<Record<string, unknown>>)
    .map((row) => String(row.quote_id ?? ''))
    .filter(Boolean)

  let activeQuoteStatuses: string[] = []
  if (quoteIds.length > 0) {
    const { data: quoteRows, error: quoteError } = await supabase
      .from('bao_gia')
      .select('quote_id, trang_thai')
      .in('quote_id', quoteIds)
      .eq('is_active', true)

    if (quoteError) throw quoteError

    activeQuoteStatuses = ((quoteRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.trang_thai ?? ''))
      .filter((status) => status && status !== 'THAT_BAI')
  }

  return {
    hasLinkedOrder: Number(orderCount || 0) > 0,
    hasProductionPlan: Number(planCount || 0) > 0,
    hasActiveQuote: activeQuoteStatuses.length > 0,
    activeQuoteStatuses,
  }
}

export async function reopenBocTach(
  supabase: AnySupabase,
  params: {
    bocId: string
    userId: string
    userRole: string
  }
) {
  const existing = await findHeaderById(supabase, params.bocId)
  if (!existing.row) {
    throw new Error('Không tìm thấy hồ sơ bóc tách để mở lại.')
  }

  const currentStatus = String(existing.row.trang_thai || 'NHAP') as HeaderStatus
  const isAdmin = isAdminRole(params.userRole)
  const isQlsx = isQlsxRole(params.userRole)
  const isCommercial = isCommercialRole(params.userRole)

  if (isQlsx || (!isAdmin && !isCommercial)) {
    throw new Error('Chỉ KTBH hoặc Admin mới được mở lại bóc tách.')
  }

  if (currentStatus === 'DA_GUI') {
    // soft reopen is allowed for upstream side when QLSX has not processed it yet
  } else if (currentStatus === 'DA_DUYET_QLSX') {
    if (!isAdmin) {
      throw new Error('Chỉ Admin mới được mở lại bóc tách đã duyệt QLSX.')
    }
  } else {
    throw new Error('Chỉ mở lại được bóc tách đang chờ QLSX hoặc đã duyệt QLSX.')
  }

  const downstream = await hasBocTachDownstreamRecords(supabase, params.bocId)
  if (downstream.hasProductionPlan) {
    await writeAuditLog(supabase, {
      action: 'REOPEN',
      entityType: 'BOC_TACH_NVL',
      entityId: params.bocId,
      actorId: params.userId,
      beforeJson: { reopened_from_status: currentStatus },
      summaryJson: {
        result: 'BLOCKED',
        blocked_downstream_type: 'KE_HOACH_SX_LINE',
      },
      note: 'Bóc tách đã được đưa vào kế hoạch sản xuất. Cần mở ngược kế hoạch trước.',
    })
    throw new Error('Bóc tách đã được đưa vào kế hoạch sản xuất. Cần mở ngược kế hoạch trước.')
  }
  if (downstream.hasLinkedOrder) {
    await writeAuditLog(supabase, {
      action: 'REOPEN',
      entityType: 'BOC_TACH_NVL',
      entityId: params.bocId,
      actorId: params.userId,
      beforeJson: { reopened_from_status: currentStatus },
      summaryJson: {
        result: 'BLOCKED',
        blocked_downstream_type: 'DON_HANG',
      },
      note: 'Bóc tách đã sinh đơn hàng. Cần mở ngược đơn hàng trước.',
    })
    throw new Error('Bóc tách đã sinh đơn hàng. Cần mở ngược đơn hàng trước.')
  }
  if (downstream.hasActiveQuote) {
    await writeAuditLog(supabase, {
      action: 'REOPEN',
      entityType: 'BOC_TACH_NVL',
      entityId: params.bocId,
      actorId: params.userId,
      beforeJson: { reopened_from_status: currentStatus },
      summaryJson: {
        result: 'BLOCKED',
        blocked_downstream_type: 'BAO_GIA',
        linked_quote_statuses: downstream.activeQuoteStatuses,
      },
      note: 'Bóc tách đang gắn với báo giá active. Tạm chặn mở lại để tránh lệch dữ liệu thương mại/kỹ thuật.',
    })
    throw new Error('Bóc tách đang gắn với báo giá active. Cần xử lý báo giá liên quan trước khi mở lại.')
  }

  const currentMeta = parseBocMeta(existing.row)
  const nextMeta = {
    ...currentMeta,
    qlsx_reason_code: '',
    qlsx_reason_text: '',
    qlsx_tra_lai_at: '',
    qlsx_duyet_at: '',
  }

  const { data, error } = await executeHeaderUpdateWithFallback(
    supabase,
    existing.idField,
    params.bocId,
    {
      trang_thai: 'NHAP',
      ghi_chu: buildStoredBocNote(
        readStringCandidate(existing.row, ['ten_boc_tach'], ''),
        nextMeta
      ),
      updated_by: params.userId,
    }
  )
  if (error) throw new Error(toErrorMessage(error))

  await writeAuditLog(supabase, {
    action: 'REOPEN',
    entityType: 'BOC_TACH_NVL',
    entityId: params.bocId,
    actorId: params.userId,
    beforeJson: { reopened_from_status: currentStatus },
    afterJson: { reopened_to_status: 'NHAP' },
    summaryJson: {
      result: 'REOPENED',
      blocked_downstream_type: null,
    },
    note: 'Mở lại bóc tách để chỉnh sửa và gửi lại QLSX.',
  })

  return {
    header: (data ?? existing.row) as Record<string, unknown>,
    reopenedFrom: currentStatus,
  }
}

export async function deleteBocTachHeaders(supabase: AnySupabase, bocIds: string[]) {
  const uniqueIds = Array.from(new Set(bocIds.map((id) => String(id || '').trim()).filter(Boolean)))
  const deletedIds: string[] = []

  for (const bocId of uniqueIds) {
    const header = await findHeaderById(supabase, bocId)
    if (!header.row) continue

    const status = String(header.row.trang_thai ?? 'NHAP')
    if (status === 'DA_GUI') {
      throw new Error('Có hồ sơ đã gửi QLSX. Chỉ xóa được hồ sơ Nháp hoặc Hủy.')
    }

    await deleteChildRowsByAllParentFields(supabase, 'boc_tach_nvl_items', bocId)
    await deleteChildRowsByAllParentFields(supabase, 'boc_tach_seg_nvl', bocId)

    const { error: headerError } = await supabase.from('boc_tach_nvl').delete().eq(header.idField, bocId)
    if (headerError) throw headerError

    deletedIds.push(bocId)
  }

  return { deletedIds }
}

export async function tryGenerateDonHangCode(supabase: AnySupabase): Promise<string | null> {
  const attempts: Record<string, unknown>[] = [
    { p_table: 'don_hang' },
    { table_name: 'don_hang' },
    { p_prefix: 'DH' },
    {},
  ]

  for (const args of attempts) {
    const { data, error } = await supabase.rpc('next_ma', args)
    if (error) {
      continue
    }

    if (typeof data === 'string') return data
    if (Array.isArray(data) && typeof data[0] === 'string') return data[0]
  }

  return null
}

async function createDonHangFromBocTach(
  supabase: AnySupabase,
  headerId: string,
  userId: string,
  headerRow: Record<string, unknown> | null
) {
  const syncPayload: Record<string, unknown> = {
    da_id: headerRow?.da_id ?? null,
    kh_id: headerRow?.kh_id ?? null,
    loai_coc: headerRow?.loai_coc ?? null,
    do_ngoai: headerRow?.do_ngoai ?? null,
    mac_be_tong: headerRow?.mac_be_tong ?? null,
    to_hop_doan: Array.isArray(headerRow?.to_hop_doan)
      ? (headerRow?.to_hop_doan as Record<string, unknown>[])
      : [],
    updated_by: userId,
  }

  const existsChecks = [
    ['boc_id', headerId],
    ['boc_tach_nvl_id', headerId],
    ['boc_tach_id', headerId],
  ] as const

  for (const [field, value] of existsChecks) {
    const { data, error } = await supabase
      .from('don_hang')
      .select('*')
      .eq(field, value)
      .maybeSingle()

    if (error) {
      if (error.message.toLowerCase().includes('column')) {
        continue
      }
      throw error
    }

    if (data) {
      const { data: updatedRow, error: updateError } = await supabase
        .from('don_hang')
        .update(syncPayload)
        .eq(field, value)
        .select('*')
        .maybeSingle()

      if (updateError) {
        if (updateError.message.toLowerCase().includes('column')) {
          return data
        }
        throw updateError
      }

      return updatedRow ?? data
    }
  }

  const maDonHang = await tryGenerateDonHangCode(supabase)

  const requiredPayload: Record<string, unknown> = {
    boc_id: headerId,
    ...syncPayload,
    created_by: userId,
  }

  const insertAttempts: Record<string, unknown>[] = [
    requiredPayload,
    {
      boc_id: headerId,
      created_by: userId,
    },
    {
      ma_don_hang: maDonHang,
      boc_tach_nvl_id: headerId,
      created_by: userId,
    },
    {
      ma_don_hang: maDonHang,
      boc_tach_id: headerId,
      created_by: userId,
    },
    {
      boc_tach_nvl_id: headerId,
      created_by: userId,
    },
  ]

  for (const payload of insertAttempts) {
    const { data, error } = await supabase
      .from('don_hang')
      .insert(payload)
      .select('*')
      .maybeSingle()

    if (error) {
      if (error.message.toLowerCase().includes('column')) {
        continue
      }
      throw error
    }

    if (data) {
      return data
    }
  }

  throw new Error('Khong tao duoc don_hang 1:1 tu boc_tach_nvl')
}

export async function saveBocTach(
  supabase: AnySupabase,
  userId: string,
  payload: BocTachDetailPayload,
  action: 'save' | 'send' | 'cancel' | 'approve' | 'return'
) {
  const cleanedPayload: BocTachDetailPayload = {
    ...payload,
    items: sanitizeItems(payload.items),
    segments: sanitizeSegments(payload.segments),
  }

  const refs = await loadBocTachReferenceData(supabase)
  const preview = computeBocTachPreview(cleanedPayload, refs)
  const selectedAccessories = {
    mat_bich: pickAccessoryItemByKind(cleanedPayload.items, refs.materials, 'mat_bich'),
    mang_xong: pickAccessoryItemByKind(cleanedPayload.items, refs.materials, 'mang_xong'),
    mui_coc: pickAccessoryItemByKind(cleanedPayload.items, refs.materials, 'mui_coc'),
    tap: pickAccessoryItemByKind(cleanedPayload.items, refs.materials, 'tap'),
  }

  let existing: { row: Record<string, unknown> | null; idField: string } = {
    row: null,
    idField: HEADER_ID_CANDIDATES[0],
  }
  if (cleanedPayload.bocId) {
    existing = await findHeaderById(supabase, cleanedPayload.bocId)
  }

  const currentStatus = String(existing.row?.trang_thai ?? 'NHAP') as HeaderStatus
  const effectiveCurrentStatus: HeaderStatus =
    currentStatus === 'DA_GUI' && cleanedPayload.header.trang_thai === 'TRA_LAI'
      ? 'TRA_LAI'
      : currentStatus
  if (existing.row && effectiveCurrentStatus === 'DA_GUI' && !['approve', 'return'].includes(action)) {
    throw new Error('Bản bóc tách đã gửi QLSX, không thể sửa trực tiếp')
  }
  if (existing.row && effectiveCurrentStatus === 'DA_DUYET_QLSX' && action !== 'cancel') {
    throw new Error('Bản bóc tách đã duyệt QLSX, không thể sửa trực tiếp')
  }

  const nextStatus: HeaderStatus =
    action === 'send'
      ? 'DA_GUI'
      : action === 'approve'
        ? 'DA_DUYET_QLSX'
        : action === 'return'
          ? 'TRA_LAI'
          : action === 'cancel'
            ? 'HUY'
            : 'NHAP'

  const ensuredTemplate =
    action === 'save'
      ? await ensureTemplateForSend(supabase, userId, cleanedPayload, refs.materials)
      : null

  const existingMeta = existing.row ? parseBocMeta(existing.row) : {}
  const resolvedMaCoc =
    ensuredTemplate?.ma_coc ||
    cleanedPayload.header.ma_coc ||
    String(existing.row?.ma_coc || existingMeta.ma_coc || '')
  const existingSegments = Array.isArray(existing.row?.to_hop_doan)
    ? (existing.row?.to_hop_doan as Array<Record<string, unknown>>)
    : []
  const resolvedTemplateId =
    ensuredTemplate?.template_id ||
    String(cleanedPayload.segments[0]?.template_id || existingSegments[0]?.template_id || '')
  const nextMeta = {
    ...existingMeta,
    ma_coc: resolvedMaCoc,
    profit_pct: Number(cleanedPayload.header.profit_pct || existingMeta.profit_pct || 0),
    tax_pct: Number(cleanedPayload.header.tax_pct || existingMeta.tax_pct || 0),
    qlsx_reason_code: String(cleanedPayload.header.qlsx_ly_do_code || existingMeta.qlsx_reason_code || ''),
    qlsx_reason_text: String(cleanedPayload.header.qlsx_ly_do_text || existingMeta.qlsx_reason_text || ''),
    qlsx_tra_lai_at:
      action === 'return'
        ? new Date().toISOString()
        : String(existingMeta.qlsx_tra_lai_at || ''),
    qlsx_duyet_at:
      action === 'approve'
        ? new Date().toISOString()
        : String(existingMeta.qlsx_duyet_at || ''),
  }

  const headerPayload: Record<string, unknown> = {
    da_id: cleanedPayload.header.da_id,
    kh_id: cleanedPayload.header.kh_id,
    ma_coc: resolvedMaCoc || null,
    loai_coc: ensuredTemplate?.loai_coc || cleanedPayload.header.loai_coc,
    do_ngoai: cleanedPayload.header.do_ngoai,
    chieu_day: cleanedPayload.header.chieu_day,
    mac_be_tong: cleanedPayload.header.mac_be_tong,
    ghi_chu: buildStoredBocNote(cleanedPayload.header.ten_boc_tach, nextMeta),
    loai_thep: cleanedPayload.header.loai_thep,
    phuong_thuc_van_chuyen: null,
    trang_thai: nextStatus,
    to_hop_doan: cleanedPayload.segments.map((segment) => ({
      ...segment,
      template_id: resolvedTemplateId || segment.template_id || '',
      ma_coc: resolvedMaCoc,
      cap_phoi_variant: cleanedPayload.header.cap_phoi_variant,
      kg_md: cleanedPayload.header.kg_md,
      loai_thep: cleanedPayload.header.loai_thep,
      pc_dia_mm: cleanedPayload.header.pc_dia_mm,
      pc_nos: cleanedPayload.header.pc_nos,
      dai_dia_mm: cleanedPayload.header.dai_dia_mm,
      buoc_dia_mm: cleanedPayload.header.buoc_dia_mm,
      dtam_mm: cleanedPayload.header.dtam_mm,
      sigma_cu: cleanedPayload.header.sigma_cu,
      sigma_pu: cleanedPayload.header.sigma_pu,
      sigma_py: cleanedPayload.header.sigma_py,
      r: cleanedPayload.header.r,
      k: cleanedPayload.header.k,
      ep: cleanedPayload.header.ep,
      md_per_trip_input: cleanedPayload.header.md_per_trip_input,
      phuong_thuc_van_chuyen: cleanedPayload.header.phuong_thuc_van_chuyen,
      don_gia_van_chuyen: cleanedPayload.header.don_gia_van_chuyen,
      mat_bich_nvl_id: selectedAccessories.mat_bich?.nvl_id || '',
      mat_bich_label: selectedAccessories.mat_bich?.ten_nvl || '',
      mang_xong_nvl_id: selectedAccessories.mang_xong?.nvl_id || '',
      mang_xong_label: selectedAccessories.mang_xong?.ten_nvl || '',
      mui_coc_nvl_id: selectedAccessories.mui_coc?.nvl_id || '',
      mui_coc_label: selectedAccessories.mui_coc?.ten_nvl || '',
      tap_nvl_id: selectedAccessories.tap?.nvl_id || '',
      tap_label: selectedAccessories.tap?.ten_nvl || '',
    })),
    tong_gia_nvl: preview.tong_gia_nvl,
    tong_gia_pk: preview.tong_gia_pk,
    phi_van_chuyen: preview.van_chuyen.phi_van_chuyen,
    tong_du_toan: preview.tong_du_toan,
  }

  if (action === 'send') {
    headerPayload.gui_qlsx_at = new Date().toISOString()
    headerPayload.gui_qlsx_by = userId
  }
  if (action === 'approve') {
    headerPayload.duyet_qlsx_at = new Date().toISOString()
    headerPayload.duyet_qlsx_by = userId
  }
  if (action === 'return') {
    headerPayload.tra_lai_qlsx_at = new Date().toISOString()
    headerPayload.tra_lai_qlsx_by = userId
  }

  let savedHeader: Record<string, unknown> | null = null
  let headerId = cleanedPayload.bocId ?? ''
  let headerIdField = existing.idField

  if (!existing.row) {
    const { data, error } = await executeHeaderInsertWithFallback(supabase, {
      ...headerPayload,
      created_by: userId,
    })
    if (error) throw new Error(toErrorMessage(error))
    savedHeader = (data ?? null) as Record<string, unknown> | null

    if (!savedHeader) {
      throw new Error('Khong tao duoc header boc_tach_nvl')
    }

    for (const candidate of HEADER_ID_CANDIDATES) {
      if (savedHeader[candidate] !== undefined && savedHeader[candidate] !== null) {
        headerId = String(savedHeader[candidate])
        headerIdField = candidate
        break
      }
    }
  } else {
    const { data, error } = await executeHeaderUpdateWithFallback(
      supabase,
      existing.idField,
      cleanedPayload.bocId ?? '',
      {
        ...headerPayload,
        updated_by: userId,
      }
    )
    if (error) throw new Error(toErrorMessage(error))
    savedHeader = (data ?? null) as Record<string, unknown> | null
    headerId = cleanedPayload.bocId ?? ''
  }

  if (!headerId) {
    throw new Error('Khong xac dinh duoc ID header sau khi luu')
  }

  const shouldSyncChildren = action === 'save'
  if (nextStatus !== 'HUY' && shouldSyncChildren) {
    const segParentField = await resolveCanonicalChildParentField(
      supabase,
      'boc_tach_seg_nvl'
    )

    await deleteChildRowsByAllParentFields(supabase, 'boc_tach_seg_nvl', headerId)

    if (cleanedPayload.segments.length > 0) {
      const rows = cleanedPayload.segments.map((seg, index) => {
        const snapshot = preview.segment_snapshots[index]

        return {
        boc_id: headerId,
        [segParentField]: headerId,
        ten_doan: seg.ten_doan,
        so_luong_doan: seg.so_luong_doan,
        the_tich_m3: seg.the_tich_m3,
        created_by: userId,
        dinh_muc_nvl: {
          len_m: seg.len_m,
          cnt: seg.cnt,
          v1: seg.v1,
          v2: seg.v2,
          v3: seg.v3,
          mui_segments: seg.mui_segments,
          dai_kep_chi_a1: seg.dai_kep_chi_a1,
          loai_thep: cleanedPayload.header.loai_thep,
          pc_dia_mm: cleanedPayload.header.pc_dia_mm,
          pc_nos: cleanedPayload.header.pc_nos,
          dai_dia_mm: cleanedPayload.header.dai_dia_mm,
          buoc_dia_mm: cleanedPayload.header.buoc_dia_mm,
          dtam_mm: cleanedPayload.header.dtam_mm,
          sigma_cu: cleanedPayload.header.sigma_cu,
          sigma_pu: cleanedPayload.header.sigma_pu,
          sigma_py: cleanedPayload.header.sigma_py,
          r: cleanedPayload.header.r,
          k: cleanedPayload.header.k,
          ep: cleanedPayload.header.ep,
          cap_phoi_variant: cleanedPayload.header.cap_phoi_variant,
          kg_md: cleanedPayload.header.kg_md,
          md_per_trip_input: cleanedPayload.header.md_per_trip_input,
          phuong_thuc_van_chuyen: cleanedPayload.header.phuong_thuc_van_chuyen,
          don_gia_van_chuyen: cleanedPayload.header.don_gia_van_chuyen,
          mat_bich_nvl_id: selectedAccessories.mat_bich?.nvl_id || '',
          mat_bich_label: selectedAccessories.mat_bich?.ten_nvl || '',
          mang_xong_nvl_id: selectedAccessories.mang_xong?.nvl_id || '',
          mang_xong_label: selectedAccessories.mang_xong?.ten_nvl || '',
          mui_coc_nvl_id: selectedAccessories.mui_coc?.nvl_id || '',
          mui_coc_label: selectedAccessories.mui_coc?.ten_nvl || '',
          tap_nvl_id: selectedAccessories.tap?.nvl_id || '',
          tap_label: selectedAccessories.tap?.ten_nvl || '',
          a1_mm: seg.a1_mm ?? 0,
          a2_mm: seg.a2_mm ?? 0,
          a3_mm: seg.a3_mm ?? 0,
          p1_pct: seg.p1_pct ?? 0,
          p2_pct: seg.p2_pct ?? 0,
          p3_pct: seg.p3_pct ?? 0,
          don_kep_factor: seg.don_kep_factor ?? 1,
        },
        tong_nvl: {
          concrete: snapshot?.concrete_m3 ?? 0,
          pc: snapshot?.pc_kg ?? 0,
          dai: snapshot?.dai_kg ?? 0,
          v1: snapshot?.v1 ?? 0,
          v2: snapshot?.v2 ?? 0,
          v3: snapshot?.v3 ?? 0,
          tong_vong_dai: snapshot?.tong_vong_dai ?? 0,
          thep_buoc: snapshot?.thep_buoc_kg ?? 0,
          mat_bich: snapshot?.mat_bich ?? 0,
          mang_xong: snapshot?.mang_xong ?? 0,
          mui_coc: snapshot?.mui_coc ?? 0,
          tap: snapshot?.tap ?? 0,
          tong_phu_kien: snapshot?.tong_phu_kien ?? 0,
          cap_phoi_items: snapshot?.cap_phoi_items ?? [],
          auxiliary_items: snapshot?.auxiliary_items ?? [],
        },
      }
      })
      const { error } = await executeChildInsertWithFallback(
        supabase,
        'boc_tach_seg_nvl',
        rows
      )
      if (error) throw new Error(toErrorMessage(error))
    }
  }

  let donHang: Record<string, unknown> | null = null
  if (nextStatus === 'DA_GUI') {
    donHang = (await createDonHangFromBocTach(
      supabase,
      headerId,
      userId,
      savedHeader
    )) as Record<string, unknown>
  }

  return {
    header: savedHeader,
    idField: headerIdField,
    headerId,
    preview,
    donHang,
  }
}

'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getAuthenticatedClientAndUser, getCurrentSessionProfile } from '@/lib/auth/session'
import { softDeleteRowWithFallback, updateRowWithFallback } from '@/lib/master-data/mutation-helpers'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

const BASE_PATH = '/master-data/dm-thue-loi-nhuan'

function redirectWithError(message: string) {
  redirect(`${BASE_PATH}?err=${encodeURIComponent(message)}`)
}

function redirectWithMessage(message: string) {
  revalidatePath(BASE_PATH)
  redirect(`${BASE_PATH}?msg=${encodeURIComponent(message)}`)
}

function parseNumber(input: FormDataEntryValue | null) {
  const raw = String(input ?? '').trim()
  if (!raw) return 0
  const normalized = raw.replace(/[,\s]/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

function isMissingRelationError(message: string) {
  return /relation .* does not exist/i.test(message) || /Could not find the table ['"]public\.[a-zA-Z0-9_]+['"] in the schema cache/i.test(message)
}

export async function saveDmThueVatAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_thue_loi_nhuan')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const cocVatPct = parseNumber(formData.get('coc_vat_pct'))
  const phuKienVatPct = parseNumber(formData.get('phu_kien_vat_pct'))

  const { data: rows, error } = await supabase.from('dm_thue_vat').select('*').limit(20)
  if (error) redirectWithError(isMissingRelationError(error.message) ? 'Chưa khởi tạo bảng dm_thue_vat.' : error.message)

  const currentRows = (rows ?? []) as Array<Record<string, unknown>>

  for (const item of [
    { loai_ap_dung: 'COC', vat_pct: cocVatPct },
    { loai_ap_dung: 'PHU_KIEN', vat_pct: phuKienVatPct },
  ]) {
    const existing = currentRows.find(
      (row) => String(row.loai_ap_dung ?? '').trim().toUpperCase() === item.loai_ap_dung
    )

    if (existing?.vat_id) {
      const updateResult = await updateRowWithFallback(supabase as never, 'dm_thue_vat', 'vat_id', existing.vat_id, {
        loai_ap_dung: item.loai_ap_dung,
        vat_pct: item.vat_pct,
        updated_by: user.id,
        is_active: true,
        deleted_at: null,
      })
      if (updateResult.error) redirectWithError(updateResult.error.message)
      continue
    }

    let insertResult = await supabase.from('dm_thue_vat').insert({
      loai_ap_dung: item.loai_ap_dung,
      vat_pct: item.vat_pct,
      is_active: true,
      deleted_at: null,
      created_by: user.id,
    })

    if (insertResult.error && insertResult.error.message.includes(`'created_by'`)) {
      insertResult = await supabase.from('dm_thue_vat').insert({
        loai_ap_dung: item.loai_ap_dung,
        vat_pct: item.vat_pct,
        is_active: true,
        deleted_at: null,
      })
    }

    if (insertResult.error) redirectWithError(insertResult.error.message)
  }

  redirectWithMessage('Lưu cấu hình VAT thành công')
}

export async function createDmBienLoiNhuanAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_thue_loi_nhuan')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const duongKinhMm = parseNumber(formData.get('duong_kinh_mm'))
  const payloadRaw = String(formData.get('items_json') ?? '[]')

  let items: Array<{ id?: string; min_md: string; loi_nhuan_pct: string }> = []
  try {
    items = JSON.parse(payloadRaw) as Array<{ id?: string; min_md: string; loi_nhuan_pct: string }>
  } catch {
    redirectWithError('Dữ liệu lợi nhuận không hợp lệ.')
  }

  if (duongKinhMm <= 0) {
    redirectWithError('Cần chọn đường kính cọc.')
  }

  const normalizedItems = items
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      min_md: parseNumber(item.min_md),
      loi_nhuan_pct: parseNumber(item.loi_nhuan_pct),
    }))
    .filter((item) => item.min_md >= 0 && item.loi_nhuan_pct > 0)

  if (normalizedItems.length === 0) {
    redirectWithError('Cần thêm ít nhất 1 dòng lợi nhuận hợp lệ.')
  }

  const duplicateKeys = new Set<string>()
  for (const item of normalizedItems) {
    const key = `${duongKinhMm}::${item.min_md}`
    if (duplicateKeys.has(key)) {
      redirectWithError('Mỗi mốc MD từ chỉ được xuất hiện 1 lần trong cùng đường kính.')
    }
    duplicateKeys.add(key)
  }

  const { data: existingRows, error } = await supabase
    .from('dm_bien_loi_nhuan')
    .select('*')
    .eq('is_active', true)
    .limit(1000)

  if (error) redirectWithError(isMissingRelationError(error.message) ? 'Chưa khởi tạo bảng dm_bien_loi_nhuan.' : error.message)

  const existing = (existingRows ?? []) as Array<Record<string, unknown>>

  for (const item of normalizedItems) {
    const conflict = existing.find(
      (row) =>
        Number(row.duong_kinh_mm ?? 0) === duongKinhMm &&
        Number(row.min_md ?? 0) === item.min_md &&
        row.is_active !== false
    )
    if (conflict) {
      redirectWithError(`Đã tồn tại rule cho D${duongKinhMm} từ ${item.min_md} md.`)
    }
  }

  for (const item of normalizedItems) {
    let insertResult = await supabase.from('dm_bien_loi_nhuan').insert({
      duong_kinh_mm: duongKinhMm,
      min_md: item.min_md,
      loi_nhuan_pct: item.loi_nhuan_pct,
      is_active: true,
      deleted_at: null,
      created_by: user.id,
    })

    if (insertResult.error && insertResult.error.message.includes(`'created_by'`)) {
      insertResult = await supabase.from('dm_bien_loi_nhuan').insert({
        duong_kinh_mm: duongKinhMm,
        min_md: item.min_md,
        loi_nhuan_pct: item.loi_nhuan_pct,
        is_active: true,
        deleted_at: null,
      })
    }

    if (insertResult.error) redirectWithError(insertResult.error.message)
  }

  redirectWithMessage('Lưu rule lợi nhuận thành công')
}

export async function updateDmBienLoiNhuanAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_thue_loi_nhuan')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const currentDiameter = parseNumber(formData.get('current_duong_kinh_mm'))
  const duongKinhMm = parseNumber(formData.get('duong_kinh_mm'))
  const payloadRaw = String(formData.get('items_json') ?? '[]')

  let items: Array<{ id?: string; min_md: string; loi_nhuan_pct: string }> = []
  try {
    items = JSON.parse(payloadRaw) as Array<{ id?: string; min_md: string; loi_nhuan_pct: string }>
  } catch {
    redirectWithError('Dữ liệu lợi nhuận không hợp lệ.')
  }

  if (currentDiameter <= 0) redirectWithError('Thiếu đường kính cần cập nhật.')
  if (duongKinhMm <= 0) redirectWithError('Cần nhập đường kính cọc.')

  const { data: existingRows, error } = await supabase
    .from('dm_bien_loi_nhuan')
    .select('*')
    .eq('is_active', true)
    .limit(1000)

  if (error) redirectWithError(error.message)

  const normalizedItems = items
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      min_md: parseNumber(item.min_md),
      loi_nhuan_pct: parseNumber(item.loi_nhuan_pct),
    }))
    .filter((item) => item.min_md >= 0 && item.loi_nhuan_pct > 0)

  if (normalizedItems.length === 0) {
    redirectWithError('Cần thêm ít nhất 1 dòng lợi nhuận hợp lệ.')
  }

  const duplicateKeys = new Set<string>()
  for (const item of normalizedItems) {
    const key = `${duongKinhMm}::${item.min_md}`
    if (duplicateKeys.has(key)) {
      redirectWithError('Mỗi mốc MD từ chỉ được xuất hiện 1 lần trong cùng đường kính.')
    }
    duplicateKeys.add(key)
  }

  const rows = (existingRows ?? []) as Array<Record<string, unknown>>
  const currentRows = rows.filter(
    (row) => Number(row.duong_kinh_mm ?? 0) === currentDiameter && row.is_active !== false
  )
  const currentRowIds = new Set(currentRows.map((row) => String(row.rule_id ?? '')))
  const otherRows = rows.filter(
    (row) =>
      Number(row.duong_kinh_mm ?? 0) === duongKinhMm &&
      !currentRowIds.has(String(row.rule_id ?? '')) &&
      row.is_active !== false
  )

  for (const item of normalizedItems) {
    const conflict = otherRows.find((row) => Number(row.min_md ?? 0) === item.min_md)
    if (conflict) {
      redirectWithError(`Đã tồn tại rule cho D${duongKinhMm} từ ${item.min_md} md.`)
    }
  }

  const currentRowsMap = new Map(currentRows.map((row) => [String(row.rule_id ?? ''), row]))
  const submittedIds = new Set(normalizedItems.map((item) => item.id).filter(Boolean))

  for (const row of currentRows) {
    const rowId = String(row.rule_id ?? '')
    if (!submittedIds.has(rowId)) {
      const removeResult = await softDeleteRowWithFallback(supabase as never, {
        tableName: 'dm_bien_loi_nhuan',
        keyField: 'rule_id',
        keyValue: row.rule_id,
        userId: user.id,
      })
      if (removeResult.error) redirectWithError(removeResult.error.message)
    }
  }

  for (const item of normalizedItems) {
    const payload = {
      duong_kinh_mm: duongKinhMm,
      min_md: item.min_md,
      loi_nhuan_pct: item.loi_nhuan_pct,
      updated_by: user.id,
    }

    if (item.id && currentRowsMap.has(item.id)) {
      const updateResult = await updateRowWithFallback(
        supabase as never,
        'dm_bien_loi_nhuan',
        'rule_id',
        item.id,
        payload
      )
      if (updateResult.error) redirectWithError(updateResult.error.message)
      continue
    }

    let insertResult = await supabase.from('dm_bien_loi_nhuan').insert({
      ...payload,
      is_active: true,
      deleted_at: null,
      created_by: user.id,
    })

    if (insertResult.error && insertResult.error.message.includes(`'created_by'`)) {
      insertResult = await supabase.from('dm_bien_loi_nhuan').insert({
        duong_kinh_mm: duongKinhMm,
        min_md: item.min_md,
        loi_nhuan_pct: item.loi_nhuan_pct,
        is_active: true,
        deleted_at: null,
      })
    }

    if (insertResult.error) redirectWithError(insertResult.error.message)
  }

  redirectWithMessage('Cập nhật rule lợi nhuận thành công')
}

export async function deleteDmBienLoiNhuanAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'dm_thue_loi_nhuan')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const ruleId = String(formData.get('rule_id') ?? '').trim()

  if (!ruleId) redirectWithError('Thiếu rule lợi nhuận.')

  const result = await softDeleteRowWithFallback(supabase as never, {
    tableName: 'dm_bien_loi_nhuan',
    keyField: 'rule_id',
    keyValue: ruleId,
    userId: user.id,
  })

  if (result.error) redirectWithError(result.error.message)

  redirectWithMessage('Xóa rule lợi nhuận thành công')
}

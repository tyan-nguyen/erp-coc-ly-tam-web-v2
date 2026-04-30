'use server'

import { redirect } from 'next/navigation'
import { getAuthenticatedClientAndUser, getCurrentSessionProfile } from '@/lib/auth/session'
import {
  buildAccessoryName,
  buildSteelName,
} from '@/lib/master-data/nvl'
import { softDeleteRowWithFallback } from '@/lib/master-data/mutation-helpers'
import { getNvlUsageMessage } from '@/lib/master-data/reference-guards'
import { assertMasterDataAccess } from '@/lib/master-data/permissions'

const BASE_PATH = '/master-data/nvl'

function redirectWithError(message: string) {
  redirect(`${BASE_PATH}?err=${encodeURIComponent(message)}`)
}

function redirectWithMessage(message: string) {
  redirect(`${BASE_PATH}?msg=${encodeURIComponent(message)}`)
}

function redirectWithMessageAndQuery(message: string, query: string) {
  const params = new URLSearchParams({
    msg: message,
  })
  if (query.trim()) {
    params.set('q', query.trim())
  }
  redirect(`${BASE_PATH}?${params.toString()}`)
}

function isRlsError(message: string | null | undefined) {
  return String(message || '').toLowerCase().includes('row-level security policy')
}

function parseNumber(input: FormDataEntryValue | null) {
  const raw = String(input ?? '').trim()
  if (!raw) return 0
  const normalized = raw.replace(/[,\s]/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

function parsePercentage(input: FormDataEntryValue | null) {
  const value = parseNumber(input)
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

export async function createNvlAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'nvl')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const nhomHang = String(formData.get('nhom_hang') ?? '').trim()
  const phuKienKind = String(formData.get('phu_kien_kind') ?? '').trim()
  const thepKind = String(formData.get('thep_kind') ?? '').trim()
  const ngangMm = parseNumber(formData.get('ngang_mm'))
  const rongMm = parseNumber(formData.get('rong_mm'))
  const dayMm = parseNumber(formData.get('day_mm'))
  const soLo = parseNumber(formData.get('so_lo'))
  const duongKinhMm = parseNumber(formData.get('duong_kinh_mm'))
  const isAccessory = nhomHang === 'PHU_KIEN'
  const isSteel = nhomHang === 'THEP'
  const tenHang = isAccessory
    ? buildAccessoryName(phuKienKind, { ngangMm, rongMm, dayMm, soLo })
    : isSteel
      ? buildSteelName(thepKind, duongKinhMm)
    : String(formData.get('ten_hang') ?? '').trim()
  const dvt = isAccessory ? 'cái' : isSteel ? 'kg' : String(formData.get('dvt') ?? '').trim()
  const donGia = parseNumber(formData.get('don_gia'))
  const haoHutPct = parsePercentage(formData.get('hao_hut_pct'))

  if (!tenHang) redirectWithError('Cần nhập tên hàng.')
  if (!dvt) redirectWithError('Cần nhập đơn vị tính.')
  if (!nhomHang) redirectWithError('Cần chọn nhóm hàng.')
  if (isAccessory && !phuKienKind) redirectWithError('Cần chọn loại phụ kiện.')
  if (isSteel && !thepKind) redirectWithError('Cần chọn loại thép.')

  if (isAccessory || isSteel) {
    const duplicateQueries = await Promise.all([
      supabase.from('nvl').select('nvl_id, ten_hang').ilike('ten_hang', tenHang).limit(1),
    ])

    for (const result of duplicateQueries) {
      if (result.error) {
        redirectWithError(result.error.message)
      }
      if ((result.data ?? []).length > 0) {
        redirectWithError(`${isAccessory ? 'Phụ kiện' : 'NVL thép'} đã tồn tại: ${tenHang}`)
      }
    }
  }

  const payload: Record<string, unknown> = {
    ten_hang: tenHang,
    dvt,
    nhom_hang: nhomHang,
    hao_hut_pct: haoHutPct,
    is_active: true,
    deleted_at: null,
    created_by: user.id,
  }

  let insert = await supabase.from('nvl').insert(payload).select('nvl_id').single()
  if (insert.error && insert.error.message.includes(`'created_by'`)) {
    insert = await supabase
      .from('nvl')
      .insert({
        ten_hang: tenHang,
        dvt,
        nhom_hang: nhomHang,
        hao_hut_pct: haoHutPct,
        is_active: true,
        deleted_at: null,
      })
      .select('nvl_id')
      .single()
  }

  const insertedRow = insert.data

  if (insert.error || !insertedRow?.nvl_id) {
    if (isRlsError(insert.error?.message)) {
      redirectWithError('DB đang chặn quyền tạo NVL. Cần chạy patch `sql/nvl_master_data_rls_patch_dev.sql` cho bảng `nvl` và `gia_nvl`.')
    }
    if (insert.error?.message.includes('hao_hut_pct')) {
      redirectWithError('DB chưa có cột % hao hụt. Cần chạy patch `sql/nvl_hao_hut_pct_patch_dev.sql` trước.')
    }
    redirectWithError(insert.error?.message || 'Không tạo được NVL.')
  }

  const nvlId = insertedRow?.nvl_id ? String(insertedRow.nvl_id) : ''
  if (!nvlId) {
    redirectWithError('Không tạo được NVL.')
  }
  const pricePayload = {
    nvl_id: nvlId,
    don_gia: donGia,
    dvt,
    created_by: user.id,
  }

  let priceInsert = await supabase.from('gia_nvl').insert(pricePayload)
  if (priceInsert.error && priceInsert.error.message.includes(`'created_by'`)) {
    priceInsert = await supabase.from('gia_nvl').insert({
      nvl_id: nvlId,
      don_gia: donGia,
      dvt,
    })
  }

  if (priceInsert.error) {
    if (isRlsError(priceInsert.error.message)) {
      redirectWithError('Tạo được NVL nhưng DB đang chặn quyền ghi đơn giá. Cần chạy patch `sql/nvl_master_data_rls_patch_dev.sql` cho bảng `gia_nvl`.')
    }
    redirectWithError(priceInsert.error.message)
  }

  redirectWithMessageAndQuery('Tạo NVL thành công', tenHang)
}

export async function updateNvlAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'nvl')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const nvlId = String(formData.get('nvl_id') ?? '').trim()
  const tenHang = String(formData.get('ten_hang') ?? '').trim()
  const dvt = String(formData.get('dvt') ?? '').trim()
  const nhomHang = String(formData.get('nhom_hang') ?? '').trim()
  const haoHutPct = parsePercentage(formData.get('hao_hut_pct'))

  if (!nvlId) redirectWithError('Thiếu mã nội bộ NVL.')
  if (!tenHang) redirectWithError('Cần nhập tên hàng.')
  if (!dvt) redirectWithError('Cần nhập đơn vị tính.')
  if (!nhomHang) redirectWithError('Cần chọn nhóm hàng.')

  const usageMessage = await getNvlUsageMessage(supabase as never, nvlId)
  if (usageMessage) {
    const { data: currentRow, error: currentError } = await supabase
      .from('nvl')
      .select('ten_hang, dvt, nhom_hang, hao_hut_pct')
      .eq('nvl_id', nvlId)
      .limit(1)
      .single()

    if (currentError) {
      redirectWithError(currentError.message)
    }

    if (
      String(currentRow?.dvt ?? '').trim() !== dvt ||
      String(currentRow?.nhom_hang ?? '').trim().toUpperCase() !== nhomHang.toUpperCase()
    ) {
      redirectWithError(usageMessage)
    }
  }

  let updateNvl = await supabase
    .from('nvl')
    .update({
      ten_hang: tenHang,
      dvt,
      nhom_hang: nhomHang,
      hao_hut_pct: haoHutPct,
      updated_by: user.id,
    })
    .eq('nvl_id', nvlId)

  if (updateNvl.error && updateNvl.error.message.includes(`'updated_by'`)) {
    updateNvl = await supabase
      .from('nvl')
      .update({
        ten_hang: tenHang,
        dvt,
        nhom_hang: nhomHang,
        hao_hut_pct: haoHutPct,
      })
      .eq('nvl_id', nvlId)
  }

  if (updateNvl.error) {
    if (isRlsError(updateNvl.error.message)) {
      redirectWithError('DB đang chặn quyền cập nhật NVL. Cần chạy patch `sql/nvl_master_data_rls_patch_dev.sql` cho bảng `nvl`.')
    }
    if (updateNvl.error.message.includes('hao_hut_pct')) {
      redirectWithError('DB chưa có cột % hao hụt. Cần chạy patch `sql/nvl_hao_hut_pct_patch_dev.sql` trước.')
    }
    redirectWithError(updateNvl.error.message)
  }

  redirectWithMessage('Cập nhật NVL thành công')
}

export async function deleteNvlAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'nvl')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const nvlId = String(formData.get('nvl_id') ?? '').trim()

  if (!nvlId) redirectWithError('Thiếu mã nội bộ NVL.')

  const usageMessage = await getNvlUsageMessage(supabase as never, nvlId)
  if (usageMessage) {
    redirectWithError(usageMessage)
  }

  const result = await softDeleteRowWithFallback(supabase as never, {
    tableName: 'nvl',
    keyField: 'nvl_id',
    keyValue: nvlId,
    userId: user.id,
  })

  if (result.error) {
    redirectWithError(result.error.message)
  }

  redirectWithMessage('Xóa NVL thành công')
}

export async function bulkDeleteNvlAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'nvl')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const nvlIds = formData
    .getAll('nvl_id')
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)

  if (nvlIds.length === 0) redirectWithError('Chưa chọn NVL để xóa.')

  for (const nvlId of nvlIds) {
    const usageMessage = await getNvlUsageMessage(supabase as never, nvlId)
    if (usageMessage) {
      redirectWithError(usageMessage)
    }

    const result = await softDeleteRowWithFallback(supabase as never, {
      tableName: 'nvl',
      keyField: 'nvl_id',
      keyValue: nvlId,
      userId: user.id,
    })

    if (result.error) {
      redirectWithError(result.error.message)
    }
  }

  redirectWithMessage(`Đã xóa ${nvlIds.length} NVL.`)
}

export async function createNvlPriceAction(formData: FormData) {
  const { profile } = await getCurrentSessionProfile()
  assertMasterDataAccess(profile.role, 'gia_nvl')
  const { supabase, user } = await getAuthenticatedClientAndUser()
  const nvlId = String(formData.get('nvl_id') ?? '').trim()
  const dvt = String(formData.get('dvt') ?? '').trim()
  const donGia = parseNumber(formData.get('don_gia'))

  if (!nvlId) redirectWithError('Thiếu mã nội bộ NVL.')
  if (!dvt) redirectWithError('Thiếu đơn vị tính.')

  let insertPrice = await supabase.from('gia_nvl').insert({
    nvl_id: nvlId,
    don_gia: donGia,
    dvt,
    created_by: user.id,
  })

  if (insertPrice.error && insertPrice.error.message.includes(`'created_by'`)) {
    insertPrice = await supabase.from('gia_nvl').insert({
      nvl_id: nvlId,
      don_gia: donGia,
      dvt,
    })
  }

  if (insertPrice.error) {
    redirectWithError(insertPrice.error.message)
  }

  redirectWithMessage('Đã thêm giá mới')
}

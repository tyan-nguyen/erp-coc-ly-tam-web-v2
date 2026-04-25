-- Reset cac danh muc master-data de nhap lai tu dau.
-- CHI DUNG khi du lieu hien tai chi la du lieu test.
--
-- Script nay:
-- 1) abort neu da co du lieu module/downstream de tranh xoa nham master-data dang duoc su dung
-- 2) xoa du lieu trong cac danh muc:
--    - Khach hang
--    - Du an
--    - Nha cung cap
--    - Khu vuc ton (giu lai cac khu he thong mac dinh)
--    - Nguyen vat lieu + gia NVL
--    - Loai coc mau
--    - Dinh muc phu
--    - Cap phoi be tong
--    - Thue VAT + Bien loi nhuan
--    - Chi phi khac / md
--
-- CAC KHU VUC TON MAC DINH DUOC GIU LAI:
-- - CHO_QC
-- - KHO_THANH_PHAM
-- - KHU_LOI

do $$
declare
  v_count integer := 0;
  v_reserved_codes text[] := array['CHO_QC', 'KHO_THANH_PHAM', 'KHU_LOI'];
begin
  -- Abort neu da co du lieu module/downstream.
  if to_regclass('public.boc_tach_nvl') is not null then
    select count(*) into v_count from public.boc_tach_nvl where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % boc_tach_nvl active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.bao_gia') is not null then
    select count(*) into v_count from public.bao_gia where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % bao_gia active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.don_hang') is not null then
    select count(*) into v_count from public.don_hang where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % don_hang active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.ke_hoach_sx_ngay') is not null then
    select count(*) into v_count from public.ke_hoach_sx_ngay where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % ke_hoach_sx_ngay active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.phieu_xuat_ban') is not null then
    select count(*) into v_count from public.phieu_xuat_ban where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % phieu_xuat_ban active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.sx_xuat_nvl') is not null then
    select count(*) into v_count from public.sx_xuat_nvl where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % sx_xuat_nvl active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.sx_qc_nghiem_thu') is not null then
    select count(*) into v_count from public.sx_qc_nghiem_thu where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % sx_qc_nghiem_thu active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.production_lot') is not null then
    select count(*) into v_count from public.production_lot where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % production_lot active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  if to_regclass('public.pile_serial') is not null then
    select count(*) into v_count from public.pile_serial where coalesce(is_active, true) = true;
    if coalesce(v_count, 0) > 0 then
      raise exception 'Dang co % pile_serial active. Hay reset/xoa du lieu module truoc khi reset master-data.', v_count;
    end if;
  end if;

  raise notice '=== Bat dau reset master-data test ===';

  -- Con/phat sinh xoa truoc.
  if to_regclass('public.dm_duan') is not null then
    delete from public.dm_duan;
    raise notice 'Deleted dm_duan';
  end if;

  if to_regclass('public.gia_nvl') is not null then
    delete from public.gia_nvl;
    raise notice 'Deleted gia_nvl';
  end if;

  if to_regclass('public.dm_dinh_muc_phu_md') is not null then
    delete from public.dm_dinh_muc_phu_md;
    raise notice 'Deleted dm_dinh_muc_phu_md';
  end if;

  if to_regclass('public.dm_capphoi_bt') is not null then
    delete from public.dm_capphoi_bt;
    raise notice 'Deleted dm_capphoi_bt';
  end if;

  if to_regclass('public.dm_chi_phi_khac_md') is not null then
    delete from public.dm_chi_phi_khac_md;
    raise notice 'Deleted dm_chi_phi_khac_md';
  end if;

  if to_regclass('public.dm_bien_loi_nhuan') is not null then
    delete from public.dm_bien_loi_nhuan;
    raise notice 'Deleted dm_bien_loi_nhuan';
  end if;

  if to_regclass('public.dm_thue_vat') is not null then
    delete from public.dm_thue_vat;
    raise notice 'Deleted dm_thue_vat';
  end if;

  if to_regclass('public.dm_coc_template') is not null then
    delete from public.dm_coc_template;
    raise notice 'Deleted dm_coc_template';
  end if;

  if to_regclass('public.nvl') is not null then
    delete from public.nvl;
    raise notice 'Deleted nvl';
  end if;

  if to_regclass('public.dm_ncc') is not null then
    delete from public.dm_ncc;
    raise notice 'Deleted dm_ncc';
  end if;

  if to_regclass('public.dm_kh') is not null then
    delete from public.dm_kh;
    raise notice 'Deleted dm_kh';
  end if;

  -- Khu vuc ton: giu lai cac khu he thong.
  if to_regclass('public.warehouse_location') is not null then
    update public.warehouse_location
    set parent_location_id = null
    where upper(trim(coalesce(location_code, ''))) <> all (v_reserved_codes);

    delete from public.warehouse_location
    where upper(trim(coalesce(location_code, ''))) <> all (v_reserved_codes);

    raise notice 'Deleted non-reserved warehouse_location rows';
  end if;

  raise notice '=== Da reset xong master-data test ===';
end $$;

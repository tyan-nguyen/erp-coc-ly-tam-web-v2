-- Bootstrap toi thieu cho project test: nhom master-data.
-- Muc tieu:
-- 1) Tao cac bang danh muc co ban neu DB test chua co.
-- 2) Them cac cot app dang doc/ghi trong cac man master-data.
-- 3) Grant cho authenticated va tat RLS de test nhanh, tranh loop policy.
--
-- Luu y:
-- - Day la script cho moi truong test/dev, khong phai migration production.
-- - Script nay CHUA dung du tat ca schema nghiep vu. No chi phuc vu nhom danh muc.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at_if_column_exists()
returns trigger
language plpgsql
as $$
begin
  if row_to_json(new) ? 'updated_at' then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

create table if not exists public.dm_kh (
  kh_id uuid primary key default gen_random_uuid(),
  ma_kh text null,
  ten_kh text not null,
  nhom_kh text not null default 'TIEM_NANG',
  sdt text null,
  so_dien_thoai text null,
  dien_thoai text null,
  lien_he text null,
  nguoi_lien_he text null,
  email text null,
  mst text null,
  dia_chi text null,
  ghi_chu text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_duan (
  da_id uuid primary key default gen_random_uuid(),
  ma_da text null,
  ma_duan text null,
  ten_da text not null,
  kh_id uuid null,
  vi_tri_cong_trinh text null,
  dia_chi_cong_trinh text null,
  dia_diem text null,
  khu_vuc text null,
  ghi_chu text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_ncc (
  ncc_id uuid primary key default gen_random_uuid(),
  ma_ncc text null,
  ten_ncc text not null,
  loai_ncc text not null default 'PHU_KIEN',
  nguoi_lien_he text null,
  sdt text null,
  so_dien_thoai text null,
  dien_thoai text null,
  email text null,
  dia_chi text null,
  ghi_chu text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.nvl (
  nvl_id uuid primary key default gen_random_uuid(),
  ma_nvl text null,
  ten_hang text not null,
  dvt text not null,
  nhom_hang text not null,
  hao_hut_pct numeric(10,3) not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.gia_nvl (
  gia_nvl_id uuid primary key default gen_random_uuid(),
  nvl_id uuid not null,
  don_gia numeric(18,2) not null default 0,
  dvt text not null default 'kg',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_coc_template (
  template_id uuid primary key default gen_random_uuid(),
  ma_coc text null,
  ma_coc_template text null,
  loai_coc text not null,
  mac_be_tong text not null default 'B40',
  do_ngoai numeric(10,3) not null default 600,
  chieu_day numeric(10,3) not null default 100,
  chieu_dai_m numeric(10,3) null,
  cuong_do text null,
  mac_thep text null,
  template_scope text null,
  khoi_luong_kg_md numeric(18,3) null,
  pc_nvl_id uuid null,
  dai_nvl_id uuid null,
  buoc_nvl_id uuid null,
  mat_bich_nvl_id uuid null,
  mang_xong_nvl_id uuid null,
  tap_nvl_id uuid null,
  mui_coc_nvl_id uuid null,
  pc_label text null,
  dai_label text null,
  buoc_label text null,
  pc_dia_mm numeric(10,3) null,
  pc_nos numeric(10,3) null,
  dai_dia_mm numeric(10,3) null,
  buoc_dia_mm numeric(10,3) null,
  a1_mm numeric(10,3) null,
  a2_mm numeric(10,3) null,
  a3_mm numeric(10,3) null,
  p1_pct numeric(10,3) null,
  p2_pct numeric(10,3) null,
  p3_pct numeric(10,3) null,
  don_kep_factor numeric(10,3) null,
  dtam_mm numeric(10,3) null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_dinh_muc_phu_md (
  dm_id uuid primary key default gen_random_uuid(),
  nvl_id uuid not null,
  nhom_d text not null,
  dvt text not null default 'kg',
  dinh_muc numeric(18,6) not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_capphoi_bt (
  cp_id uuid primary key default gen_random_uuid(),
  nvl_id uuid not null,
  mac_be_tong text not null,
  dinh_muc_m3 numeric(18,6) not null default 0,
  dvt text not null default 'kg',
  variant text null,
  ghi_chu text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_thue_vat (
  vat_id uuid primary key default gen_random_uuid(),
  loai_ap_dung text not null,
  vat_pct numeric(10,3) not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_bien_loi_nhuan (
  rule_id uuid primary key default gen_random_uuid(),
  duong_kinh_mm numeric(10,3) not null,
  min_md numeric(18,3) not null default 0,
  loi_nhuan_pct numeric(10,3) not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.dm_chi_phi_khac_md (
  cost_id uuid primary key default gen_random_uuid(),
  item_name text not null,
  dvt text not null default 'vnd/md',
  duong_kinh_mm numeric(10,3) not null,
  chi_phi_vnd_md numeric(18,2) not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create table if not exists public.warehouse_location (
  location_id uuid primary key default gen_random_uuid(),
  location_code text not null,
  location_name text null,
  location_type text not null default 'STORAGE',
  parent_location_id uuid null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dm_kh add column if not exists ma_kh text null;
alter table public.dm_kh add column if not exists ten_kh text null;
alter table public.dm_kh add column if not exists nhom_kh text not null default 'TIEM_NANG';
alter table public.dm_kh add column if not exists sdt text null;
alter table public.dm_kh add column if not exists so_dien_thoai text null;
alter table public.dm_kh add column if not exists dien_thoai text null;
alter table public.dm_kh add column if not exists lien_he text null;
alter table public.dm_kh add column if not exists nguoi_lien_he text null;
alter table public.dm_kh add column if not exists email text null;
alter table public.dm_kh add column if not exists mst text null;
alter table public.dm_kh add column if not exists dia_chi text null;
alter table public.dm_kh add column if not exists ghi_chu text null;
alter table public.dm_kh add column if not exists is_active boolean not null default true;
alter table public.dm_kh add column if not exists deleted_at timestamptz null;
alter table public.dm_kh add column if not exists created_at timestamptz not null default now();
alter table public.dm_kh add column if not exists updated_at timestamptz not null default now();
alter table public.dm_kh add column if not exists created_by uuid null;
alter table public.dm_kh add column if not exists updated_by uuid null;

alter table public.dm_duan add column if not exists ma_da text null;
alter table public.dm_duan add column if not exists ma_duan text null;
alter table public.dm_duan add column if not exists ten_da text null;
alter table public.dm_duan add column if not exists kh_id uuid null;
alter table public.dm_duan add column if not exists vi_tri_cong_trinh text null;
alter table public.dm_duan add column if not exists dia_chi_cong_trinh text null;
alter table public.dm_duan add column if not exists dia_diem text null;
alter table public.dm_duan add column if not exists khu_vuc text null;
alter table public.dm_duan add column if not exists ghi_chu text null;
alter table public.dm_duan add column if not exists is_active boolean not null default true;
alter table public.dm_duan add column if not exists deleted_at timestamptz null;
alter table public.dm_duan add column if not exists created_at timestamptz not null default now();
alter table public.dm_duan add column if not exists updated_at timestamptz not null default now();
alter table public.dm_duan add column if not exists created_by uuid null;
alter table public.dm_duan add column if not exists updated_by uuid null;

alter table public.dm_ncc add column if not exists ma_ncc text null;
alter table public.dm_ncc add column if not exists ten_ncc text null;
alter table public.dm_ncc add column if not exists loai_ncc text not null default 'PHU_KIEN';
alter table public.dm_ncc add column if not exists nguoi_lien_he text null;
alter table public.dm_ncc add column if not exists sdt text null;
alter table public.dm_ncc add column if not exists so_dien_thoai text null;
alter table public.dm_ncc add column if not exists dien_thoai text null;
alter table public.dm_ncc add column if not exists email text null;
alter table public.dm_ncc add column if not exists dia_chi text null;
alter table public.dm_ncc add column if not exists ghi_chu text null;
alter table public.dm_ncc add column if not exists is_active boolean not null default true;
alter table public.dm_ncc add column if not exists deleted_at timestamptz null;
alter table public.dm_ncc add column if not exists created_at timestamptz not null default now();
alter table public.dm_ncc add column if not exists updated_at timestamptz not null default now();
alter table public.dm_ncc add column if not exists created_by uuid null;
alter table public.dm_ncc add column if not exists updated_by uuid null;

alter table public.nvl add column if not exists ma_nvl text null;
alter table public.nvl add column if not exists ten_hang text null;
alter table public.nvl add column if not exists dvt text null;
alter table public.nvl add column if not exists nhom_hang text null;
alter table public.nvl add column if not exists hao_hut_pct numeric(10,3) not null default 0;
alter table public.nvl add column if not exists is_active boolean not null default true;
alter table public.nvl add column if not exists deleted_at timestamptz null;
alter table public.nvl add column if not exists created_at timestamptz not null default now();
alter table public.nvl add column if not exists updated_at timestamptz not null default now();
alter table public.nvl add column if not exists created_by uuid null;
alter table public.nvl add column if not exists updated_by uuid null;

alter table public.gia_nvl add column if not exists nvl_id uuid null;
alter table public.gia_nvl add column if not exists don_gia numeric(18,2) not null default 0;
alter table public.gia_nvl add column if not exists dvt text not null default 'kg';
alter table public.gia_nvl add column if not exists created_at timestamptz not null default now();
alter table public.gia_nvl add column if not exists updated_at timestamptz not null default now();
alter table public.gia_nvl add column if not exists created_by uuid null;
alter table public.gia_nvl add column if not exists updated_by uuid null;

alter table public.dm_coc_template add column if not exists ma_coc text null;
alter table public.dm_coc_template add column if not exists ma_coc_template text null;
alter table public.dm_coc_template add column if not exists loai_coc text null;
alter table public.dm_coc_template add column if not exists mac_be_tong text null;
alter table public.dm_coc_template add column if not exists do_ngoai numeric(10,3) null;
alter table public.dm_coc_template add column if not exists chieu_day numeric(10,3) null;
alter table public.dm_coc_template add column if not exists chieu_dai_m numeric(10,3) null;
alter table public.dm_coc_template add column if not exists cuong_do text null;
alter table public.dm_coc_template add column if not exists mac_thep text null;
alter table public.dm_coc_template add column if not exists template_scope text null;
alter table public.dm_coc_template add column if not exists khoi_luong_kg_md numeric(18,3) null;
alter table public.dm_coc_template add column if not exists pc_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists dai_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists buoc_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists mat_bich_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists mang_xong_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists tap_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists mui_coc_nvl_id uuid null;
alter table public.dm_coc_template add column if not exists pc_label text null;
alter table public.dm_coc_template add column if not exists dai_label text null;
alter table public.dm_coc_template add column if not exists buoc_label text null;
alter table public.dm_coc_template add column if not exists pc_dia_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists pc_nos numeric(10,3) null;
alter table public.dm_coc_template add column if not exists dai_dia_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists buoc_dia_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists a1_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists a2_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists a3_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists p1_pct numeric(10,3) null;
alter table public.dm_coc_template add column if not exists p2_pct numeric(10,3) null;
alter table public.dm_coc_template add column if not exists p3_pct numeric(10,3) null;
alter table public.dm_coc_template add column if not exists don_kep_factor numeric(10,3) null;
alter table public.dm_coc_template add column if not exists dtam_mm numeric(10,3) null;
alter table public.dm_coc_template add column if not exists is_active boolean not null default true;
alter table public.dm_coc_template add column if not exists deleted_at timestamptz null;
alter table public.dm_coc_template add column if not exists created_at timestamptz not null default now();
alter table public.dm_coc_template add column if not exists updated_at timestamptz not null default now();
alter table public.dm_coc_template add column if not exists created_by uuid null;
alter table public.dm_coc_template add column if not exists updated_by uuid null;

alter table public.dm_dinh_muc_phu_md add column if not exists nvl_id uuid null;
alter table public.dm_dinh_muc_phu_md add column if not exists nhom_d text null;
alter table public.dm_dinh_muc_phu_md add column if not exists dvt text null;
alter table public.dm_dinh_muc_phu_md add column if not exists dinh_muc numeric(18,6) not null default 0;
alter table public.dm_dinh_muc_phu_md add column if not exists is_active boolean not null default true;
alter table public.dm_dinh_muc_phu_md add column if not exists deleted_at timestamptz null;
alter table public.dm_dinh_muc_phu_md add column if not exists created_at timestamptz not null default now();
alter table public.dm_dinh_muc_phu_md add column if not exists updated_at timestamptz not null default now();
alter table public.dm_dinh_muc_phu_md add column if not exists created_by uuid null;
alter table public.dm_dinh_muc_phu_md add column if not exists updated_by uuid null;

alter table public.dm_capphoi_bt add column if not exists nvl_id uuid null;
alter table public.dm_capphoi_bt add column if not exists mac_be_tong text null;
alter table public.dm_capphoi_bt add column if not exists dinh_muc_m3 numeric(18,6) not null default 0;
alter table public.dm_capphoi_bt add column if not exists dvt text null;
alter table public.dm_capphoi_bt add column if not exists variant text null;
alter table public.dm_capphoi_bt add column if not exists ghi_chu text null;
alter table public.dm_capphoi_bt add column if not exists is_active boolean not null default true;
alter table public.dm_capphoi_bt add column if not exists deleted_at timestamptz null;
alter table public.dm_capphoi_bt add column if not exists created_at timestamptz not null default now();
alter table public.dm_capphoi_bt add column if not exists updated_at timestamptz not null default now();
alter table public.dm_capphoi_bt add column if not exists created_by uuid null;
alter table public.dm_capphoi_bt add column if not exists updated_by uuid null;

alter table public.dm_thue_vat add column if not exists loai_ap_dung text null;
alter table public.dm_thue_vat add column if not exists vat_pct numeric(10,3) not null default 0;
alter table public.dm_thue_vat add column if not exists is_active boolean not null default true;
alter table public.dm_thue_vat add column if not exists deleted_at timestamptz null;
alter table public.dm_thue_vat add column if not exists created_at timestamptz not null default now();
alter table public.dm_thue_vat add column if not exists updated_at timestamptz not null default now();
alter table public.dm_thue_vat add column if not exists created_by uuid null;
alter table public.dm_thue_vat add column if not exists updated_by uuid null;

alter table public.dm_bien_loi_nhuan add column if not exists duong_kinh_mm numeric(10,3) null;
alter table public.dm_bien_loi_nhuan add column if not exists min_md numeric(18,3) not null default 0;
alter table public.dm_bien_loi_nhuan add column if not exists loi_nhuan_pct numeric(10,3) not null default 0;
alter table public.dm_bien_loi_nhuan add column if not exists is_active boolean not null default true;
alter table public.dm_bien_loi_nhuan add column if not exists deleted_at timestamptz null;
alter table public.dm_bien_loi_nhuan add column if not exists created_at timestamptz not null default now();
alter table public.dm_bien_loi_nhuan add column if not exists updated_at timestamptz not null default now();
alter table public.dm_bien_loi_nhuan add column if not exists created_by uuid null;
alter table public.dm_bien_loi_nhuan add column if not exists updated_by uuid null;

alter table public.dm_chi_phi_khac_md add column if not exists item_name text null;
alter table public.dm_chi_phi_khac_md add column if not exists dvt text null;
alter table public.dm_chi_phi_khac_md add column if not exists duong_kinh_mm numeric(10,3) null;
alter table public.dm_chi_phi_khac_md add column if not exists chi_phi_vnd_md numeric(18,2) not null default 0;
alter table public.dm_chi_phi_khac_md add column if not exists sort_order integer not null default 0;
alter table public.dm_chi_phi_khac_md add column if not exists is_active boolean not null default true;
alter table public.dm_chi_phi_khac_md add column if not exists deleted_at timestamptz null;
alter table public.dm_chi_phi_khac_md add column if not exists created_at timestamptz not null default now();
alter table public.dm_chi_phi_khac_md add column if not exists updated_at timestamptz not null default now();
alter table public.dm_chi_phi_khac_md add column if not exists created_by uuid null;
alter table public.dm_chi_phi_khac_md add column if not exists updated_by uuid null;

alter table public.warehouse_location add column if not exists location_code text null;
alter table public.warehouse_location add column if not exists location_name text null;
alter table public.warehouse_location add column if not exists location_type text not null default 'STORAGE';
alter table public.warehouse_location add column if not exists parent_location_id uuid null;
alter table public.warehouse_location add column if not exists is_active boolean not null default true;
alter table public.warehouse_location add column if not exists created_at timestamptz not null default now();
alter table public.warehouse_location add column if not exists updated_at timestamptz not null default now();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dm_kh',
    'dm_duan',
    'dm_ncc',
    'nvl',
    'gia_nvl',
    'dm_coc_template',
    'dm_dinh_muc_phu_md',
    'dm_capphoi_bt',
    'dm_thue_vat',
    'dm_bien_loi_nhuan',
    'dm_chi_phi_khac_md',
    'warehouse_location'
  ]
  loop
    execute format('drop trigger if exists trg_%I_set_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger trg_%I_set_updated_at before update on public.%I for each row execute function public.set_updated_at_if_column_exists()',
      table_name,
      table_name
    );
  end loop;
end $$;

create unique index if not exists dm_kh_ma_kh_active_idx
  on public.dm_kh (ma_kh) where is_active = true and ma_kh is not null;

create unique index if not exists dm_duan_ma_da_active_idx
  on public.dm_duan (ma_da) where is_active = true and ma_da is not null;

create unique index if not exists dm_ncc_ma_ncc_active_idx
  on public.dm_ncc (ma_ncc) where is_active = true and ma_ncc is not null;

create unique index if not exists warehouse_location_code_active_idx
  on public.warehouse_location (location_code) where is_active = true;

create unique index if not exists dm_coc_template_ma_coc_active_idx
  on public.dm_coc_template (ma_coc) where is_active = true and ma_coc is not null;

grant usage on schema public to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'dm_kh',
    'dm_duan',
    'dm_ncc',
    'nvl',
    'gia_nvl',
    'dm_coc_template',
    'dm_dinh_muc_phu_md',
    'dm_capphoi_bt',
    'dm_thue_vat',
    'dm_bien_loi_nhuan',
    'dm_chi_phi_khac_md',
    'warehouse_location'
  ]
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
      execute format('alter table public.%I disable row level security', table_name);
    end if;
  end loop;
end $$;

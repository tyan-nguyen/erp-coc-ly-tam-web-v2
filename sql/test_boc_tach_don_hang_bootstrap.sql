-- Bootstrap toi thieu cho project test: boc tach + don hang.
-- Muc tieu:
-- 1) Tao cac bang toi thieu de man Boc tach / Don hang / Bao gia khong bi vo ngay vi thieu relation.
-- 2) Grant cho authenticated va tat RLS de test nhanh.
--
-- Luu y:
-- - Day la bootstrap cho moi truong test/dev, KHONG phai migration production.
-- - Cac cot ben duoi uu tien de app doc/ghi duoc, khong co tham vong cover 100% production schema.

create extension if not exists pgcrypto;

create table if not exists public.boc_tach_nvl (
  boc_id uuid primary key default gen_random_uuid(),
  da_id uuid null,
  kh_id uuid null,
  ma_coc text null,
  loai_coc text not null default '',
  do_ngoai numeric(12,3) not null default 0,
  chieu_day numeric(12,3) not null default 0,
  mac_be_tong text not null default '',
  ghi_chu text null,
  loai_thep text null,
  phuong_thuc_van_chuyen text null,
  trang_thai text not null default 'NHAP',
  to_hop_doan jsonb not null default '[]'::jsonb,
  tong_gia_nvl numeric(18,2) not null default 0,
  tong_gia_pk numeric(18,2) not null default 0,
  phi_van_chuyen numeric(18,2) not null default 0,
  tong_du_toan numeric(18,2) not null default 0,
  gui_qlsx_at timestamptz null,
  gui_qlsx_by uuid null,
  duyet_qlsx_at timestamptz null,
  duyet_qlsx_by uuid null,
  tra_lai_qlsx_at timestamptz null,
  tra_lai_qlsx_by uuid null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create index if not exists boc_tach_nvl_active_idx
  on public.boc_tach_nvl (is_active, created_at desc);

create index if not exists boc_tach_nvl_project_idx
  on public.boc_tach_nvl (da_id, kh_id);

create table if not exists public.boc_tach_nvl_items (
  item_id uuid primary key default gen_random_uuid(),
  boc_id uuid not null references public.boc_tach_nvl(boc_id) on delete cascade,
  nvl_id uuid null,
  ten_nvl text not null default '',
  loai_nvl text not null default '',
  so_luong numeric(18,6) not null default 0,
  dvt text not null default '',
  don_gia numeric(18,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create index if not exists boc_tach_nvl_items_boc_idx
  on public.boc_tach_nvl_items (boc_id);

create index if not exists boc_tach_nvl_items_nvl_idx
  on public.boc_tach_nvl_items (nvl_id);

create table if not exists public.boc_tach_seg_nvl (
  seg_id uuid primary key default gen_random_uuid(),
  boc_id uuid not null references public.boc_tach_nvl(boc_id) on delete cascade,
  ten_doan text not null default '',
  so_luong_doan numeric(18,6) not null default 0,
  the_tich_m3 numeric(18,6) not null default 0,
  dinh_muc_nvl jsonb not null default '{}'::jsonb,
  tong_nvl jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create index if not exists boc_tach_seg_nvl_boc_idx
  on public.boc_tach_seg_nvl (boc_id);

create table if not exists public.don_hang (
  order_id uuid primary key default gen_random_uuid(),
  ma_order text null,
  ma_don_hang text null,
  boc_id uuid null references public.boc_tach_nvl(boc_id) on delete set null,
  boc_tach_id uuid null,
  boc_tach_nvl_id uuid null,
  da_id uuid null,
  kh_id uuid null,
  loai_coc text not null default '',
  do_ngoai numeric(12,3) not null default 0,
  mac_be_tong text not null default '',
  to_hop_doan jsonb not null default '[]'::jsonb,
  trang_thai text not null default 'NHAP',
  trang_thai_label text null,
  gia_ban_goc numeric(18,2) null,
  ty_le_giam_gia numeric(10,3) null,
  ly_do_giam_gia text null,
  gia_ban_sau_giam numeric(18,2) null,
  giam_gia_yeu_cau_at timestamptz null,
  giam_gia_yeu_cau_by uuid null,
  giam_gia_duyet_at timestamptz null,
  giam_gia_duyet_by uuid null,
  ngay_yeu_cau_giao date null,
  ngay_du_kien_hoan date null,
  ghi_chu text null,
  is_active boolean not null default true,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create index if not exists don_hang_active_idx
  on public.don_hang (is_active, created_at desc);

create index if not exists don_hang_boc_idx
  on public.don_hang (boc_id);

create table if not exists public.don_hang_trang_thai_log (
  log_id bigint generated always as identity primary key,
  order_id uuid not null,
  from_state text null,
  to_state text null,
  changed_by uuid null,
  changed_by_role text null,
  changed_at timestamptz not null default now(),
  ghi_chu text null
);

create index if not exists don_hang_trang_thai_log_order_idx
  on public.don_hang_trang_thai_log (order_id, changed_at desc);

create table if not exists public.don_hang_state_machine (
  transition_id bigint generated always as identity primary key,
  from_state text not null,
  to_state text not null,
  actor_roles text[] null,
  mo_ta text null
);

create unique index if not exists don_hang_state_machine_unique_idx
  on public.don_hang_state_machine (from_state, to_state);

insert into public.don_hang_state_machine (from_state, to_state, actor_roles, mo_ta)
values
  ('NHAP', 'DA_DUYET', array['admin','kinh doanh','ktmh'], 'Duyệt đơn hàng'),
  ('DA_DUYET', 'NHAP', array['admin','kinh doanh','ktmh'], 'Chuyển lùi về nháp'),
  ('DA_DUYET', 'DA_LEN_KE_HOACH', array['admin','qlsx'], 'Lên kế hoạch sản xuất'),
  ('DA_LEN_KE_HOACH', 'DA_DUYET', array['admin','qlsx'], 'Mở ngược từ kế hoạch')
on conflict do nothing;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.boc_tach_nvl to authenticated;
grant select, insert, update, delete on public.boc_tach_nvl_items to authenticated;
grant select, insert, update, delete on public.boc_tach_seg_nvl to authenticated;
grant select, insert, update, delete on public.don_hang to authenticated;
grant select, insert, update, delete on public.don_hang_trang_thai_log to authenticated;
grant select, insert, update, delete on public.don_hang_state_machine to authenticated;

alter table public.boc_tach_nvl disable row level security;
alter table public.boc_tach_nvl_items disable row level security;
alter table public.boc_tach_seg_nvl disable row level security;
alter table public.don_hang disable row level security;
alter table public.don_hang_trang_thai_log disable row level security;
alter table public.don_hang_state_machine disable row level security;

notify pgrst, 'reload schema';

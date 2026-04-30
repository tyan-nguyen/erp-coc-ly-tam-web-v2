-- DEV patch: align RLS for master-data NVL editing with app permissions.
-- Apply in SQL editor when users can open /master-data/nvl but INSERT/UPDATE is blocked by RLS.
--
-- App-level access for NVL master-data currently allows:
-- - Admin
-- - Kỹ thuật
-- - Kế toán mua hàng / mua hàng
--
-- This patch adds permissive write policies for:
-- - public.nvl
-- - public.gia_nvl
--
-- It does not change page-level app permissions; it only makes DB policy match them.

alter table if exists public.nvl enable row level security;
alter table if exists public.gia_nvl enable row level security;

drop policy if exists p_nvl_master_data_write on public.nvl;
create policy p_nvl_master_data_write
on public.nvl
for all
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and coalesce(up.is_active, false) = true
      and upper(replace(replace(coalesce(up.role, ''), ' ', '_'), '-', '_')) in (
        'ADMIN',
        'KY_THUAT',
        'KTMH',
        'KE_TOAN_MUA_HANG',
        'MUA_HANG',
        'PURCHASING'
      )
  )
)
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and coalesce(up.is_active, false) = true
      and upper(replace(replace(coalesce(up.role, ''), ' ', '_'), '-', '_')) in (
        'ADMIN',
        'KY_THUAT',
        'KTMH',
        'KE_TOAN_MUA_HANG',
        'MUA_HANG',
        'PURCHASING'
      )
  )
);

drop policy if exists p_gia_nvl_master_data_write on public.gia_nvl;
create policy p_gia_nvl_master_data_write
on public.gia_nvl
for all
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and coalesce(up.is_active, false) = true
      and upper(replace(replace(coalesce(up.role, ''), ' ', '_'), '-', '_')) in (
        'ADMIN',
        'KY_THUAT',
        'KTMH',
        'KE_TOAN_MUA_HANG',
        'MUA_HANG',
        'PURCHASING'
      )
  )
)
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and coalesce(up.is_active, false) = true
      and upper(replace(replace(coalesce(up.role, ''), ' ', '_'), '-', '_')) in (
        'ADMIN',
        'KY_THUAT',
        'KTMH',
        'KE_TOAN_MUA_HANG',
        'MUA_HANG',
        'PURCHASING'
      )
  )
);

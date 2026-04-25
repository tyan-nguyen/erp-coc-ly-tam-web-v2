create or replace function public.reopen_warehouse_issue_voucher_atomic(
  p_plan_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher public.sx_xuat_nvl%rowtype;
  v_actor_role text := '';
  v_actor_active boolean := false;
  v_qc_count integer := 0;
  v_lot_count integer := 0;
  v_serial_count integer := 0;
  v_deleted_movement_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Bạn chưa đăng nhập để thực hiện thao tác này.';
  end if;

  if auth.uid() is distinct from p_user_id then
    raise exception 'Không hợp lệ: user thực thi không khớp với user được truyền vào.';
  end if;

  select coalesce(role, ''), coalesce(is_active, false)
  into v_actor_role, v_actor_active
  from public.user_profiles
  where user_id = p_user_id;

  if not coalesce(v_actor_active, false) then
    raise exception 'Không xác định được user profile hoạt động.';
  end if;

  if lower(trim(v_actor_role)) <> 'admin' then
    raise exception 'Chỉ Admin mới được mở lại phiếu thực sản xuất và xuất NVL.';
  end if;

  select *
  into v_voucher
  from public.sx_xuat_nvl
  where plan_id = p_plan_id
    and is_active = true
  order by updated_at desc nulls last, created_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu thực sản xuất và xuất NVL để mở lại.';
  end if;

  if to_regclass('public.sx_qc_nghiem_thu') is not null then
    select count(*)
    into v_qc_count
    from public.sx_qc_nghiem_thu
    where plan_id = p_plan_id
      and is_active = true;
  end if;

  select count(*)
  into v_lot_count
  from public.production_lot
  where warehouse_issue_voucher_id = v_voucher.voucher_id
    and is_active = true;

  select count(*)
  into v_serial_count
  from public.pile_serial
  where is_active = true
    and (
      warehouse_issue_voucher_id = v_voucher.voucher_id
      or lot_id in (
        select lot_id
        from public.production_lot
        where warehouse_issue_voucher_id = v_voucher.voucher_id
          and is_active = true
      )
    );

  if coalesce(v_qc_count, 0) > 0 then
    if to_regclass('public.system_audit_log') is not null then
      insert into public.system_audit_log (
        action,
        entity_type,
        entity_id,
        entity_code,
        actor_id,
        actor_role,
        summary_json,
        note
      )
      values (
        'REOPEN',
        'SX_XUAT_NVL',
        v_voucher.voucher_id::text,
        p_plan_id::text,
        p_user_id,
        v_actor_role,
        jsonb_build_object(
          'result', 'BLOCKED',
          'blocked_downstream_type', 'SX_QC_NGHIEM_THU',
          'blocked_downstream_count', v_qc_count,
          'reopened_from_status', 'DA_XAC_NHAN'
        ),
        'Đã có phiếu nghiệm thu QC downstream. Cần mở ngược QC trước khi mở lại phiếu thực sản xuất và xuất NVL.'
      );
    end if;

    raise exception 'Đã có phiếu nghiệm thu QC downstream. Cần mở ngược QC trước khi mở lại phiếu thực sản xuất và xuất NVL.';
  end if;

  if coalesce(v_lot_count, 0) > 0 then
    if to_regclass('public.system_audit_log') is not null then
      insert into public.system_audit_log (
        action,
        entity_type,
        entity_id,
        entity_code,
        actor_id,
        actor_role,
        summary_json,
        note
      )
      values (
        'REOPEN',
        'SX_XUAT_NVL',
        v_voucher.voucher_id::text,
        p_plan_id::text,
        p_user_id,
        v_actor_role,
        jsonb_build_object(
          'result', 'BLOCKED',
          'blocked_downstream_type', 'PRODUCTION_LOT',
          'blocked_downstream_count', v_lot_count,
          'reopened_from_status', 'DA_XAC_NHAN'
        ),
        'Đã phát sinh lô sản xuất downstream. Chưa hỗ trợ rollback sâu nên không được mở lại phiếu.'
      );
    end if;

    raise exception 'Đã phát sinh lô sản xuất downstream. Chưa hỗ trợ rollback sâu nên không được mở lại phiếu.';
  end if;

  if coalesce(v_serial_count, 0) > 0 then
    if to_regclass('public.system_audit_log') is not null then
      insert into public.system_audit_log (
        action,
        entity_type,
        entity_id,
        entity_code,
        actor_id,
        actor_role,
        summary_json,
        note
      )
      values (
        'REOPEN',
        'SX_XUAT_NVL',
        v_voucher.voucher_id::text,
        p_plan_id::text,
        p_user_id,
        v_actor_role,
        jsonb_build_object(
          'result', 'BLOCKED',
          'blocked_downstream_type', 'PILE_SERIAL',
          'blocked_downstream_count', v_serial_count,
          'reopened_from_status', 'DA_XAC_NHAN'
        ),
        'Đã phát sinh serial downstream. Chưa hỗ trợ rollback sâu nên không được mở lại phiếu.'
      );
    end if;

    raise exception 'Đã phát sinh serial downstream. Chưa hỗ trợ rollback sâu nên không được mở lại phiếu.';
  end if;

  if to_regclass('public.material_stock_movement') is not null then
    execute
      'delete from public.material_stock_movement
       where source_type = $1
         and source_id = $2'
    using 'PRODUCTION_ISSUE_VOUCHER', v_voucher.voucher_id;

    get diagnostics v_deleted_movement_count = row_count;
  end if;

  update public.sx_xuat_nvl
  set
    is_active = false,
    deleted_at = now(),
    updated_by = p_user_id,
    updated_at = now()
  where voucher_id = v_voucher.voucher_id
    and is_active = true;

  if to_regclass('public.system_audit_log') is not null then
    insert into public.system_audit_log (
      action,
      entity_type,
      entity_id,
      entity_code,
      actor_id,
      actor_role,
      before_json,
      after_json,
      summary_json,
      note
    )
    values (
      'REOPEN',
      'SX_XUAT_NVL',
      v_voucher.voucher_id::text,
      p_plan_id::text,
      p_user_id,
      v_actor_role,
      jsonb_build_object(
        'is_active', true,
        'reopened_from_status', 'DA_XAC_NHAN'
      ),
      jsonb_build_object(
        'is_active', false,
        'reopened_to_status', 'NHAP_LAI'
      ),
      jsonb_build_object(
        'result', 'REOPENED',
        'movement_deleted_count', coalesce(v_deleted_movement_count, 0),
        'blocked_downstream_type', null
      ),
      'Admin mở lại phiếu thực sản xuất và xuất NVL khi chưa có downstream phát sinh.'
    );
  end if;

  return jsonb_build_object(
    'voucherId', v_voucher.voucher_id,
    'deletedMovementCount', coalesce(v_deleted_movement_count, 0)
  );
end;
$$;

grant execute on function public.reopen_warehouse_issue_voucher_atomic(uuid, uuid)
to authenticated;

create or replace function public.reopen_shipment_voucher_atomic(
  p_voucher_id uuid,
  p_user_id uuid,
  p_payload_json jsonb,
  p_note text default null,
  p_ngay_thao_tac date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher public.phieu_xuat_ban%rowtype;
  v_return_count integer := 0;
  v_return_serial_count integer := 0;
  v_reverted_count integer := 0;
  v_actor_role text := '';
  v_actor_active boolean := false;
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
    raise exception 'Chỉ Admin mới được mở lại phiếu xuất hàng đã xác nhận.';
  end if;

  select *
  into v_voucher
  from public.phieu_xuat_ban
  where voucher_id = p_voucher_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu xuất hàng để mở lại.';
  end if;

  if v_voucher.trang_thai = 'CHO_XAC_NHAN' then
    raise exception 'Phiếu này đang ở trạng thái chờ xác nhận, không cần mở lại.';
  end if;

  select count(*)
  into v_return_count
  from public.return_voucher
  where shipment_voucher_id = p_voucher_id
    and is_active = true;

  select count(*)
  into v_return_serial_count
  from public.return_voucher_serial
  where shipment_voucher_id = p_voucher_id;

  if coalesce(v_return_count, 0) > 0 then
    if to_regclass('public.system_audit_log') is not null then
      insert into public.system_audit_log (
        action,
        entity_type,
        entity_id,
        actor_id,
        actor_role,
        summary_json,
        note
      )
      values (
        'REOPEN',
        'PHIEU_XUAT_BAN',
        p_voucher_id::text,
        p_user_id,
        v_actor_role,
        jsonb_build_object(
          'result', 'BLOCKED',
          'blocked_downstream_type', 'RETURN_VOUCHER',
          'blocked_downstream_count', v_return_count,
          'reopened_from_status', v_voucher.trang_thai
        ),
        'Phiếu này đã phát sinh phiếu trả hàng downstream. Cần rollback bước sau trước khi mở lại phiếu xuất.'
      );
    end if;

    raise exception 'Phiếu này đã phát sinh phiếu trả hàng downstream. Cần rollback bước sau trước khi mở lại phiếu xuất.';
  end if;

  if coalesce(v_return_serial_count, 0) > 0 then
    if to_regclass('public.system_audit_log') is not null then
      insert into public.system_audit_log (
        action,
        entity_type,
        entity_id,
        actor_id,
        actor_role,
        summary_json,
        note
      )
      values (
        'REOPEN',
        'PHIEU_XUAT_BAN',
        p_voucher_id::text,
        p_user_id,
        v_actor_role,
        jsonb_build_object(
          'result', 'BLOCKED',
          'blocked_downstream_type', 'RETURN_VOUCHER_SERIAL',
          'blocked_downstream_count', v_return_serial_count,
          'reopened_from_status', v_voucher.trang_thai
        ),
        'Phiếu này đã phát sinh serial trả hàng downstream. Cần rollback bước sau trước khi mở lại phiếu xuất.'
      );
    end if;

    raise exception 'Phiếu này đã phát sinh serial trả hàng downstream. Cần rollback bước sau trước khi mở lại phiếu xuất.';
  end if;

  insert into public.pile_serial_history (
    serial_id,
    event_type,
    from_lifecycle_status,
    to_lifecycle_status,
    from_qc_status,
    to_qc_status,
    from_disposition_status,
    to_disposition_status,
    from_location_id,
    to_location_id,
    ref_type,
    ref_id,
    note,
    changed_by
  )
  select
    ps.serial_id,
    'REOPENED_SHIPMENT',
    ps.lifecycle_status,
    'TRONG_KHO',
    ps.qc_status,
    ps.qc_status,
    ps.disposition_status,
    ps.disposition_status,
    ps.current_location_id,
    ps.current_location_id,
    'PHIEU_XUAT_BAN',
    p_voucher_id,
    'Admin mở lại phiếu xuất hàng đã xác nhận',
    p_user_id
  from public.pile_serial ps
  inner join public.shipment_voucher_serial svs
    on svs.serial_id = ps.serial_id
  where svs.voucher_id = p_voucher_id;

  get diagnostics v_reverted_count = row_count;

  update public.pile_serial
  set
    lifecycle_status = 'TRONG_KHO',
    current_shipment_voucher_id = null,
    updated_at = now()
  where serial_id in (
    select serial_id
    from public.shipment_voucher_serial
    where voucher_id = p_voucher_id
  );

  delete from public.shipment_voucher_serial
  where voucher_id = p_voucher_id;

  update public.phieu_xuat_ban
  set
    trang_thai = 'CHO_XAC_NHAN',
    ghi_chu = p_note,
    payload_json = coalesce(p_payload_json, '{}'::jsonb),
    updated_by = p_user_id,
    updated_at = now(),
    ngay_thao_tac = coalesce(p_ngay_thao_tac, current_date)
  where voucher_id = p_voucher_id;

  if to_regclass('public.system_audit_log') is not null then
    insert into public.system_audit_log (
      action,
      entity_type,
      entity_id,
      actor_id,
      actor_role,
      before_json,
      after_json,
      summary_json,
      note
    )
    values (
      'REOPEN',
      'PHIEU_XUAT_BAN',
      p_voucher_id::text,
      p_user_id,
      v_actor_role,
      jsonb_build_object(
        'reopened_from_status', v_voucher.trang_thai
      ),
      jsonb_build_object(
        'reopened_to_status', 'CHO_XAC_NHAN'
      ),
      jsonb_build_object(
        'result', 'REOPENED',
        'reverted_serial_count', coalesce(v_reverted_count, 0),
        'blocked_downstream_type', null
      ),
      'Admin mở lại phiếu xuất hàng đã xác nhận.'
    );
  end if;

  return coalesce(v_reverted_count, 0);
end;
$$;

grant execute on function public.reopen_shipment_voucher_atomic(uuid, uuid, jsonb, text, date)
to authenticated;

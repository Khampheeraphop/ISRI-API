create or replace function public.assign_incident_to_technician(
  p_incident_id uuid,
  p_primary_technician_id uuid,
  p_support_technician_ids uuid[],
  p_dispatcher_id uuid,
  p_urgency_verified public.incident_urgency
)
returns table (
  id uuid,
  incident_id uuid,
  technician_id uuid,
  status public.work_order_status,
  assigned_by uuid,
  assigned_at timestamptz,
  respond_due_at timestamptz,
  resolve_due_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents%rowtype;
  v_sla public.sla_rules%rowtype;
  v_order public.work_orders%rowtype;
  v_assigned_at timestamptz := now();
  v_support_ids uuid[] := coalesce(p_support_technician_ids, '{}'::uuid[]);
  v_all_technician_ids uuid[];
  v_required_specialty public.technician_specialty;
begin
  if not exists (
    select 1
    from public.profiles as dispatcher
    where dispatcher.id = p_dispatcher_id
      and dispatcher.approval_status = 'approved'
      and dispatcher.role = 'dispatcher'
  ) then
    raise exception 'Dispatcher access is required.';
  end if;

  if p_primary_technician_id is null
    or cardinality(v_support_ids) > 10
    or p_primary_technician_id = any(v_support_ids)
    or cardinality(v_support_ids) <> (
      select count(distinct selected.technician_id)
      from unnest(v_support_ids) as selected(technician_id)
    ) then
    raise exception 'Technician assignments are invalid.';
  end if;

  select incident.* into v_incident
  from public.incidents as incident
  where incident.id = p_incident_id
  for update;
  if not found or v_incident.status <> 'pending_assignment' then
    raise exception 'Incident is not available for assignment.';
  end if;

  v_required_specialty := case v_incident.category
    when 'ไฟฟ้า' then 'electrical'::public.technician_specialty
    when 'ประปา' then 'plumbing'::public.technician_specialty
    when 'เครื่องปรับอากาศ' then 'air_conditioning'::public.technician_specialty
    when 'ลิฟต์' then 'elevator'::public.technician_specialty
    when 'โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)' then 'building'::public.technician_specialty
    else null
  end;
  v_all_technician_ids := array_append(v_support_ids, p_primary_technician_id);

  if exists (
    select 1
    from unnest(v_all_technician_ids) as selected(technician_id)
    left join public.profiles as technician
      on technician.id = selected.technician_id
    where technician.id is null
      or technician.approval_status <> 'approved'
      or technician.role <> 'technician'
      or (
        v_required_specialty is not null
        and not (v_required_specialty = any(technician.technician_specialties))
      )
  ) then
    raise exception 'Technician specialty does not match the incident category.';
  end if;

  select rule.* into v_sla
  from public.sla_rules as rule
  where rule.urgency_level = p_urgency_verified;
  if not found then raise exception 'SLA rule was not configured.'; end if;

  update public.incidents as incident
  set urgency_verified = p_urgency_verified,
      urgency_verified_by = p_dispatcher_id,
      urgency_verified_at = v_assigned_at
  where incident.id = p_incident_id;

  insert into public.work_orders (
    incident_id, technician_id, assigned_by, assigned_at, status,
    respond_due_at, resolve_due_at, sla_point_value
  ) values (
    p_incident_id, p_primary_technician_id, p_dispatcher_id, v_assigned_at,
    'pending',
    v_incident.created_at + make_interval(mins => v_sla.response_minutes),
    v_incident.created_at + make_interval(mins => v_sla.resolve_minutes),
    v_sla.point_value
  ) returning * into v_order;

  insert into public.work_order_assignees (
    work_order_id, technician_id, assignment_role, assigned_at
  ) values (v_order.id, p_primary_technician_id, 'primary', v_assigned_at);

  insert into public.work_order_assignees (
    work_order_id, technician_id, assignment_role, assigned_at
  )
  select v_order.id, selected.technician_id, 'support', v_assigned_at
  from unnest(v_support_ids) as selected(technician_id);

  insert into public.notifications (user_id, type, message, related_incident_id)
  select selected.technician_id,
         'job_assigned',
         'คุณได้รับมอบหมายเป็นช่างสนับสนุน โปรดตรวจสอบรายละเอียดงาน',
         p_incident_id
  from unnest(v_support_ids) as selected(technician_id);

  insert into public.work_order_history (
    work_order_id, status, changed_by, changed_at, note, event_type, metadata
  ) values (
    v_order.id, 'pending', p_dispatcher_id, v_assigned_at,
    'ผู้จัดสรรยืนยันระดับความเร่งด่วนและมอบหมายทีมช่าง',
    'status_change',
    jsonb_build_object(
      'urgency_reported', v_incident.urgency_reported,
      'urgency_verified', p_urgency_verified,
      'sla_point_value', v_sla.point_value,
      'primary_technician_id', p_primary_technician_id,
      'support_technician_ids', to_jsonb(v_support_ids)
    )
  );

  return query select
    v_order.id, v_order.incident_id, v_order.technician_id, v_order.status,
    v_order.assigned_by, v_order.assigned_at, v_order.respond_due_at,
    v_order.resolve_due_at, v_order.created_at;
end;
$$;

revoke all on function public.assign_incident_to_technician(
  uuid, uuid, uuid[], uuid, public.incident_urgency
) from public, anon, authenticated;
grant execute on function public.assign_incident_to_technician(
  uuid, uuid, uuid[], uuid, public.incident_urgency
) to service_role;

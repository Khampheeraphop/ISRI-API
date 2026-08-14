create or replace function public.assign_incident_to_technician(
  p_incident_id uuid,
  p_technician_id uuid,
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
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = p_dispatcher_id
      and approval_status = 'approved' and role = 'dispatcher'
  ) then
    raise exception 'Dispatcher access is required.';
  end if;
  if not exists (
    select 1 from public.profiles
    where profiles.id = p_technician_id
      and approval_status = 'approved' and role = 'technician'
  ) then
    raise exception 'Technician was not found.';
  end if;

  select * into v_incident
  from public.incidents
  where incidents.id = p_incident_id
  for update;

  if not found or v_incident.status <> 'pending_assignment' then
    raise exception 'Incident is not available for assignment.';
  end if;

  select * into v_sla
  from public.sla_rules
  where urgency_level = p_urgency_verified;
  if not found then raise exception 'SLA rule was not configured.'; end if;

  update public.incidents
  set urgency_verified = p_urgency_verified,
      urgency_verified_by = p_dispatcher_id,
      urgency_verified_at = v_assigned_at
  where incidents.id = p_incident_id;

  insert into public.work_orders (
    incident_id, technician_id, assigned_by, assigned_at, status,
    respond_due_at, resolve_due_at
  ) values (
    p_incident_id, p_technician_id, p_dispatcher_id, v_assigned_at, 'pending',
    v_incident.created_at + make_interval(mins => v_sla.response_minutes),
    v_incident.created_at + make_interval(mins => v_sla.resolve_minutes)
  ) returning * into v_order;

  insert into public.work_order_history (
    work_order_id, status, changed_by, changed_at, note, event_type, metadata
  ) values (
    v_order.id, 'pending', p_dispatcher_id, v_assigned_at,
    'ผู้จัดสรรยืนยันระดับความเร่งด่วนและมอบหมายงาน',
    'status_change',
    jsonb_build_object(
      'urgency_reported', v_incident.urgency_reported,
      'urgency_verified', p_urgency_verified
    )
  );

  return query select
    v_order.id, v_order.incident_id, v_order.technician_id, v_order.status,
    v_order.assigned_by, v_order.assigned_at, v_order.respond_due_at,
    v_order.resolve_due_at, v_order.created_at;
end;
$$;

revoke all on function public.assign_incident_to_technician(
  uuid, uuid, uuid, public.incident_urgency
) from public, anon, authenticated;
grant execute on function public.assign_incident_to_technician(
  uuid, uuid, uuid, public.incident_urgency
) to service_role;

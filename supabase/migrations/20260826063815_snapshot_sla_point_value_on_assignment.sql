-- Lock the score together with the SLA deadlines at assignment time. A later
-- admin change must affect only future assignments, not a repair already in progress.
alter table public.work_orders
  add column sla_point_value integer;

update public.work_orders as work_order
set sla_point_value = sla_rule.point_value
from public.incidents as incident
join public.sla_rules as sla_rule
  on sla_rule.urgency_level = coalesce(
    incident.urgency_verified,
    incident.urgency_reported
  )
where work_order.incident_id = incident.id
  and work_order.sla_point_value is null;

alter table public.work_orders
  alter column sla_point_value set not null,
  add constraint work_orders_sla_point_value_check check (sla_point_value > 0);

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
    respond_due_at, resolve_due_at, sla_point_value
  ) values (
    p_incident_id, p_technician_id, p_dispatcher_id, v_assigned_at, 'pending',
    v_incident.created_at + make_interval(mins => v_sla.response_minutes),
    v_incident.created_at + make_interval(mins => v_sla.resolve_minutes),
    v_sla.point_value
  ) returning * into v_order;

  insert into public.work_order_history (
    work_order_id, status, changed_by, changed_at, note, event_type, metadata
  ) values (
    v_order.id, 'pending', p_dispatcher_id, v_assigned_at,
    'ผู้จัดสรรยืนยันระดับความเร่งด่วน มอบหมายงาน และล็อกเกณฑ์ SLA',
    'status_change',
    jsonb_build_object(
      'urgency_reported', v_incident.urgency_reported,
      'urgency_verified', p_urgency_verified,
      'sla_point_value', v_sla.point_value
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

create or replace function public.award_verified_incident_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer;
  v_awarded_at timestamptz := now();
begin
  if new.status <> 'done'::public.incident_status
    or old.status = 'done'::public.incident_status then
    return new;
  end if;

  if new.urgency_verified is null then
    raise exception 'Incident urgency must be verified before completion.';
  end if;

  if exists (
    select 1 from public.point_transactions
    where ref_incident_id = new.id
      and transaction_type = 'earn'::public.point_transaction_type
  ) then
    return new;
  end if;

  select work_order.sla_point_value
  into v_points
  from public.work_orders as work_order
  where work_order.incident_id = new.id;

  if v_points is null then
    raise exception 'Assigned SLA point value was not found for this incident.';
  end if;

  insert into public.point_wallets (user_id, balance, updated_at)
  values (new.reporter_id, v_points, v_awarded_at)
  on conflict (user_id) do update
    set balance = public.point_wallets.balance + excluded.balance,
        updated_at = excluded.updated_at;

  insert into public.point_transactions (
    user_id, amount, transaction_type, reason, ref_incident_id, created_at
  ) values (
    new.reporter_id, v_points, 'earn'::public.point_transaction_type,
    'ได้รับแต้มตามเกณฑ์ SLA ที่ล็อกไว้เมื่อผู้จัดสรรมอบหมายงาน',
    new.id, v_awarded_at
  );

  insert into public.campaign_scores (campaign_id, user_id, points, last_scored_at)
  select campaign.id, new.reporter_id, v_points, v_awarded_at
  from public.reward_campaigns campaign
  where campaign.status = 'active'::public.campaign_status
    and campaign.start_date <= v_awarded_at::date
    and campaign.end_date >= v_awarded_at::date
  on conflict (campaign_id, user_id) do update
    set points = public.campaign_scores.points + excluded.points,
        last_scored_at = excluded.last_scored_at;

  return new;
end;
$$;

revoke all on function public.award_verified_incident_points() from public, anon, authenticated;

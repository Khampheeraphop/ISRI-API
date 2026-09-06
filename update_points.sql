create or replace function public.award_verified_incident_points()
returns trigger
language plpgsql
security invoker
set search_path = ''
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
  where work_order.incident_id = new.id and work_order.status = 'done'
    and exists (select 1 from public.work_order_history h join public.profiles p on p.id = h.changed_by
      where h.work_order_id = work_order.id and h.status = 'done' and h.event_type = 'completion' and p.role = 'dispatcher');

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
    'ได้รับแต้มจากการแจ้งซ่อมสำเร็จ',
    new.id, v_awarded_at
  );

  insert into public.campaign_scores (campaign_id, user_id, points, last_scored_at)
  select campaign.id, new.reporter_id, v_points, v_awarded_at
  from public.reward_campaigns campaign
  where campaign.status = 'active'::public.campaign_status
    and campaign.start_date <= (v_awarded_at at time zone 'Asia/Bangkok')::date
    and campaign.end_date >= (v_awarded_at at time zone 'Asia/Bangkok')::date
  on conflict (campaign_id, user_id) do update
    set points = public.campaign_scores.points + excluded.points,
        last_scored_at = excluded.last_scored_at;

  return new;
end;
$$;

revoke all on function public.award_verified_incident_points() from public, anon, authenticated;

-- Update existing records
UPDATE public.point_transactions
SET reason = 'ได้รับแต้มจากการแจ้งซ่อมสำเร็จ'
WHERE reason LIKE '%ได้รับแต้มตามเกณฑ์ SLA%';

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

  if exists (
    select 1
    from public.point_transactions
    where ref_incident_id = new.id
      and transaction_type = 'earn'::public.point_transaction_type
  ) then
    return new;
  end if;

  v_points := case new.urgency_reported
    when 'critical' then 30
    when 'urgent' then 20
    else 10
  end;

  insert into public.point_wallets (user_id, balance, updated_at)
  values (new.reporter_id, v_points, v_awarded_at)
  on conflict (user_id) do update
    set balance = public.point_wallets.balance + excluded.balance,
        updated_at = excluded.updated_at;

  insert into public.point_transactions (
    user_id,
    amount,
    transaction_type,
    reason,
    ref_incident_id,
    created_at
  )
  values (
    new.reporter_id,
    v_points,
    'earn'::public.point_transaction_type,
    'ได้รับการยืนยันและดำเนินการแจ้งเหตุเสร็จสิ้น',
    new.id,
    v_awarded_at
  );

  insert into public.campaign_scores (
    campaign_id,
    user_id,
    points,
    last_scored_at
  )
  select
    campaign.id,
    new.reporter_id,
    v_points,
    v_awarded_at
  from public.reward_campaigns as campaign
  where campaign.status = 'active'::public.campaign_status
    and campaign.start_date <= v_awarded_at::date
    and campaign.end_date >= v_awarded_at::date
  on conflict (campaign_id, user_id) do update
    set points = public.campaign_scores.points + excluded.points,
        last_scored_at = excluded.last_scored_at;

  return new;
end;
$$;

drop trigger if exists incidents_award_verified_points on public.incidents;
create trigger incidents_award_verified_points
after update of status on public.incidents
for each row execute function public.award_verified_incident_points();

create or replace function public.finalize_expired_campaigns()
returns setof public.reward_campaigns
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.reward_campaigns
  set status = 'ended'::public.campaign_status,
      updated_at = now()
  where status = 'active'::public.campaign_status
    and end_date < current_date
  returning *;
end;
$$;

revoke all on function public.award_verified_incident_points() from public, anon, authenticated;
revoke all on function public.finalize_expired_campaigns() from public, anon, authenticated;
grant execute on function public.finalize_expired_campaigns() to service_role;

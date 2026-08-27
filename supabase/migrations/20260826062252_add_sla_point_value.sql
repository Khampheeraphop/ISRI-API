-- คะแนนเป็นส่วนหนึ่งของกฎ SLA เพื่อให้ผู้ดูแลระบบกำหนดได้ตามระดับความเร่งด่วน
-- โดยคะแนนจะถูกอ่านเมื่อปิดงาน ไม่ได้ผูกเป็นค่าตายตัวในแอปพลิเคชัน
alter table public.sla_rules
  add column point_value integer;

update public.sla_rules
set point_value = case urgency_level
  when 'critical' then 30
  when 'urgent' then 20
  when 'normal' then 10
end
where point_value is null;

alter table public.sla_rules
  alter column point_value set not null,
  add constraint sla_rules_point_value_check check (point_value > 0);

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

  select point_value
  into v_points
  from public.sla_rules
  where urgency_level = new.urgency_verified;

  if v_points is null then
    raise exception 'SLA point value was not configured for the verified urgency.';
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
    'ได้รับแต้มตามเกณฑ์ SLA ที่ผู้จัดสรรยืนยันและปิดงานแล้ว',
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

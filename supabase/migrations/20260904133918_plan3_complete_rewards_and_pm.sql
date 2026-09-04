-- Preserve the actual charge; never refund the current catalogue price.
alter table public.reward_redemptions
  add column if not exists point_cost integer,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id);

update public.reward_redemptions r
set point_cost = -t.amount
from public.point_transactions t
where r.point_cost is null and t.transaction_type = 'redeem'
  and t.user_id = r.user_id and t.ref_reward_item_id = r.reward_item_id
  and t.created_at = r.redeemed_at
  and (select count(*) from public.point_transactions candidate
    where candidate.transaction_type = 'redeem' and candidate.user_id = r.user_id
      and candidate.ref_reward_item_id = r.reward_item_id and candidate.created_at = r.redeemed_at) = 1;

-- Abort rather than guess a historical charge if reconciliation is ambiguous.
alter table public.reward_redemptions alter column point_cost set not null;
alter table public.reward_redemptions add constraint reward_redemptions_point_cost_positive check (point_cost > 0);
create index if not exists reward_redemptions_approved_by_idx on public.reward_redemptions(approved_by);
alter table public.reward_redemptions drop constraint reward_redemptions_state_check;
alter table public.reward_redemptions add constraint reward_redemptions_state_check check (
  (status = 'pending' and approved_at is null and approved_by is null and fulfilled_at is null and fulfilled_by is null and cancelled_at is null and cancelled_by is null)
  or (status = 'approved' and approved_at is not null and approved_by is not null and fulfilled_at is null and fulfilled_by is null and cancelled_at is null and cancelled_by is null)
  or (status = 'fulfilled' and fulfilled_at is not null and fulfilled_by is not null and cancelled_at is null and cancelled_by is null)
  or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and fulfilled_at is null and fulfilled_by is null)
);

alter table public.point_transactions add column if not exists ref_redemption_id uuid references public.reward_redemptions(id);
create unique index if not exists point_transactions_redemption_type_unique
  on public.point_transactions(ref_redemption_id, transaction_type) where ref_redemption_id is not null;
update public.point_transactions t set ref_redemption_id = r.id
from public.reward_redemptions r where t.transaction_type = 'redeem'
  and t.ref_redemption_id is null and t.user_id = r.user_id
  and t.ref_reward_item_id = r.reward_item_id and t.created_at = r.redeemed_at;

create or replace function public.redeem_reward(
  p_user_id uuid, p_reward_item_id uuid, p_fulfillment_method public.reward_fulfillment_method,
  p_recipient_name text, p_phone text, p_delivery_address text default null, p_requester_note text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_reward public.reward_items%rowtype;
  v_balance integer;
  v_redemption_id uuid;
  v_address text := nullif(trim(p_delivery_address), '');
  v_note text := nullif(trim(p_requester_note), '');
begin
  if not exists (select 1 from public.profiles where id = p_user_id and approval_status = 'approved' and role = 'reporter') then
    raise exception 'Only an approved reporter can redeem a reward.';
  end if;
  if p_fulfillment_method is null or p_recipient_name is null or p_phone is null
    or char_length(trim(p_recipient_name)) not between 2 and 160 or char_length(trim(p_phone)) not between 1 and 30 then
    raise exception 'Recipient contact details are invalid.';
  end if;
  if p_fulfillment_method = 'delivery' and (v_address is null or char_length(v_address) not between 10 and 1000) then
    raise exception 'A delivery address is required.';
  end if;
  if p_fulfillment_method = 'pickup' then v_address := null; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'The requester note is too long.'; end if;
  select * into v_reward from public.reward_items
    where id = p_reward_item_id and is_active and reward_period = 'standard' for update;
  if not found then raise exception 'Reward is not available.'; end if;
  if v_reward.stock < 1 then raise exception 'Reward is out of stock.'; end if;
  insert into public.point_wallets(user_id, balance) values(p_user_id, 0) on conflict(user_id) do nothing;
  select balance into v_balance from public.point_wallets where user_id = p_user_id for update;
  if v_balance < v_reward.point_cost then raise exception 'Insufficient point balance.'; end if;
  update public.reward_items set stock = stock - 1 where id = v_reward.id;
  update public.point_wallets set balance = balance - v_reward.point_cost where user_id = p_user_id;
  insert into public.reward_redemptions(user_id, reward_item_id, point_cost, fulfillment_method, recipient_name, phone, delivery_address, requester_note)
    values(p_user_id, v_reward.id, v_reward.point_cost, p_fulfillment_method, trim(p_recipient_name), trim(p_phone), v_address, v_note)
    returning id into v_redemption_id;
  insert into public.point_transactions(user_id, amount, transaction_type, reason, ref_reward_item_id, ref_redemption_id)
    values(p_user_id, -v_reward.point_cost, 'redeem', 'แลกรางวัล: ' || v_reward.name, v_reward.id, v_redemption_id);
  return jsonb_build_object('redemption_id', v_redemption_id, 'reward_item_id', v_reward.id, 'status', 'pending');
end;
$$;

create or replace function public.set_reward_redemption_status(
  p_redemption_id uuid, p_status public.reward_redemption_status, p_actor_id uuid, p_admin_note text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_redemption public.reward_redemptions%rowtype;
  v_reward public.reward_items%rowtype;
  v_note text := nullif(trim(p_admin_note), '');
begin
  if p_status is null or p_status not in ('approved','fulfilled','cancelled') then raise exception 'Redemption status is invalid.'; end if;
  if char_length(v_note) > 500 then raise exception 'The administrator note is too long.'; end if;
  if p_status = 'cancelled' and v_note is null then raise exception 'A cancellation reason is required.'; end if;
  if not exists(select 1 from public.profiles where id = p_actor_id and approval_status = 'approved' and role = 'admin') then
    raise exception 'Administrator access is required.';
  end if;
  select * into v_redemption from public.reward_redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Redemption was not found.'; end if;
  if not ((v_redemption.status = 'pending' and p_status in ('approved','cancelled'))
    or (v_redemption.status = 'approved' and p_status in ('fulfilled','cancelled'))) then
    raise exception 'This action is not available for the current redemption.';
  end if;
  if p_status = 'approved' then
    update public.reward_redemptions set status = p_status, approved_at = now(), approved_by = p_actor_id, admin_note = v_note where id = p_redemption_id;
  elsif p_status = 'fulfilled' then
    update public.reward_redemptions set status = p_status, fulfilled_at = now(), fulfilled_by = p_actor_id, admin_note = coalesce(v_note, admin_note) where id = p_redemption_id;
  else
    -- Same reward -> wallet lock order as redeem_reward.
    select * into strict v_reward from public.reward_items where id = v_redemption.reward_item_id for update;
    update public.reward_items set stock = stock + 1 where id = v_reward.id;
    insert into public.point_wallets(user_id, balance) values(v_redemption.user_id, v_redemption.point_cost)
      on conflict(user_id) do update set balance = public.point_wallets.balance + excluded.balance;
    insert into public.point_transactions(user_id, amount, transaction_type, reason, ref_reward_item_id, ref_redemption_id)
      values(v_redemption.user_id, v_redemption.point_cost, 'refund', 'คืนแต้มจากการยกเลิกรางวัล: ' || v_reward.name, v_reward.id, v_redemption.id);
    update public.reward_redemptions set status = p_status, cancelled_at = now(), cancelled_by = p_actor_id, admin_note = v_note where id = p_redemption_id;
  end if;
  return jsonb_build_object('id', p_redemption_id, 'status', p_status);
end;
$$;
revoke all on function public.redeem_reward(uuid,uuid,public.reward_fulfillment_method,text,text,text,text) from public,anon,authenticated;
revoke all on function public.set_reward_redemption_status(uuid,public.reward_redemption_status,uuid,text) from public,anon,authenticated;
grant execute on function public.redeem_reward(uuid,uuid,public.reward_fulfillment_method,text,text,text,text) to service_role;
grant execute on function public.set_reward_redemption_status(uuid,public.reward_redemption_status,uuid,text) to service_role;

create or replace function public.notify_reporter_for_reward_redemption()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_name text;
begin
  select name into v_name from public.reward_items where id = new.reward_item_id;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id,type,message)
      select id,'reward_status','มีคำขอแลกรางวัล "' || left(v_name, 150) || '" รออนุมัติ'
      from public.profiles where role = 'admin' and approval_status = 'approved';
    return new;
  end if;
  if new.status = old.status then return new; end if;
  insert into public.notifications(user_id,type,message) values(new.user_id,'reward_status',
    'คำขอแลกรางวัล "' || left(v_name, 150) || '" ' || case new.status
      when 'approved' then 'ได้รับอนุมัติแล้ว รอส่งมอบ'
      when 'fulfilled' then 'ส่งมอบแล้ว'
      when 'cancelled' then 'ถูกยกเลิก และคืน ' || new.point_cost || ' คะแนนแล้ว'
      else 'มีการเปลี่ยนแปลงสถานะ' end);
  return new;
end;
$$;
revoke all on function public.notify_reporter_for_reward_redemption() from public,anon,authenticated;
drop trigger if exists reward_redemptions_notify_reporter_status on public.reward_redemptions;
create trigger reward_redemptions_notify_reporter_status after insert or update of status on public.reward_redemptions
  for each row execute function public.notify_reporter_for_reward_redemption();

-- New plans may have no execution history yet. Due date is explicitly editable.
alter table public.pm_schedules alter column last_done_at drop not null;
create or replace function public.apply_pm_completion_to_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_plan public.pm_schedules%rowtype;
begin
  select * into strict v_plan from public.pm_schedules where id = new.schedule_id for update;
  if v_plan.assigned_technician_id is distinct from new.technician_id or not exists (
    select 1 from public.profiles where id = new.technician_id and role = 'technician' and approval_status = 'approved'
  ) then raise exception 'This PM plan is not assigned to you.'; end if;
  if new.completed_at > now() or char_length(trim(new.notes)) not between 10 and 4000 then
    raise exception 'PM completion date or notes are invalid.';
  end if;
  -- Backdated logs remain in history without moving the schedule backwards.
  if v_plan.last_done_at is null or new.completed_at > v_plan.last_done_at then
    update public.pm_schedules set last_done_at = new.completed_at,
      next_due_at = ((new.completed_at at time zone 'Asia/Bangkok') + make_interval(months => interval_months)) at time zone 'Asia/Bangkok',
      updated_at = now() where id = new.schedule_id;
  end if;
  return new;
end;
$$;
revoke all on function public.apply_pm_completion_to_schedule() from public,anon,authenticated;

-- Campaign dates are Thai calendar dates, regardless of the database session zone.
create or replace function public.finalize_expired_campaigns()
returns setof public.reward_campaigns language plpgsql security invoker set search_path = '' as $$
begin
  return query update public.reward_campaigns set status = 'ended',updated_at = now()
    where status = 'active' and end_date < (now() at time zone 'Asia/Bangkok')::date returning *;
end;
$$;
revoke all on function public.finalize_expired_campaigns() from public,anon,authenticated;
grant execute on function public.finalize_expired_campaigns() to service_role;

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
    'ได้รับแต้มตามเกณฑ์ SLA ที่ล็อกไว้เมื่อผู้จัดสรรมอบหมายงาน',
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

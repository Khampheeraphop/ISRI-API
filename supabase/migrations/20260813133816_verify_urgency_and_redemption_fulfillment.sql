-- The dispatcher verifies urgency before assignment. Rewards and SLA targets use
-- the verified value, so a reporter cannot gain more points by self-selecting critical.
alter table public.incidents
  add column if not exists urgency_verified public.incident_urgency,
  add column if not exists urgency_verified_by uuid references public.profiles(id) on delete restrict,
  add column if not exists urgency_verified_at timestamptz;

alter table public.incidents
  drop constraint if exists incidents_verified_urgency_check;
alter table public.incidents
  add constraint incidents_verified_urgency_check check (
    (urgency_verified is null and urgency_verified_by is null and urgency_verified_at is null)
    or
    (urgency_verified is not null and urgency_verified_by is not null and urgency_verified_at is not null)
  );

alter type public.point_transaction_type add value if not exists 'refund';

do $$ begin
  create type public.reward_redemption_status as enum ('pending', 'fulfilled', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reward_fulfillment_method as enum ('pickup', 'delivery');
exception when duplicate_object then null; end $$;

alter table public.reward_redemptions
  add column if not exists status public.reward_redemption_status not null default 'pending',
  add column if not exists fulfillment_method public.reward_fulfillment_method not null default 'pickup',
  add column if not exists recipient_name text,
  add column if not exists phone text,
  add column if not exists delivery_address text,
  add column if not exists requester_note text,
  add column if not exists admin_note text,
  add column if not exists fulfilled_at timestamptz,
  add column if not exists fulfilled_by uuid references public.profiles(id) on delete restrict,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete restrict,
  add column if not exists updated_at timestamptz not null default now();

update public.reward_redemptions redemption
set recipient_name = profile.full_name,
    phone = '-'
from public.profiles profile
where profile.id = redemption.user_id
  and redemption.recipient_name is null;

alter table public.reward_redemptions
  alter column recipient_name set not null,
  alter column phone set not null;

alter table public.reward_redemptions
  drop constraint if exists reward_redemptions_contact_check,
  drop constraint if exists reward_redemptions_delivery_check,
  drop constraint if exists reward_redemptions_state_check;

alter table public.reward_redemptions
  add constraint reward_redemptions_contact_check check (
    char_length(trim(recipient_name)) between 2 and 160
    and char_length(trim(phone)) between 1 and 30
    and (requester_note is null or char_length(requester_note) <= 500)
    and (admin_note is null or char_length(admin_note) <= 500)
  ),
  add constraint reward_redemptions_delivery_check check (
    (fulfillment_method = 'pickup' and delivery_address is null)
    or
    (fulfillment_method = 'delivery' and char_length(trim(delivery_address)) between 10 and 1000)
  ),
  add constraint reward_redemptions_state_check check (
    (status = 'pending' and fulfilled_at is null and fulfilled_by is null and cancelled_at is null and cancelled_by is null)
    or
    (status = 'fulfilled' and fulfilled_at is not null and fulfilled_by is not null and cancelled_at is null and cancelled_by is null)
    or
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and fulfilled_at is null and fulfilled_by is null)
  );

create index if not exists reward_redemptions_status_redeemed_idx
  on public.reward_redemptions (status, redeemed_at);

drop trigger if exists reward_redemptions_set_updated_at on public.reward_redemptions;
create trigger reward_redemptions_set_updated_at
before update on public.reward_redemptions
for each row execute function public.set_updated_at();

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

  v_points := case new.urgency_verified
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
    user_id, amount, transaction_type, reason, ref_incident_id, created_at
  ) values (
    new.reporter_id, v_points, 'earn'::public.point_transaction_type,
    'ได้รับแต้มหลังผู้จัดสรรยืนยันระดับความเร่งด่วนและปิดงานแล้ว',
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

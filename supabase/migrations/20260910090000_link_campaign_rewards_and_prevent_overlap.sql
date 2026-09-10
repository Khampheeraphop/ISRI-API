alter table public.reward_campaigns
  add column if not exists reward_item_id uuid references public.reward_items(id) on delete restrict,
  add column if not exists winner_count integer not null default 1,
  add column if not exists reserved_reward_count integer not null default 0;

alter table public.reward_campaigns
  drop constraint if exists reward_campaigns_winner_count_check,
  add constraint reward_campaigns_winner_count_check
    check (winner_count between 1 and 100),
  drop constraint if exists reward_campaigns_reserved_reward_count_check,
  add constraint reward_campaigns_reserved_reward_count_check
    check (reserved_reward_count between 0 and winner_count);

create index if not exists reward_campaigns_reward_item_idx
  on public.reward_campaigns(reward_item_id)
  where reward_item_id is not null;

create table if not exists public.campaign_awards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.reward_campaigns(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  reward_item_id uuid not null references public.reward_items(id) on delete restrict,
  rank integer not null check (rank > 0),
  status text not null default 'pending'
    check (status in ('pending', 'fulfilled', 'cancelled')),
  awarded_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  admin_note text check (admin_note is null or char_length(admin_note) <= 500),
  unique(campaign_id, user_id),
  unique(campaign_id, rank)
);

create index if not exists campaign_awards_status_idx
  on public.campaign_awards(status, awarded_at desc);

alter table public.campaign_awards enable row level security;

drop policy if exists api_only_campaign_awards on public.campaign_awards;
create policy api_only_campaign_awards
  on public.campaign_awards for all to authenticated
  using (false) with check (false);

grant select, insert, update on public.campaign_awards to service_role;

create or replace function public.validate_reward_campaign_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if new.end_date < new.start_date then
    raise exception using errcode = 'P0001', message = 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม';
  end if;

  if new.status = 'active'::public.campaign_status then
    if tg_op = 'INSERT' and new.start_date < v_today then
      raise exception using errcode = 'P0001', message = 'ไม่สามารถกำหนดวันเริ่มแคมเปญย้อนหลังได้';
    end if;

    if tg_op = 'UPDATE' then
      if new.start_date <> old.start_date and old.start_date <= v_today then
        raise exception using errcode = 'P0001', message = 'ไม่สามารถแก้ไขวันเริ่มของแคมเปญที่เริ่มแล้วได้';
      end if;
      if new.start_date <> old.start_date and new.start_date < v_today then
        raise exception using errcode = 'P0001', message = 'ไม่สามารถกำหนดวันเริ่มแคมเปญย้อนหลังได้';
      end if;
      if new.end_date <> old.end_date and new.end_date < v_today then
        raise exception using errcode = 'P0001', message = 'ไม่สามารถกำหนดวันสิ้นสุดแคมเปญย้อนหลังได้';
      end if;
    end if;

    if exists (
      select 1
      from public.reward_campaigns other
      where other.status = 'active'::public.campaign_status
        and other.id <> new.id
        and daterange(other.start_date, other.end_date, '[]')
          && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception using errcode = 'P0001', message = 'ช่วงเวลานี้ทับซ้อนกับแคมเปญที่มีอยู่';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reward_campaigns_validate_schedule on public.reward_campaigns;
create trigger reward_campaigns_validate_schedule
before insert or update on public.reward_campaigns
for each row execute function public.validate_reward_campaign_schedule();

create or replace function public.create_reward_campaign(
  p_name text,
  p_period_type public.campaign_period_type,
  p_start_date date,
  p_end_date date,
  p_reward_item_id uuid,
  p_winner_count integer
)
returns public.reward_campaigns
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reward public.reward_items%rowtype;
  v_campaign public.reward_campaigns%rowtype;
begin
  if p_winner_count not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'จำนวนผู้ชนะต้องอยู่ระหว่าง 1 ถึง 100 คน';
  end if;

  select * into v_reward
  from public.reward_items
  where id = p_reward_item_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ไม่พบของรางวัลที่เลือก';
  end if;
  if v_reward.stock < p_winner_count then
    raise exception using errcode = 'P0001', message = 'ของรางวัลคงเหลือไม่เพียงพอสำหรับจำนวนผู้ชนะ';
  end if;

  update public.reward_items
  set stock = stock - p_winner_count, updated_at = now()
  where id = p_reward_item_id;

  insert into public.reward_campaigns(
    name, period_type, start_date, end_date, prize_description, status,
    reward_item_id, winner_count, reserved_reward_count
  ) values (
    trim(p_name), p_period_type, p_start_date, p_end_date, v_reward.name,
    'active'::public.campaign_status, p_reward_item_id, p_winner_count, p_winner_count
  )
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.update_reward_campaign(
  p_campaign_id uuid,
  p_name text,
  p_period_type public.campaign_period_type,
  p_start_date date,
  p_end_date date,
  p_reward_item_id uuid,
  p_winner_count integer
)
returns public.reward_campaigns
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.reward_campaigns%rowtype;
  v_reward public.reward_items%rowtype;
  v_campaign public.reward_campaigns%rowtype;
begin
  if p_winner_count not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'จำนวนผู้ชนะต้องอยู่ระหว่าง 1 ถึง 100 คน';
  end if;

  select * into v_existing
  from public.reward_campaigns
  where id = p_campaign_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ไม่พบแคมเปญที่ต้องการแก้ไข';
  end if;
  if v_existing.status <> 'active'::public.campaign_status then
    raise exception using errcode = 'P0001', message = 'แก้ไขได้เฉพาะแคมเปญที่กำลังดำเนินการ';
  end if;

  perform 1
  from public.reward_items
  where id in (v_existing.reward_item_id, p_reward_item_id)
  order by id
  for update;

  if v_existing.reward_item_id is not null and v_existing.reserved_reward_count > 0 then
    update public.reward_items
    set stock = stock + v_existing.reserved_reward_count, updated_at = now()
    where id = v_existing.reward_item_id;
  end if;

  select * into v_reward
  from public.reward_items
  where id = p_reward_item_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ไม่พบของรางวัลที่เลือก';
  end if;
  if v_reward.stock < p_winner_count then
    raise exception using errcode = 'P0001', message = 'ของรางวัลคงเหลือไม่เพียงพอสำหรับจำนวนผู้ชนะ';
  end if;

  update public.reward_items
  set stock = stock - p_winner_count, updated_at = now()
  where id = p_reward_item_id;

  update public.reward_campaigns
  set name = trim(p_name),
      period_type = p_period_type,
      start_date = p_start_date,
      end_date = p_end_date,
      prize_description = v_reward.name,
      reward_item_id = p_reward_item_id,
      winner_count = p_winner_count,
      reserved_reward_count = p_winner_count,
      updated_at = now()
  where id = p_campaign_id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.finalize_reward_campaign(p_campaign_id uuid)
returns public.reward_campaigns
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign public.reward_campaigns%rowtype;
  v_award_count integer := 0;
  v_release_count integer := 0;
begin
  select * into v_campaign
  from public.reward_campaigns
  where id = p_campaign_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ไม่พบแคมเปญที่ต้องการปิดรอบ';
  end if;
  if v_campaign.status <> 'active'::public.campaign_status then
    raise exception using errcode = 'P0001', message = 'แคมเปญนี้ปิดรอบแล้ว';
  end if;

  if v_campaign.reward_item_id is not null then
    insert into public.campaign_awards(campaign_id, user_id, reward_item_id, rank)
    select v_campaign.id, ranked.user_id, v_campaign.reward_item_id, ranked.rank
    from (
      select score.user_id,
        row_number() over (
          order by score.points desc, score.last_scored_at asc nulls last, score.user_id
        )::integer as rank
      from public.campaign_scores score
      where score.campaign_id = v_campaign.id
    ) ranked
    where ranked.rank <= v_campaign.winner_count
    on conflict (campaign_id, user_id) do nothing;

    select count(*)::integer into v_award_count
    from public.campaign_awards
    where campaign_id = v_campaign.id and status = 'pending';

    v_release_count := greatest(v_campaign.reserved_reward_count - v_award_count, 0);
    if v_release_count > 0 then
      update public.reward_items
      set stock = stock + v_release_count, updated_at = now()
      where id = v_campaign.reward_item_id;
    end if;
  end if;

  update public.reward_campaigns
  set status = 'ended'::public.campaign_status,
      reserved_reward_count = v_award_count,
      updated_at = now()
  where id = v_campaign.id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.finalize_expired_campaigns()
returns setof public.reward_campaigns
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_id uuid;
begin
  for v_campaign_id in
    select id
    from public.reward_campaigns
    where status = 'active'::public.campaign_status
      and end_date < (now() at time zone 'Asia/Bangkok')::date
    order by end_date, id
  loop
    return next public.finalize_reward_campaign(v_campaign_id);
  end loop;
end;
$$;

create or replace function public.update_campaign_award_status(
  p_award_id uuid,
  p_status text,
  p_admin_note text default null
)
returns public.campaign_awards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_award public.campaign_awards%rowtype;
begin
  if p_status not in ('fulfilled', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'สถานะการส่งมอบรางวัลไม่ถูกต้อง';
  end if;
  if p_admin_note is not null and char_length(trim(p_admin_note)) > 500 then
    raise exception using errcode = 'P0001', message = 'หมายเหตุยาวเกิน 500 ตัวอักษร';
  end if;

  select * into v_award
  from public.campaign_awards
  where id = p_award_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ไม่พบรายการรางวัลแคมเปญ';
  end if;
  if v_award.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'รายการรางวัลนี้ดำเนินการแล้ว';
  end if;

  if p_status = 'cancelled' then
    update public.reward_items
    set stock = stock + 1, updated_at = now()
    where id = v_award.reward_item_id;
  end if;

  update public.reward_campaigns
  set reserved_reward_count = greatest(reserved_reward_count - 1, 0),
      updated_at = now()
  where id = v_award.campaign_id;

  update public.campaign_awards
  set status = p_status,
      admin_note = nullif(trim(p_admin_note), ''),
      fulfilled_at = case when p_status = 'fulfilled' then now() else null end,
      cancelled_at = case when p_status = 'cancelled' then now() else null end
  where id = p_award_id
  returning * into v_award;

  return v_award;
end;
$$;

revoke all on function public.validate_reward_campaign_schedule() from public, anon, authenticated;
revoke all on function public.create_reward_campaign(text, public.campaign_period_type, date, date, uuid, integer) from public, anon, authenticated;
revoke all on function public.update_reward_campaign(uuid, text, public.campaign_period_type, date, date, uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_reward_campaign(uuid) from public, anon, authenticated;
revoke all on function public.finalize_expired_campaigns() from public, anon, authenticated;
revoke all on function public.update_campaign_award_status(uuid, text, text) from public, anon, authenticated;

grant execute on function public.create_reward_campaign(text, public.campaign_period_type, date, date, uuid, integer) to service_role;
grant execute on function public.update_reward_campaign(uuid, text, public.campaign_period_type, date, date, uuid, integer) to service_role;
grant execute on function public.finalize_reward_campaign(uuid) to service_role;
grant execute on function public.finalize_expired_campaigns() to service_role;
grant execute on function public.update_campaign_award_status(uuid, text, text) to service_role;

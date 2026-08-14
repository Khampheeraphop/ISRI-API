-- Initial ISRI schema. Follow-up migrations in this directory evolve this baseline.
-- The browser never receives service_role credentials. Application writes go through
-- the isri-api Edge Function; RLS and explicit grants provide defense in depth.

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('reporter', 'technician', 'dispatcher', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_urgency as enum ('critical', 'urgent', 'normal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.incident_status as enum (
    'submitted', 'pending_assignment', 'assigned', 'in_progress',
    'pending_parts_approval', 'waiting_parts', 'pending_repair_approval', 'done'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.work_order_status as enum (
    'pending', 'in_progress', 'pending_parts_approval', 'waiting_parts',
    'pending_repair_approval', 'done'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.point_transaction_type as enum ('earn', 'redeem');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reward_period as enum ('standard', 'annual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.campaign_period_type as enum ('monthly', 'yearly', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.campaign_status as enum ('active', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum (
    'new_assignment_pending', 'job_assigned', 'job_done'
  );
exception when duplicate_object then null; end $$;

create sequence if not exists public.incident_ticket_seq start 1;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.next_incident_ticket_number()
returns text
language sql
volatile
set search_path = public
as $$
  select 'ISRI-' || to_char(current_timestamp at time zone 'Asia/Bangkok', 'YYYYMM') || '-' ||
         lpad(nextval('public.incident_ticket_seq')::text, 6, '0');
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(trim(full_name)) between 1 and 200),
  approval_status public.approval_status not null default 'pending',
  role public.app_role,
  requested_position text check (requested_position is null or char_length(trim(requested_position)) between 2 and 120),
  technician_specialties text[] not null default '{}',
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_approved_role_check check (
    (approval_status = 'approved' and role is not null) or
    (approval_status <> 'approved' and role is null)
  )
);

create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));
create index if not exists profiles_approval_status_idx on public.profiles (approval_status, created_at);
create index if not exists profiles_approved_role_idx on public.profiles (role) where approval_status = 'approved';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, 'ผู้ใช้งาน'), '@', 1)
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when public.profiles.full_name = '' then excluded.full_name
          else public.profiles.full_name
        end,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

create table if not exists public.user_approval_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('approved', 'rejected')),
  role public.app_role,
  specialties text[] not null default '{}',
  note text,
  acted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists user_approval_history_user_created_idx
  on public.user_approval_history (user_id, created_at desc);

create table if not exists public.managed_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  building text not null check (char_length(trim(building)) between 1 and 120),
  floor text not null check (char_length(trim(floor)) between 1 and 60),
  zone text not null check (char_length(trim(zone)) between 1 and 120),
  asset_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists managed_locations_label_idx on public.managed_locations (building, floor, zone);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default public.next_incident_ticket_number(),
  location_id uuid not null references public.managed_locations(id) on delete restrict,
  location_label text not null,
  asset_name text,
  category text not null check (category in (
    'ไฟฟ้า', 'ประปา', 'เครื่องปรับอากาศ', 'ลิฟต์',
    'โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)'
  )),
  urgency_reported public.incident_urgency not null,
  description text not null check (char_length(trim(description)) between 10 and 2000),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  status public.incident_status not null default 'pending_assignment',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists incidents_reporter_created_idx on public.incidents (reporter_id, created_at desc);
create index if not exists incidents_status_created_idx on public.incidents (status, created_at);
create index if not exists incidents_location_created_idx on public.incidents (location_id, created_at desc);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 3145728),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create table if not exists public.incident_files (
  incident_id uuid not null references public.incidents(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (incident_id, file_id)
);
create index if not exists incident_files_file_idx on public.incident_files (file_id);

create table if not exists public.sla_rules (
  id uuid primary key default gen_random_uuid(),
  urgency_level public.incident_urgency not null unique,
  response_minutes integer not null check (response_minutes > 0),
  resolve_minutes integer not null check (resolve_minutes >= response_minutes),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.incidents(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  status public.work_order_status not null default 'pending',
  respond_due_at timestamptz not null,
  resolve_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (resolve_due_at >= respond_due_at)
);
create index if not exists work_orders_technician_status_due_idx on public.work_orders (technician_id, status, resolve_due_at);
create index if not exists work_orders_status_due_idx on public.work_orders (status, resolve_due_at);

create table if not exists public.work_order_history (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  status public.work_order_status not null,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  note text,
  event_type text not null default 'status_change',
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists work_order_history_order_changed_idx on public.work_order_history (work_order_id, changed_at);

create table if not exists public.work_order_files (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (work_order_id, file_id)
);
create index if not exists work_order_files_file_idx on public.work_order_files (file_id);

create table if not exists public.work_order_history_files (
  work_order_history_id uuid not null references public.work_order_history(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (work_order_history_id, file_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null,
  message text not null check (char_length(message) between 1 and 500),
  related_incident_id uuid references public.incidents(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_created_idx on public.notifications (user_id, is_read, created_at desc);

create table if not exists public.pm_schedules (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.managed_locations(id) on delete restrict,
  location_label text not null,
  asset_name text not null,
  interval_months integer not null check (interval_months between 1 and 120),
  last_done_at timestamptz not null,
  next_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id)
);
create index if not exists pm_schedules_next_due_idx on public.pm_schedules (next_due_at);

create table if not exists public.pm_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.pm_schedules(id) on delete cascade,
  completed_at timestamptz not null default now(),
  technician_id uuid not null references public.profiles(id) on delete restrict,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pm_logs_schedule_completed_idx on public.pm_logs (schedule_id, completed_at desc);

create table if not exists public.point_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text not null default '',
  point_cost integer not null check (point_cost > 0),
  stock integer not null check (stock >= 0),
  is_active boolean not null default true,
  image_file_id uuid references public.files(id) on delete set null,
  reward_period public.reward_period not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  transaction_type public.point_transaction_type not null,
  reason text not null,
  ref_incident_id uuid references public.incidents(id) on delete set null,
  ref_reward_item_id uuid references public.reward_items(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists point_transactions_incident_earn_key
  on public.point_transactions (ref_incident_id)
  where transaction_type = 'earn' and ref_incident_id is not null;
create index if not exists point_transactions_user_created_idx on public.point_transactions (user_id, created_at desc);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  reward_item_id uuid not null references public.reward_items(id) on delete restrict,
  redeemed_at timestamptz not null default now()
);
create index if not exists reward_redemptions_user_redeemed_idx on public.reward_redemptions (user_id, redeemed_at desc);

create table if not exists public.reward_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  period_type public.campaign_period_type not null,
  start_date date not null,
  end_date date not null,
  prize_description text not null default '',
  status public.campaign_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists reward_campaigns_status_dates_idx on public.reward_campaigns (status, start_date, end_date);

create table if not exists public.campaign_scores (
  campaign_id uuid not null references public.reward_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  last_scored_at timestamptz,
  primary key (campaign_id, user_id)
);
create index if not exists campaign_scores_rank_idx on public.campaign_scores (campaign_id, points desc, last_scored_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('incident-attachments', 'incident-attachments', false, 3145728, array['image/jpeg', 'image/png']),
  ('reward-images', 'reward-images', false, 3145728, array['image/jpeg', 'image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_approval_history', 'managed_locations', 'incidents', 'files',
    'incident_files', 'sla_rules', 'work_orders', 'work_order_history',
    'work_order_files', 'work_order_history_files', 'notifications', 'pm_schedules',
    'pm_logs', 'point_wallets', 'point_transactions', 'reward_items',
    'reward_redemptions', 'reward_campaigns', 'campaign_scores'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format(
      'drop trigger if exists %I on public.%I',
      table_name || '_set_updated_at', table_name
    );
    if table_name in ('profiles', 'managed_locations', 'incidents', 'work_orders', 'pm_schedules', 'point_wallets', 'reward_items', 'reward_campaigns') then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        table_name || '_set_updated_at', table_name
      );
    end if;
  end loop;
end $$;

revoke all on sequence public.incident_ticket_seq from public, anon, authenticated;
revoke all on function public.next_incident_ticket_number() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

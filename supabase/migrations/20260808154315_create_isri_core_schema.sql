create type public.app_role as enum ('reporter', 'technician', 'admin');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.technician_specialty as enum ('electrical', 'plumbing', 'air_conditioning', 'elevator', 'building');
create type public.incident_urgency as enum ('critical', 'urgent', 'normal');
create type public.incident_status as enum ('submitted', 'assigned', 'in_progress', 'waiting_parts', 'done');
create type public.work_order_status as enum ('pending', 'in_progress', 'waiting_parts', 'done');
create type public.point_transaction_type as enum ('earn', 'redeem');
create type public.reward_period as enum ('standard', 'annual');
create type public.campaign_period_type as enum ('monthly', 'yearly', 'custom');
create type public.campaign_status as enum ('active', 'ended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  avatar_url text,
  approval_status public.approval_status not null default 'pending',
  role public.app_role,
  requested_position text,
  technician_specialties public.technician_specialty[] not null default '{}',
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_approved_role_check check ((approval_status = 'approved' and role is not null) or approval_status <> 'approved'),
  constraint profiles_specialty_role_check check (role = 'technician' or role is null or cardinality(technician_specialties) = 0)
);

create table public.managed_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  building text not null,
  floor text not null,
  zone text not null,
  asset_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.incident_ticket_sequence;
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('ISRI-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.incident_ticket_sequence')::text, 6, '0')),
  location_id uuid not null references public.managed_locations(id) on delete restrict,
  location_label text not null,
  asset_name text,
  category text not null check (category in ('ไฟฟ้า', 'ประปา', 'เครื่องปรับอากาศ', 'ลิฟต์', 'โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)')),
  urgency_reported public.incident_urgency not null,
  description text not null check (char_length(description) between 5 and 4000),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  status public.incident_status not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table public.incident_files (
  incident_id uuid not null references public.incidents(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (incident_id, file_id)
);
create table public.sla_rules (
  id uuid primary key default gen_random_uuid(),
  urgency_level public.incident_urgency not null unique,
  response_minutes integer not null check (response_minutes > 0),
  resolve_minutes integer not null check (resolve_minutes > 0),
  updated_at timestamptz not null default now()
);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.incidents(id) on delete restrict,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  status public.work_order_status not null default 'pending',
  respond_due_at timestamptz not null,
  resolve_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_due_check check (resolve_due_at >= respond_due_at)
);
create table public.work_order_history (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  status public.work_order_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create table public.work_order_files (
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (work_order_id, file_id)
);
create table public.pm_schedules (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.managed_locations(id) on delete restrict,
  location_label text not null,
  asset_name text not null,
  interval_months integer not null check (interval_months between 1 and 60),
  last_done_at timestamptz not null,
  next_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pm_schedules_due_check check (next_due_at > last_done_at)
);
create table public.pm_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.pm_schedules(id) on delete cascade,
  completed_at timestamptz not null,
  technician_id uuid not null references public.profiles(id) on delete restrict,
  notes text not null check (char_length(notes) between 3 and 4000),
  created_at timestamptz not null default now()
);
create table public.point_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table public.reward_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  point_cost integer not null check (point_cost > 0),
  stock integer not null check (stock >= 0),
  is_active boolean not null default true,
  image_file_id uuid references public.files(id) on delete set null,
  reward_period public.reward_period not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount integer not null,
  transaction_type public.point_transaction_type not null,
  reason text not null,
  ref_incident_id uuid references public.incidents(id) on delete set null,
  ref_reward_item_id uuid references public.reward_items(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint point_transactions_type_amount_check check ((transaction_type = 'earn' and amount > 0) or (transaction_type = 'redeem' and amount < 0))
);
create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  reward_item_id uuid not null references public.reward_items(id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested', 'fulfilled', 'cancelled'))
);
create table public.reward_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  period_type public.campaign_period_type not null,
  start_date date not null,
  end_date date not null,
  prize_description text not null,
  status public.campaign_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_date_check check (end_date >= start_date)
);
create table public.campaign_scores (
  campaign_id uuid not null references public.reward_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  last_scored_at timestamptz,
  primary key (campaign_id, user_id)
);
create table public.user_approval_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action public.approval_status not null check (action in ('approved', 'rejected')),
  role public.app_role,
  specialties public.technician_specialty[] not null default '{}',
  note text,
  acted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index incidents_reporter_created_idx on public.incidents (reporter_id, created_at desc);
create index incidents_location_created_idx on public.incidents (location_id, created_at desc);
create index incidents_status_created_idx on public.incidents (status, created_at desc);
create index work_orders_technician_status_idx on public.work_orders (technician_id, status);
create index work_orders_resolve_due_idx on public.work_orders (resolve_due_at) where status <> 'done';
create index pm_schedules_next_due_idx on public.pm_schedules (next_due_at);
create index point_transactions_user_created_idx on public.point_transactions (user_id, created_at desc);
create index reward_redemptions_user_created_idx on public.reward_redemptions (user_id, redeemed_at desc);
create index campaign_scores_campaign_points_idx on public.campaign_scores (campaign_id, points desc);
create index profiles_approval_idx on public.profiles (approval_status, created_at desc);

create function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin
  insert into public.profiles (id, email, full_name, avatar_url) values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)), new.raw_user_meta_data ->> 'avatar_url');
  insert into public.point_wallets (user_id) values (new.id);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger locations_set_updated_at before update on public.managed_locations for each row execute procedure public.set_updated_at();
create trigger incidents_set_updated_at before update on public.incidents for each row execute procedure public.set_updated_at();
create trigger work_orders_set_updated_at before update on public.work_orders for each row execute procedure public.set_updated_at();
create trigger pm_schedules_set_updated_at before update on public.pm_schedules for each row execute procedure public.set_updated_at();
create trigger wallets_set_updated_at before update on public.point_wallets for each row execute procedure public.set_updated_at();
create trigger reward_items_set_updated_at before update on public.reward_items for each row execute procedure public.set_updated_at();
create trigger campaigns_set_updated_at before update on public.reward_campaigns for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('incident-attachments', 'incident-attachments', false, 3145728, array['image/jpeg', 'image/png']), ('reward-images', 'reward-images', false, 3145728, array['image/jpeg', 'image/png']) on conflict (id) do nothing;
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (requested_position, technician_specialties) on public.profiles to authenticated;
alter table public.profiles enable row level security;
alter table public.managed_locations enable row level security;
alter table public.incidents enable row level security;
alter table public.files enable row level security;
alter table public.incident_files enable row level security;
alter table public.sla_rules enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_history enable row level security;
alter table public.work_order_files enable row level security;
alter table public.pm_schedules enable row level security;
alter table public.pm_logs enable row level security;
alter table public.point_wallets enable row level security;
alter table public.reward_items enable row level security;
alter table public.point_transactions enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.reward_campaigns enable row level security;
alter table public.campaign_scores enable row level security;
alter table public.user_approval_history enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own_onboarding on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke execute on function public.handle_new_user() from public, anon, authenticated;;

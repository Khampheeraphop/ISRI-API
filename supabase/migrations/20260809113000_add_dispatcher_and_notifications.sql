-- Dispatcher handles assignment independently from the system administrator.
alter type public.app_role add value if not exists 'dispatcher';
alter type public.incident_status add value if not exists 'pending_assignment';

alter table public.work_orders
  add column if not exists assigned_by uuid references public.profiles(id),
  add column if not exists assigned_at timestamptz;

create unique index if not exists work_orders_one_per_incident
  on public.work_orders(incident_id);

do $$ begin
  create type public.notification_type as enum (
    'new_assignment_pending',
    'job_assigned',
    'job_done'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type not null,
  message text not null check (char_length(message) between 1 and 500),
  related_incident_id uuid references public.incidents(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_created_idx
  on public.notifications(user_id, is_read, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists api_only_notifications on public.notifications;
create policy api_only_notifications on public.notifications
  for all to authenticated using (false) with check (false);

insert into public.sla_rules (urgency_level, response_minutes, resolve_minutes)
select values_.urgency_level::public.incident_urgency, values_.response_minutes, values_.resolve_minutes
from (values
  ('critical', 30, 240),
  ('urgent', 120, 1440),
  ('normal', 1440, 4320)
) as values_(urgency_level, response_minutes, resolve_minutes)
where not exists (select 1 from public.sla_rules);

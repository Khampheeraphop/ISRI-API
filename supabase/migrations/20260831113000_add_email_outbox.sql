create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null check (char_length(trim(recipient_email)) between 3 and 320),
  event_key text not null check (event_key in (
    'incident_submitted',
    'incident_rejected',
    'assignment_reporter',
    'assignment_technician_primary',
    'assignment_technician_support',
    'work_accepted',
    'parts_requested',
    'parts_approved',
    'parts_rejected',
    'repair_submitted',
    'rework_requested',
    'repair_completed'
  )),
  related_incident_id uuid not null references public.incidents(id) on delete cascade,
  related_work_order_id uuid references public.work_orders(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  last_error text,
  provider_message_id text,
  idempotency_key uuid not null default gen_random_uuid() unique,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_outbox_delivery_idx
  on public.email_outbox (status, scheduled_at, created_at);
create index if not exists email_outbox_incident_idx
  on public.email_outbox (related_incident_id, created_at desc);

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from anon, authenticated;

drop trigger if exists email_outbox_set_updated_at on public.email_outbox;
create trigger email_outbox_set_updated_at
before update on public.email_outbox
for each row execute function public.set_updated_at();

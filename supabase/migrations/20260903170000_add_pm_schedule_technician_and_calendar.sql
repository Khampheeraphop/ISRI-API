-- Add technician assignment to PM schedules and support PM calendar invites in email outbox.

alter table public.pm_schedules
  add column if not exists assigned_technician_id uuid references public.profiles(id) on delete set null;

create index if not exists pm_schedules_assigned_technician_idx
  on public.pm_schedules (assigned_technician_id);

-- Allow email_outbox to support PM schedule events in addition to incidents.
alter table public.email_outbox
  alter column related_incident_id drop not null;

alter table public.email_outbox
  add column if not exists related_pm_schedule_id uuid references public.pm_schedules(id) on delete cascade;

alter table public.email_outbox
  add column if not exists attachments jsonb;

create index if not exists email_outbox_pm_schedule_idx
  on public.email_outbox (related_pm_schedule_id, created_at desc);

alter table public.email_outbox
  drop constraint if exists email_outbox_event_key_check;

alter table public.email_outbox
  add constraint email_outbox_event_key_check check (event_key in (
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
    'repair_completed',
    'pm_schedule_assigned',
    'pm_schedule_updated'
  ));

alter table public.email_outbox
  drop constraint if exists email_outbox_related_entity_check;

alter table public.email_outbox
  add constraint email_outbox_related_entity_check check (
    related_incident_id is not null or related_pm_schedule_id is not null
  );

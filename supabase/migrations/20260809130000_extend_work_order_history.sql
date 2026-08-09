alter table public.work_order_history
  add column if not exists note text,
  add column if not exists event_type text not null default 'status_change',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.work_order_history
  add constraint work_order_history_event_type_check
  check (event_type in ('status_change', 'parts_requested', 'repair_note', 'completion')) not valid;

alter table public.work_order_history
  validate constraint work_order_history_event_type_check;

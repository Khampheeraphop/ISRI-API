-- Keep common workflow lookups efficient as notification and attachment history grows.
create index if not exists notifications_related_incident_idx
  on public.notifications(related_incident_id);

create index if not exists work_order_history_files_file_idx
  on public.work_order_history_files(file_id);

create index if not exists work_orders_assigned_by_idx
  on public.work_orders(assigned_by);

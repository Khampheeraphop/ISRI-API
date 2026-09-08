create unique index if not exists incidents_one_active_incident_per_location_idx
on public.incidents (location_id)
where status in (
  'pending_assignment'::public.incident_status,
  'assigned'::public.incident_status,
  'in_progress'::public.incident_status,
  'pending_parts_approval'::public.incident_status,
  'waiting_parts'::public.incident_status,
  'pending_repair_approval'::public.incident_status
);;

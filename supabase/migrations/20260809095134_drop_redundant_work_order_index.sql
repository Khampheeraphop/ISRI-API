-- public.work_orders already has the UNIQUE (incident_id) constraint named
-- work_orders_incident_id_key. This secondary unique index duplicates it.
drop index if exists public.work_orders_one_per_incident;

-- Remove the retired facility-map database objects from environments where its
-- earlier migration was already applied. Its Storage bucket is removed through
-- the Storage API before this migration runs.

drop table if exists public.floor_plan_versions cascade;
drop table if exists public.floor_plans cascade;

alter table public.managed_locations
  drop column if exists qr_scope;

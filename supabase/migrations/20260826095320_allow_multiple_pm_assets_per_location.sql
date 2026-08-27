alter table public.pm_schedules
  drop constraint if exists pm_schedules_location_id_key;

alter table public.pm_schedules
  add constraint pm_schedules_location_asset_key
  unique (location_id, asset_name);

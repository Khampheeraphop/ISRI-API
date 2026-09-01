alter table public.pm_schedules
  add column if not exists plan_details text not null default '';

alter table public.pm_schedules
  drop constraint if exists pm_schedules_plan_details_length;

alter table public.pm_schedules
  add constraint pm_schedules_plan_details_length
  check (char_length(trim(plan_details)) <= 2000);

update public.pm_schedules
set plan_details =
  'ตรวจสอบสภาพ บำรุงรักษา และทดสอบการทำงานของ ' || asset_name ||
  ' ตามรอบที่กำหนด'
where char_length(trim(plan_details)) = 0;

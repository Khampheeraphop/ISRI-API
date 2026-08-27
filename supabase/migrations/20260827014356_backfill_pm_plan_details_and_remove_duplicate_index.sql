update public.pm_schedules
set plan_details =
  'ตรวจสอบสภาพ บำรุงรักษา และทดสอบการทำงานของ ' || asset_name ||
  ' ตามรอบที่กำหนด'
where char_length(trim(plan_details)) = 0;

drop index if exists public.work_orders_one_per_incident;

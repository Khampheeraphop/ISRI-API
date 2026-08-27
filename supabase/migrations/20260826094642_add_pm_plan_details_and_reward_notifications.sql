alter table public.pm_schedules
  add column if not exists plan_details text not null default '';

alter table public.pm_schedules
  drop constraint if exists pm_schedules_plan_details_length;

alter table public.pm_schedules
  add constraint pm_schedules_plan_details_length
  check (char_length(trim(plan_details)) <= 2000);

alter type public.notification_type add value if not exists 'reward_status';

alter function public.redeem_reward(
  uuid,
  uuid,
  public.reward_fulfillment_method,
  text,
  text,
  text,
  text
) set search_path = '';

alter function public.set_reward_redemption_status(
  uuid,
  public.reward_redemption_status,
  uuid,
  text
) set search_path = '';

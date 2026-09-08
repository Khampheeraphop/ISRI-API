create schema if not exists isri_backup_20260814;
revoke all on schema isri_backup_20260814 from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','managed_locations','incidents','files','incident_files',
    'sla_rules','work_orders','work_order_history','work_order_files',
    'pm_schedules','pm_logs','point_wallets','reward_items',
    'point_transactions','reward_redemptions','reward_campaigns',
    'campaign_scores','user_approval_history','notifications',
    'work_order_history_files','bootstrap_admins'
  ]
  loop
    execute format(
      'create table if not exists isri_backup_20260814.%I as table public.%I',
      table_name,
      table_name
    );
  end loop;
end
$$;

revoke all on all tables in schema isri_backup_20260814 from public, anon, authenticated;;

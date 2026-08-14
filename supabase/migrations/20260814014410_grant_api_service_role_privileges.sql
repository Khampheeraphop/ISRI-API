-- The project deliberately disables automatic Data API exposure. Grant only
-- the current ISRI tables and RPCs to the Edge Function's service role.
-- Browser roles remain ungranted and must use isri-api.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.profiles,
  public.user_approval_history,
  public.managed_locations,
  public.incidents,
  public.files,
  public.incident_files,
  public.sla_rules,
  public.work_orders,
  public.work_order_history,
  public.work_order_files,
  public.work_order_history_files,
  public.notifications,
  public.pm_schedules,
  public.pm_logs,
  public.point_wallets,
  public.reward_items,
  public.point_transactions,
  public.reward_redemptions,
  public.reward_campaigns,
  public.campaign_scores,
  public.bootstrap_admins
to service_role;

do $$
begin
  if to_regclass('public.incident_ticket_seq') is not null then
    grant usage, select, update on sequence public.incident_ticket_seq
    to service_role;
  end if;
  if to_regclass('public.incident_ticket_sequence') is not null then
    grant usage, select, update on sequence public.incident_ticket_sequence
    to service_role;
  end if;
end;
$$;

grant execute on function public.finalize_expired_campaigns()
to service_role;
grant execute on function public.apply_work_order_action(
  uuid, public.work_order_status, uuid, text, text,
  public.incident_status, jsonb
) to service_role;
grant execute on function public.redeem_reward(
  uuid, uuid, public.reward_fulfillment_method, text, text, text, text
) to service_role;
grant execute on function public.set_reward_redemption_status(
  uuid, public.reward_redemption_status, uuid, text
) to service_role;
grant execute on function public.bulk_approve_reporters(uuid[], uuid)
to service_role;
grant execute on function public.assign_incident_to_technician(
  uuid, uuid, uuid, public.incident_urgency
) to service_role;

revoke execute on function public.apply_work_order_action(
  uuid,
  public.work_order_status,
  uuid,
  text,
  text,
  public.incident_status,
  jsonb
) from public, anon, authenticated;

grant execute on function public.apply_work_order_action(
  uuid,
  public.work_order_status,
  uuid,
  text,
  text,
  public.incident_status,
  jsonb
) to service_role;

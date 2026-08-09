revoke all on function public.redeem_reward(uuid, uuid) from anon;
revoke all on function public.redeem_reward(uuid, uuid) from authenticated;
grant execute on function public.redeem_reward(uuid, uuid) to service_role;

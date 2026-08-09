create or replace function public.redeem_reward(
  p_user_id uuid,
  p_reward_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward public.reward_items%rowtype;
  v_balance integer;
  v_redemption_id uuid;
begin
  select * into v_reward
  from public.reward_items
  where id = p_reward_item_id
    and is_active = true
    and reward_period = 'standard'
  for update;

  if not found then
    raise exception 'Reward is not available.';
  end if;
  if v_reward.stock < 1 then
    raise exception 'Reward is out of stock.';
  end if;

  insert into public.point_wallets (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.point_wallets
  where user_id = p_user_id
  for update;

  if v_balance < v_reward.point_cost then
    raise exception 'Insufficient point balance.';
  end if;

  update public.reward_items
  set stock = stock - 1, updated_at = now()
  where id = v_reward.id;

  update public.point_wallets
  set balance = balance - v_reward.point_cost, updated_at = now()
  where user_id = p_user_id;

  insert into public.reward_redemptions (user_id, reward_item_id)
  values (p_user_id, v_reward.id)
  returning id into v_redemption_id;

  insert into public.point_transactions (
    user_id, amount, transaction_type, reason, ref_reward_item_id
  )
  values (
    p_user_id,
    -v_reward.point_cost,
    'redeem',
    'แลกรางวัล: ' || v_reward.name,
    v_reward.id
  );

  return jsonb_build_object(
    'redemption_id', v_redemption_id,
    'reward_item_id', v_reward.id
  );
end;
$$;

revoke all on function public.redeem_reward(uuid, uuid) from public;
grant execute on function public.redeem_reward(uuid, uuid) to service_role;

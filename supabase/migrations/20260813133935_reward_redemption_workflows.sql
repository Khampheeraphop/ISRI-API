drop function if exists public.redeem_reward(uuid, uuid);

create or replace function public.redeem_reward(
  p_user_id uuid,
  p_reward_item_id uuid,
  p_fulfillment_method public.reward_fulfillment_method,
  p_recipient_name text,
  p_phone text,
  p_delivery_address text default null,
  p_requester_note text default null
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
  v_address text := nullif(trim(p_delivery_address), '');
  v_note text := nullif(trim(p_requester_note), '');
begin
  if not exists (
    select 1 from public.profiles
    where id = p_user_id and approval_status = 'approved' and role = 'reporter'
  ) then
    raise exception 'Only an approved reporter can redeem a reward.';
  end if;

  if char_length(trim(p_recipient_name)) not between 2 and 160
     or char_length(trim(p_phone)) not between 1 and 30 then
    raise exception 'Recipient contact details are invalid.';
  end if;
  if p_fulfillment_method = 'delivery'
     and (v_address is null or char_length(v_address) not between 10 and 1000) then
    raise exception 'A delivery address is required.';
  end if;
  if p_fulfillment_method = 'pickup' then v_address := null; end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The requester note is too long.';
  end if;

  select * into v_reward
  from public.reward_items
  where id = p_reward_item_id
    and is_active = true
    and reward_period = 'standard'
  for update;

  if not found then raise exception 'Reward is not available.'; end if;
  if v_reward.stock < 1 then raise exception 'Reward is out of stock.'; end if;

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
  set stock = stock - 1
  where id = v_reward.id;

  update public.point_wallets
  set balance = balance - v_reward.point_cost
  where user_id = p_user_id;

  insert into public.reward_redemptions (
    user_id, reward_item_id, fulfillment_method, recipient_name, phone,
    delivery_address, requester_note
  ) values (
    p_user_id, v_reward.id, p_fulfillment_method, trim(p_recipient_name),
    trim(p_phone), v_address, v_note
  ) returning id into v_redemption_id;

  insert into public.point_transactions (
    user_id, amount, transaction_type, reason, ref_reward_item_id
  ) values (
    p_user_id, -v_reward.point_cost, 'redeem',
    'แลกรางวัล: ' || v_reward.name, v_reward.id
  );

  return jsonb_build_object(
    'redemption_id', v_redemption_id,
    'reward_item_id', v_reward.id,
    'status', 'pending'
  );
end;
$$;

create or replace function public.set_reward_redemption_status(
  p_redemption_id uuid,
  p_status public.reward_redemption_status,
  p_actor_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.reward_redemptions%rowtype;
  v_reward public.reward_items%rowtype;
  v_note text := nullif(trim(p_admin_note), '');
begin
  if p_status not in ('fulfilled', 'cancelled') then
    raise exception 'Only fulfilled or cancelled is allowed.';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The administrator note is too long.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and approval_status = 'approved' and role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  select * into v_redemption
  from public.reward_redemptions
  where id = p_redemption_id
  for update;

  if not found then raise exception 'Redemption was not found.'; end if;
  if v_redemption.status <> 'pending' then
    raise exception 'Only a pending redemption can be updated.';
  end if;

  if p_status = 'fulfilled' then
    update public.reward_redemptions
    set status = 'fulfilled', fulfilled_at = now(), fulfilled_by = p_actor_id,
        admin_note = v_note
    where id = p_redemption_id;
  else
    select * into v_reward
    from public.reward_items
    where id = v_redemption.reward_item_id
    for update;

    update public.reward_items set stock = stock + 1 where id = v_reward.id;
    update public.point_wallets
    set balance = balance + v_reward.point_cost
    where user_id = v_redemption.user_id;

    insert into public.point_transactions (
      user_id, amount, transaction_type, reason, ref_reward_item_id
    ) values (
      v_redemption.user_id, v_reward.point_cost, 'refund',
      'คืนแต้มจากการยกเลิกรางวัล: ' || v_reward.name, v_reward.id
    );

    update public.reward_redemptions
    set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_id,
        admin_note = v_note
    where id = p_redemption_id;
  end if;

  return jsonb_build_object('id', p_redemption_id, 'status', p_status);
end;
$$;

revoke all on function public.redeem_reward(
  uuid, uuid, public.reward_fulfillment_method, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.redeem_reward(
  uuid, uuid, public.reward_fulfillment_method, text, text, text, text
) to service_role;

revoke all on function public.set_reward_redemption_status(
  uuid, public.reward_redemption_status, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_reward_redemption_status(
  uuid, public.reward_redemption_status, uuid, text
) to service_role;

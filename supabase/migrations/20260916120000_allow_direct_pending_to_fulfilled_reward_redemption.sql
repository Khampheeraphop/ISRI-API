-- Allow direct transition from pending to fulfilled for reward redemptions
-- This enables admins to approve and fulfill rewards in one step
create or replace function public.set_reward_redemption_status(
  p_redemption_id uuid, p_status public.reward_redemption_status, p_actor_id uuid, p_admin_note text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_redemption public.reward_redemptions%rowtype;
  v_reward public.reward_items%rowtype;
  v_note text := nullif(trim(p_admin_note), '');
begin
  if p_status is null or p_status not in ('approved','fulfilled','cancelled') then raise exception 'Redemption status is invalid.'; end if;
  if char_length(v_note) > 500 then raise exception 'The administrator note is too long.'; end if;
  if p_status = 'cancelled' and v_note is null then raise exception 'A cancellation reason is required.'; end if;
  if not exists(select 1 from public.profiles where id = p_actor_id and approval_status = 'approved' and role = 'admin') then
    raise exception 'Administrator access is required.';
  end if;
  select * into v_redemption from public.reward_redemptions where id = p_redemption_id for update;
  if not found then raise exception 'Redemption was not found.'; end if;
  if not ((v_redemption.status = 'pending' and p_status in ('approved','fulfilled','cancelled'))
    or (v_redemption.status = 'approved' and p_status in ('fulfilled','cancelled'))) then
    raise exception 'This action is not available for the current redemption.';
  end if;
  if p_status = 'approved' then
    update public.reward_redemptions set status = p_status, approved_at = now(), approved_by = p_actor_id, admin_note = v_note where id = p_redemption_id;
  elsif p_status = 'fulfilled' then
    -- Handle direct pending -> fulfilled transition
    if v_redemption.status = 'pending' then
      update public.reward_redemptions set status = p_status, approved_at = now(), approved_by = p_actor_id, fulfilled_at = now(), fulfilled_by = p_actor_id, admin_note = coalesce(v_note, admin_note) where id = p_redemption_id;
    else
      update public.reward_redemptions set status = p_status, fulfilled_at = now(), fulfilled_by = p_actor_id, admin_note = coalesce(v_note, admin_note) where id = p_redemption_id;
    end if;
  else
    -- Same reward -> wallet lock order as redeem_reward.
    select * into strict v_reward from public.reward_items where id = v_redemption.reward_item_id for update;
    update public.reward_items set stock = stock + 1 where id = v_reward.id;
    insert into public.point_wallets(user_id, balance) values(v_redemption.user_id, v_redemption.point_cost)
      on conflict(user_id) do update set balance = public.point_wallets.balance + excluded.balance;
    insert into public.point_transactions(user_id, amount, transaction_type, reason, ref_reward_item_id, ref_redemption_id)
      values(v_redemption.user_id, v_redemption.point_cost, 'refund', 'คืนแต้มจากการยกเลิกรางวัล: ' || v_reward.name, v_reward.id, v_redemption.id);
    update public.reward_redemptions set status = p_status, cancelled_at = now(), cancelled_by = p_actor_id, admin_note = v_note where id = p_redemption_id;
  end if;
  return jsonb_build_object('id', p_redemption_id, 'status', p_status);
end;
$$;

revoke all on function public.set_reward_redemption_status(uuid,public.reward_redemption_status,uuid,text) from public,anon,authenticated;
grant execute on function public.set_reward_redemption_status(uuid,public.reward_redemption_status,uuid,text) to service_role;

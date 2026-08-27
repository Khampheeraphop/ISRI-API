create or replace function public.notify_reporter_for_reward_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward_name text;
begin
  if new.status = old.status then
    return new;
  end if;

  select name into v_reward_name
  from public.reward_items
  where id = new.reward_item_id;

  insert into public.notifications (
    user_id,
    type,
    message,
    related_incident_id
  ) values (
    new.user_id,
    'reward_status',
    case new.status
      when 'fulfilled' then 'คำขอแลกรางวัล "' || coalesce(v_reward_name, 'รายการรางวัล') || '" ได้รับการส่งมอบแล้ว'
      when 'cancelled' then 'คำขอแลกรางวัล "' || coalesce(v_reward_name, 'รายการรางวัล') || '" ถูกยกเลิก และคืนคะแนนแล้ว'
      else 'คำขอแลกรางวัลของคุณมีการเปลี่ยนแปลงสถานะ'
    end,
    null
  );
  return new;
end;
$$;

revoke all on function public.notify_reporter_for_reward_redemption()
  from public, anon, authenticated;

drop trigger if exists reward_redemptions_notify_reporter_status
  on public.reward_redemptions;

create trigger reward_redemptions_notify_reporter_status
after update of status on public.reward_redemptions
for each row execute function public.notify_reporter_for_reward_redemption();

create or replace function public.validate_reward_campaign_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('isri_reward_campaign_schedule')
  );

  if new.end_date < new.start_date then
    raise exception using errcode = 'P0001', message = 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่ม';
  end if;

  if new.status = 'active'::public.campaign_status then
    if tg_op = 'INSERT' and new.start_date < v_today then
      raise exception using errcode = 'P0001', message = 'ไม่สามารถกำหนดวันเริ่มแคมเปญย้อนหลังได้';
    end if;

    if tg_op = 'UPDATE' then
      if new.start_date <> old.start_date and old.start_date <= v_today then
        raise exception using errcode = 'P0001', message = 'ไม่สามารถแก้ไขวันเริ่มของแคมเปญที่เริ่มแล้วได้';
      end if;
      if new.start_date <> old.start_date and new.start_date < v_today then
        raise exception using errcode = 'P0001', message = 'ไม่สามารถกำหนดวันเริ่มแคมเปญย้อนหลังได้';
      end if;
      if new.end_date <> old.end_date and new.end_date < v_today then
        raise exception using errcode = 'P0001', message = 'ไม่สามารถกำหนดวันสิ้นสุดแคมเปญย้อนหลังได้';
      end if;
    end if;

    if exists (
      select 1
      from public.reward_campaigns other
      where other.status = 'active'::public.campaign_status
        and other.id <> new.id
        and daterange(other.start_date, other.end_date, '[]')
          && daterange(new.start_date, new.end_date, '[]')
    ) then
      raise exception using errcode = 'P0001', message = 'ช่วงเวลานี้ทับซ้อนกับแคมเปญที่มีอยู่';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_reward_campaign_schedule()
  from public, anon, authenticated;

-- Store counters only, never messages. One row per user across all Edge workers.
create table public.isri_chat_quotas (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  minute_at timestamptz not null,
  minute_count integer not null check (minute_count between 1 and 10),
  day_at date not null,
  day_count integer not null check (day_count between 1 and 100)
);
alter table public.isri_chat_quotas enable row level security;
revoke all on public.isri_chat_quotas from public, anon, authenticated;

create function public.consume_isri_chat_quota(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and approval_status = 'approved' and role is not null) then
    return false;
  end if;
  insert into public.isri_chat_quotas as q (user_id, minute_at, minute_count, day_at, day_count)
  values (p_user_id, v_minute, 1, v_day, 1)
  on conflict (user_id) do update set
    minute_at = v_minute,
    minute_count = case when q.minute_at = v_minute then q.minute_count + 1 else 1 end,
    day_at = v_day,
    day_count = case when q.day_at = v_day then q.day_count + 1 else 1 end
  where (q.minute_at <> v_minute or q.minute_count < 10)
    and (q.day_at <> v_day or q.day_count < 100)
  returning user_id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.consume_isri_chat_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_isri_chat_quota(uuid) to service_role;

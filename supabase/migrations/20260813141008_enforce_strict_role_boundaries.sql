-- Administrators govern configuration and users, but do not join the
-- operational dispatch queue. Only approved dispatchers receive new-ticket
-- notifications.
create or replace function public.notify_dispatchers_for_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_assignment' then
    insert into public.notifications (user_id, type, message, related_incident_id)
    select id,
           'new_assignment_pending',
           'มีรายการ ' || new.ticket_number || ' รอจัดสรรงาน',
           new.id
    from public.profiles
    where approval_status = 'approved'
      and role = 'dispatcher';
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_dispatchers_for_incident()
from public, anon, authenticated;

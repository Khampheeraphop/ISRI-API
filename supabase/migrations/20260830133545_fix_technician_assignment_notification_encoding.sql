-- Recreate the assignment trigger with a UTF-8 Thai literal. The previous
-- deployed function stored mojibake text (for example, "à¸…") in notifications.
create or replace function public.finalize_work_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incidents
  set status = 'assigned'
  where id = new.incident_id;

  insert into public.notifications (
    user_id,
    type,
    message,
    related_incident_id
  ) values (
    new.technician_id,
    'job_assigned',
    'คุณได้รับมอบหมายงานใหม่ โปรดตรวจสอบรายละเอียดและตอบรับงาน',
    new.incident_id
  );

  return new;
end;
$$;

revoke execute on function public.finalize_work_order_assignment()
from public, anon, authenticated;

-- Repair only existing mojibake assignment notifications; other job-assigned
-- messages (such as parts approval) keep their original wording.
update public.notifications
set message = 'คุณได้รับมอบหมายงานใหม่ โปรดตรวจสอบรายละเอียดและตอบรับงาน'
where type = 'job_assigned'
  and message like 'à¸%';

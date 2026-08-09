create or replace function public.notify_dispatchers_for_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_assignment' then
    insert into public.notifications (user_id, type, message, related_incident_id)
    select id, 'new_assignment_pending', 'มีรายการ ' || new.ticket_number || ' รอจัดสรรงาน', new.id
    from public.profiles
    where approval_status = 'approved' and role in ('dispatcher', 'admin');
  end if;
  return new;
end;
$$;

create or replace function public.notify_work_order_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket text;
begin
  select ticket_number into ticket from public.incidents where id = new.incident_id;
  if new.status in ('pending_parts_approval', 'pending_repair_approval')
     and old.status is distinct from new.status
     and new.assigned_by is not null then
    insert into public.notifications (user_id, type, message, related_incident_id)
    values (
      new.assigned_by,
      'new_assignment_pending',
      case when new.status = 'pending_parts_approval'
        then 'มีรายการ ' || ticket || ' รออนุมัติเบิกอะไหล่'
        else 'มีรายการ ' || ticket || ' รอตรวจรับผลการซ่อม'
      end,
      new.incident_id
    );
  elsif new.status = 'waiting_parts' and old.status is distinct from new.status then
    insert into public.notifications (user_id, type, message, related_incident_id)
    values (new.technician_id, 'job_assigned', 'การเบิกอะไหล่ของ ' || ticket || ' ได้รับอนุมัติแล้ว', new.incident_id);
  elsif new.status = 'in_progress' and old.status = 'pending_repair_approval' then
    insert into public.notifications (user_id, type, message, related_incident_id)
    values (new.technician_id, 'job_assigned', 'รายการ ' || ticket || ' ถูกส่งกลับให้แก้ไข', new.incident_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_dispatchers_for_incident() from public, anon, authenticated;
revoke execute on function public.notify_work_order_progress() from public, anon, authenticated;

drop trigger if exists work_orders_notify_progress on public.work_orders;
create trigger work_orders_notify_progress
after update of status on public.work_orders
for each row execute function public.notify_work_order_progress();

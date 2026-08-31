create or replace function public.notify_work_order_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket text;
  v_message text;
begin
  select incident.ticket_number into v_ticket
  from public.incidents as incident
  where incident.id = new.incident_id;

  if new.status in ('pending_parts_approval', 'pending_repair_approval')
     and old.status is distinct from new.status
     and new.assigned_by is not null then
    insert into public.notifications (
      user_id, type, message, related_incident_id
    ) values (
      new.assigned_by,
      'new_assignment_pending',
      case when new.status = 'pending_parts_approval'
        then 'มีรายการ ' || v_ticket || ' รออนุมัติเบิกอะไหล่'
        else 'มีรายการ ' || v_ticket || ' รอตรวจรับผลการซ่อม'
      end,
      new.incident_id
    );
  elsif new.status = 'waiting_parts' and old.status is distinct from new.status then
    v_message := 'การเบิกอะไหล่ของ ' || v_ticket || ' ได้รับอนุมัติแล้ว';
  elsif new.status = 'in_progress' and old.status = 'pending_parts_approval' then
    v_message := 'คำขอเบิกอะไหล่ของ ' || v_ticket || ' ไม่ได้รับอนุมัติ โปรดดำเนินการซ่อมต่อ';
  elsif new.status = 'in_progress' and old.status = 'pending_repair_approval' then
    v_message := 'รายการ ' || v_ticket || ' ถูกส่งกลับให้แก้ไข';
  end if;

  if v_message is not null then
    insert into public.notifications (
      user_id, type, message, related_incident_id
    )
    select assignee.technician_id,
           'job_assigned',
           v_message,
           new.incident_id
    from public.work_order_assignees as assignee
    where assignee.work_order_id = new.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.notify_work_order_progress()
  from public, anon, authenticated;

create or replace function public.notify_dispatchers_for_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending_assignment' then
    insert into public.notifications (user_id, type, message, related_incident_id)
    select id, 'new_assignment_pending', 'à¸¡à¸µà¸£à¸²à¸¢à¸à¸²à¸£ ' || new.ticket_number || ' à¸£à¸­à¸ˆà¸±à¸”à¸ªà¸£à¸£à¸‡à¸²à¸™', new.id
    from public.profiles
    where approval_status = 'approved' and role = 'dispatcher';
  end if;
  return new;
end;
$$;

drop trigger if exists incidents_notify_dispatchers on public.incidents;
create trigger incidents_notify_dispatchers
after insert on public.incidents
for each row execute function public.notify_dispatchers_for_incident();

create or replace function public.finalize_work_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incidents set status = 'assigned' where id = new.incident_id;
  insert into public.notifications (user_id, type, message, related_incident_id)
  select new.technician_id, 'job_assigned', 'à¸„à¸¸à¸“à¹„à¸”à¹‰à¸£à¸±à¸šà¸¡à¸­à¸šà¸«à¸¡à¸²à¸¢à¸‡à¸²à¸™', new.incident_id;
  return new;
end;
$$;

drop trigger if exists work_orders_finalize_assignment on public.work_orders;
create trigger work_orders_finalize_assignment
after insert on public.work_orders
for each row execute function public.finalize_work_order_assignment();

;

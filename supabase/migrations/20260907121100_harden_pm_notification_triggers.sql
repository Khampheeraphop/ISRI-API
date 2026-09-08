-- Run after the enum values are committed by the preceding migration.
create or replace function public.notify_pm_assigned()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'active' and new.assigned_technician_id is not null and (
    tg_op = 'INSERT' or
    new.assigned_technician_id is distinct from old.assigned_technician_id
  ) then
    insert into public.notifications(user_id, type, message, related_pm_schedule_id)
    values (
      new.assigned_technician_id,
      'pm_assigned',
      'มอบหมายงาน PM: ' || new.asset_name || ' ที่ ' || new.location_label,
      new.id
    );
  end if;
  return new;
end;
$$;

create or replace function public.notify_pm_updated()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'active' and new.assigned_technician_id is not null and (
    old.assigned_technician_id is distinct from new.assigned_technician_id or
    old.next_due_at is distinct from new.next_due_at or
    old.end_at is distinct from new.end_at
  ) then
    insert into public.notifications(user_id, type, message, related_pm_schedule_id)
    values (
      new.assigned_technician_id,
      'pm_updated',
      'อัปเดตงาน PM: ' || new.asset_name || ' ที่ ' || new.location_label,
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_pm_updated_trigger on public.pm_schedules;
create trigger notify_pm_updated_trigger
after update of next_due_at, end_at, assigned_technician_id, status on public.pm_schedules
for each row execute function public.notify_pm_updated();

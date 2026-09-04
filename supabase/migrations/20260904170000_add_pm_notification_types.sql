-- Add PM-related notification types
do $$ begin
  create type public.notification_type as enum (
    'new_assignment_pending', 'job_assigned', 'job_done',
    'pm_due_soon', 'pm_overdue', 'pm_assigned', 'pm_updated'
  );
exception when duplicate_object then null; end $$;

-- Update the notifications table to support PM-related notifications
alter table public.notifications
  add column if not exists related_pm_schedule_id uuid references public.pm_schedules(id) on delete cascade;

-- Create index for PM-related notifications
create index if not exists notifications_pm_idx
  on public.notifications (related_pm_schedule_id, created_at desc);

-- Add function to create PM due soon notification
create or replace function public.notify_pm_due_soon()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, type, message, related_pm_schedule_id)
  select 
    new.assigned_technician_id,
    'pm_due_soon',
    'PM ใกล้ครบกำหนด: ' || new.asset_name || ' ที่ ' || new.location_label,
    new.id
  where new.assigned_technician_id is not null;
  
  -- Also notify admins
  insert into public.notifications(user_id, type, message, related_pm_schedule_id)
  select 
    p.id,
    'pm_due_soon',
    'PM ใกล้ครบกำหนด: ' || new.asset_name || ' ที่ ' || new.location_label,
    new.id
  from public.profiles p
  where p.role = 'admin' and p.approval_status = 'approved';
  
  return new;
end;
$$;

-- Add function to create PM overdue notification
create or replace function public.notify_pm_overdue()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, type, message, related_pm_schedule_id)
  select 
    new.assigned_technician_id,
    'pm_overdue',
    'PM เกินกำหนด: ' || new.asset_name || ' ที่ ' || new.location_label,
    new.id
  where new.assigned_technician_id is not null;
  
  -- Also notify admins
  insert into public.notifications(user_id, type, message, related_pm_schedule_id)
  select 
    p.id,
    'pm_overdue',
    'PM เกินกำหนด: ' || new.asset_name || ' ที่ ' || new.location_label,
    new.id
  from public.profiles p
  where p.role = 'admin' and p.approval_status = 'approved';
  
  return new;
end;
$$;

-- Add function to create PM assignment notification
create or replace function public.notify_pm_assigned()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.assigned_technician_id is distinct from old.assigned_technician_id and new.assigned_technician_id is not null then
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

-- Add function to create PM update notification
create or replace function public.notify_pm_updated()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.assigned_technician_id is not null and (
    old.assigned_technician_id is distinct from new.assigned_technician_id or
    old.next_due_at is distinct from new.next_due_at
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

-- Create triggers for PM notifications
drop trigger if exists notify_pm_due_soon_trigger on public.pm_schedules;
create trigger notify_pm_due_soon_trigger
after update of next_due_at on public.pm_schedules
for each row
when (new.next_due_at <= now() + interval '7 days' and new.next_due_at > now())
execute function public.notify_pm_due_soon();

drop trigger if exists notify_pm_overdue_trigger on public.pm_schedules;
create trigger notify_pm_overdue_trigger
after update of next_due_at on public.pm_schedules
for each row
when (new.next_due_at < now())
execute function public.notify_pm_overdue();

drop trigger if exists notify_pm_assigned_trigger on public.pm_schedules;
create trigger notify_pm_assigned_trigger
after insert or update of assigned_technician_id on public.pm_schedules
for each row
execute function public.notify_pm_assigned();

drop trigger if exists notify_pm_updated_trigger on public.pm_schedules;
create trigger notify_pm_updated_trigger
after update of next_due_at, assigned_technician_id on public.pm_schedules
for each row
execute function public.notify_pm_updated();
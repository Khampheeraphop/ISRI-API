create or replace function public.apply_pm_completion_to_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.pm_schedules
  set
    last_done_at = new.completed_at,
    next_due_at = new.completed_at + make_interval(months => interval_months),
    updated_at = now()
  where id = new.schedule_id;

  if not found then
    raise exception 'PM schedule % was not found.', new.schedule_id;
  end if;

  return new;
end;
$$;

drop trigger if exists apply_pm_completion_to_schedule on public.pm_logs;

create trigger apply_pm_completion_to_schedule
after insert on public.pm_logs
for each row
execute function public.apply_pm_completion_to_schedule();

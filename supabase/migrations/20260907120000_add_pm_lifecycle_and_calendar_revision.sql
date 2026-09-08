-- Bound PM recurrence and track calendar revisions used by iCalendar clients.
do $$ begin
  create type public.pm_schedule_status as enum
    ('draft', 'active', 'paused', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

alter table public.pm_schedules
  add column if not exists end_at timestamptz,
  add column if not exists status public.pm_schedule_status not null default 'active',
  add column if not exists calendar_sequence integer not null default 0;

alter table public.pm_schedules
  add constraint pm_schedules_end_after_next_due
    check (end_at is null or end_at >= next_due_at),
  add constraint pm_schedules_calendar_sequence_nonnegative
    check (calendar_sequence >= 0);

-- Give existing indefinite plans a bounded five-year horizon before enforcing it.
update public.pm_schedules
set end_at = next_due_at + interval '5 years'
where status = 'active' and end_at is null;

alter table public.pm_schedules
  add constraint pm_schedules_active_requires_end
    check (status <> 'active' or end_at is not null);

alter table public.email_outbox drop constraint if exists email_outbox_event_key_check;
alter table public.email_outbox add constraint email_outbox_event_key_check check (event_key in (
  'incident_submitted', 'incident_rejected', 'assignment_reporter',
  'assignment_technician_primary', 'assignment_technician_support', 'work_accepted',
  'parts_requested', 'parts_approved', 'parts_rejected', 'repair_submitted',
  'rework_requested', 'repair_completed', 'pm_schedule_assigned',
  'pm_schedule_updated', 'pm_schedule_cancelled', 'reward_redemption_submitted',
  'reward_redemption_approved', 'reward_redemption_fulfilled',
  'reward_redemption_cancelled', 'pm_due_soon', 'pm_overdue',
  'pm_completion_log', 'user_account_approved', 'user_account_rejected',
  'campaign_started', 'campaign_ending_soon', 'campaign_ended'
));

create or replace function public.apply_pm_completion_to_schedule()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.pm_schedules%rowtype;
  v_next_due timestamptz;
begin
  select * into strict v_plan from public.pm_schedules where id = new.schedule_id for update;
  if v_plan.status <> 'active' then
    raise exception 'This PM plan is not active.';
  end if;
  if v_plan.assigned_technician_id is distinct from new.technician_id or not exists (
    select 1 from public.profiles where id = new.technician_id and role = 'technician' and approval_status = 'approved'
  ) then raise exception 'This PM plan is not assigned to you.'; end if;
  if new.completed_at > now() or char_length(trim(new.notes)) not between 10 and 4000 then
    raise exception 'PM completion date or notes are invalid.';
  end if;
  if v_plan.last_done_at is null or new.completed_at > v_plan.last_done_at then
    v_next_due := ((new.completed_at at time zone 'Asia/Bangkok') +
      make_interval(months => v_plan.interval_months)) at time zone 'Asia/Bangkok';
    if v_next_due > v_plan.end_at then
      update public.pm_schedules set last_done_at = new.completed_at,
        status = 'completed', calendar_sequence = calendar_sequence + 1,
        updated_at = now() where id = new.schedule_id;
    else
      update public.pm_schedules set last_done_at = new.completed_at,
        next_due_at = v_next_due, updated_at = now() where id = new.schedule_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.apply_pm_completion_to_schedule() from public,anon,authenticated;

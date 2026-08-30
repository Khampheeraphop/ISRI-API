alter table public.incidents
  add column if not exists rejection_reason text,
  add column if not exists rejected_by uuid references public.profiles(id) on delete restrict,
  add column if not exists rejected_at timestamptz;

alter table public.incidents
  drop constraint if exists incidents_rejection_details_required;

alter table public.incidents
  add constraint incidents_rejection_details_required
  check (
    status <> 'rejected'
    or (
      rejection_reason is not null
      and char_length(trim(rejection_reason)) between 5 and 2000
      and rejected_by is not null
      and rejected_at is not null
    )
  );

drop index if exists public.incidents_one_active_incident_per_location_idx;

create unique index incidents_one_active_incident_per_location_idx
on public.incidents (location_id)
where status not in ('done', 'rejected');

create or replace function public.notify_reporter_of_incident_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'rejected' and old.status is distinct from new.status then
    insert into public.notifications (
      user_id,
      type,
      message,
      related_incident_id
    )
    values (
      new.reporter_id,
      'incident_rejected',
      'รายการแจ้งซ่อม ' || new.ticket_number || ' ไม่ได้รับการดำเนินการ โปรดดูผลการพิจารณา',
      new.id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_reporter_of_incident_rejection()
from public, anon, authenticated;

drop trigger if exists incidents_notify_rejection on public.incidents;
create trigger incidents_notify_rejection
after update of status on public.incidents
for each row execute function public.notify_reporter_of_incident_rejection();

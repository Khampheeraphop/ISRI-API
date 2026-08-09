insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-order-attachments',
  'work-order-attachments',
  false,
  3145728,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.work_order_history_files (
  work_order_history_id uuid not null references public.work_order_history(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (work_order_history_id, file_id)
);

alter table public.work_order_history_files enable row level security;

create or replace function public.notify_reporter_for_completed_incident()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'done' and old.status is distinct from new.status then
    insert into public.notifications (user_id, type, message, related_incident_id)
    values (
      new.reporter_id,
      'job_done',
      'งานซ่อม ' || new.ticket_number || ' ดำเนินการเสร็จสิ้นแล้ว',
      new.id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_reporter_for_completed_incident() from public, anon, authenticated;

drop trigger if exists incidents_notify_reporter_completed on public.incidents;
create trigger incidents_notify_reporter_completed
after update of status on public.incidents
for each row execute function public.notify_reporter_for_completed_incident();

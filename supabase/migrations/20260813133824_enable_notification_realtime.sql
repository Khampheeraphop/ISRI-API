-- Only the signed-in user's notification rows are exposed to Realtime.
-- All writes continue through the Edge Function/service role.
grant select on table public.notifications to authenticated;

drop policy if exists own_notifications_realtime on public.notifications;
create policy own_notifications_realtime
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create policy "api only work order history files"
on public.work_order_history_files
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke execute on function public.finalize_work_order_assignment() from public, anon, authenticated;
revoke execute on function public.notify_dispatchers_for_incident() from public, anon, authenticated;

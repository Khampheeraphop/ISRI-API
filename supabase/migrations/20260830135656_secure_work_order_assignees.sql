alter table public.work_order_assignees enable row level security;
revoke all on table public.work_order_assignees from anon, authenticated;

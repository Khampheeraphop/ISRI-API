create index if not exists email_outbox_recipient_user_idx
  on public.email_outbox (recipient_user_id);
create index if not exists email_outbox_work_order_idx
  on public.email_outbox (related_work_order_id)
  where related_work_order_id is not null;

drop policy if exists api_only_email_outbox on public.email_outbox;
create policy api_only_email_outbox on public.email_outbox
  for all to authenticated using (false) with check (false);

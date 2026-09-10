alter table public.email_outbox
  add column if not exists dedupe_key text;

do $$
begin
  alter table public.email_outbox
    add constraint email_outbox_dedupe_key_unique unique (dedupe_key);
exception
  when duplicate_object then null;
end
$$;

alter table public.notifications
  add column if not exists dedupe_key text;

do $$
begin
  alter table public.notifications
    add constraint notifications_dedupe_key_unique unique (dedupe_key);
exception
  when duplicate_object then null;
end
$$;

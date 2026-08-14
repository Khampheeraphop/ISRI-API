-- The own-row SELECT policy replaces the original deny-all notification
-- policy. With RLS enabled and no INSERT/UPDATE/DELETE client policies, writes
-- remain API-only while Realtime can evaluate the user's own rows efficiently.
drop policy if exists api_only_notifications on public.notifications;

create index if not exists incidents_urgency_verified_by_idx
  on public.incidents (urgency_verified_by)
  where urgency_verified_by is not null;

create index if not exists reward_redemptions_fulfilled_by_idx
  on public.reward_redemptions (fulfilled_by)
  where fulfilled_by is not null;

create index if not exists reward_redemptions_cancelled_by_idx
  on public.reward_redemptions (cancelled_by)
  where cancelled_by is not null;

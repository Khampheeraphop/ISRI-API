-- The original Cloud schema stored redemption status as text with the legacy
-- value `requested`. Normalize it to the enum used by the current workflow.
alter table public.reward_redemptions
  drop constraint if exists reward_redemptions_status_check,
  drop constraint if exists reward_redemptions_state_check;

alter table public.reward_redemptions
  alter column status drop default;

alter table public.reward_redemptions
  alter column status type public.reward_redemption_status
  using (
    case status::text
      when 'requested' then 'pending'
      else status::text
    end
  )::public.reward_redemption_status;

alter table public.reward_redemptions
  alter column status set default 'pending'::public.reward_redemption_status,
  alter column status set not null;

alter table public.reward_redemptions
  add constraint reward_redemptions_state_check check (
    (status = 'pending' and fulfilled_at is null and fulfilled_by is null and cancelled_at is null and cancelled_by is null)
    or
    (status = 'fulfilled' and fulfilled_at is not null and fulfilled_by is not null and cancelled_at is null and cancelled_by is null)
    or
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and fulfilled_at is null and fulfilled_by is null)
  );

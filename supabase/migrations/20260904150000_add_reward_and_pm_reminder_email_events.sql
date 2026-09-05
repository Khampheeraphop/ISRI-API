-- Add new email event keys for reward redemption and PM reminders
-- These extend the existing email_outbox event_key check constraint

-- First add the column for reward redemption tracking
alter table public.email_outbox
  add column if not exists related_redemption_id uuid references public.reward_redemptions(id) on delete cascade;

-- Add indexes for new email queries
create index if not exists email_outbox_redemption_idx
  on public.email_outbox (related_redemption_id, created_at desc);

-- Update the event key check constraint
alter table public.email_outbox
  drop constraint if exists email_outbox_event_key_check;

alter table public.email_outbox
  add constraint email_outbox_event_key_check check (event_key in (
    -- Existing incident/workflow events
    'incident_submitted',
    'incident_rejected',
    'assignment_reporter',
    'assignment_technician_primary',
    'assignment_technician_support',
    'work_accepted',
    'parts_requested',
    'parts_approved',
    'parts_rejected',
    'repair_submitted',
    'rework_requested',
    'repair_completed',
    -- Existing PM events
    'pm_schedule_assigned',
    'pm_schedule_updated',
    -- New reward redemption events
    'reward_redemption_submitted',
    'reward_redemption_approved',
    'reward_redemption_fulfilled',
    'reward_redemption_cancelled',
    -- New PM reminder events
    'pm_due_soon',
    'pm_overdue',
    -- New additional events
    'pm_completion_log',
    'user_account_approved',
    'user_account_rejected',
    'campaign_started',
    'campaign_ending_soon',
    'campaign_ended'
  ));

-- Update the related entity check to include redemptions
alter table public.email_outbox
  drop constraint if exists email_outbox_related_entity_check;

alter table public.email_outbox
  add constraint email_outbox_related_entity_check check (
    related_incident_id is not null or 
    related_pm_schedule_id is not null or 
    related_redemption_id is not null
  );
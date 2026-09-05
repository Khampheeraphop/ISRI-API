-- Add enhanced email tracking fields to email_outbox table
-- These fields allow better tracking of email delivery status via Resend webhooks

alter table public.email_outbox
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists bounce_reason text,
  add column if not exists complaint_type text;

-- Update status check constraint to include new statuses
alter table public.email_outbox
  drop constraint if exists email_outbox_status_check;

alter table public.email_outbox
  add constraint email_outbox_status_check check (status in (
    'pending', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed'
  ));

-- Add indexes for better performance on tracking queries
create index if not exists email_outbox_status_idx
  on public.email_outbox (status, created_at desc);

create index if not exists email_outbox_delivered_idx
  on public.email_outbox (delivered_at desc) where status = 'delivered';

create index if not exists email_outbox_bounced_idx
  on public.email_outbox (bounced_at desc) where status = 'bounced';
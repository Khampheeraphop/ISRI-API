# ISRI Email System - Cron Jobs and Webhooks Setup

## PM Reminder Cron Job

### Deploy the PM Reminder Cron Function

The PM reminder cron job is implemented as a separate Edge Function: `pm-reminder-cron`

**To deploy:**
```bash
cd C:\Users\poplo\Desktop\ISRI\api\supabase
supabase functions deploy pm-reminder-cron
```

**Set up the cron secret:**
In Supabase Dashboard > Project Settings > Edge Functions > Secrets:
```
CRON_SECRET=your-secure-random-string-here
```

**Configure the cron schedule:**
In Supabase Dashboard > Edge Functions > Cron Jobs:
- **Function**: `pm-reminder-cron`
- **Schedule**: `0 9 * * *` (Daily at 9 AM Thailand time)
- **Cron Secret**: Use the same `CRON_SECRET` value

### Manual Testing

You can test the PM reminder system manually via the API:

**Check PM due soon:**
```bash
curl -X POST https://nzwtybjijnreeylbmjlp.supabase.co/functions/v1/isri-api/admin/pm-reminders/check-due-soon \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"daysAhead": 7}'
```

**Check PM overdue:**
```bash
curl -X POST https://nzwtybjijnreeylbmjlp.supabase.co/functions/v1/isri-api/admin/pm-reminders/check-overdue \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

## Resend Webhook Setup

### Webhook Handler Endpoint

Create a new Edge Function to handle Resend webhooks:

**File**: `supabase/functions/resend-webhook/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

serve(async (req) => {
  try {
    const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    
    // Verify webhook signature (Resend sends this in headers)
    const signature = req.headers.get("resend-signature");
    if (!signature || !webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse webhook payload
    const payload = await req.json();
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Process webhook events
    for (const event of payload.data || []) {
      const { type, created_at, email, id: providerMessageId } = event;
      
      // Find the corresponding email outbox entry
      const { data: outboxEntry } = await supabase
        .from("email_outbox")
        .select("*")
        .eq("provider_message_id", providerMessageId)
        .single();

      if (!outboxEntry) continue;

      // Update email status based on webhook event
      if (type === "email.delivered") {
        await supabase
          .from("email_outbox")
          .update({ 
            status: "delivered",
            // Add delivered_at column if needed
          })
          .eq("id", outboxEntry.id);
      } else if (type === "email.bounced" || type === "email.complained") {
        await supabase
          .from("email_outbox")
          .update({ 
            status: "failed",
            last_error: `Webhook: ${type}`,
          })
          .eq("id", outboxEntry.id);
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Error", { status: 500 });
  }
});
```

**Deploy the webhook:**
```bash
supabase functions deploy resend-webhook
```

**Set up webhook secret:**
In Supabase Dashboard > Project Settings > Edge Functions > Secrets:
```
RESEND_WEBHOOK_SECRET=your-webhook-verification-secret
```

**Configure Resend webhook:**
1. Go to Resend Dashboard > Settings > Webhooks
2. Add new webhook:
   - **URL**: `https://nzwtybjijnreeylbmjlp.supabase.co/functions/v1/resend-webhook`
   - **Events**: `email.delivered`, `email.bounced`, `email.complained`
   - **Secret**: Use the same `RESEND_WEBHOOK_SECRET` value

## Email Status Tracking

### Current Status Fields in email_outbox:

- `status`: `pending`, `sending`, `sent`, `failed`
- `attempts`: Number of retry attempts
- `last_error`: Error message if failed
- `provider_message_id`: Resend message ID
- `sent_at`: Timestamp when sent
- `scheduled_at`: When to send (for retries)

### Recommended Enhancements:

Add these columns to email_outbox for better tracking:

```sql
alter table public.email_outbox
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists bounce_reason text,
  add column if not exists complaint_type text;
```

## Monitoring and Maintenance

### Check Email Outbox Status

```sql
-- View email statistics
SELECT 
  event_key,
  status,
  COUNT(*) as count,
  MAX(created_at) as last_created
FROM email_outbox
GROUP BY event_key, status
ORDER BY event_key, status;

-- View failed emails
SELECT * FROM email_outbox
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 20;

-- View pending emails
SELECT * FROM email_outbox
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 20;
```

### Manual Email Processing

Process pending emails via API:
```bash
curl -X POST https://nzwtybjijnreeylbmjlp.supabase.co/functions/v1/isri-api/admin/email-outbox/process \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 25}'
```

## New Email Events Added

### Reward Redemption Events:
- `reward_redemption_submitted` - When user requests reward redemption
- `reward_redemption_approved` - When admin approves redemption
- `reward_redemption_fulfilled` - When reward is delivered
- `reward_redemption_cancelled` - When redemption is cancelled

### PM Reminder Events:
- `pm_due_soon` - When PM is due within 7 days
- `pm_overdue` - When PM is past due date
- `pm_completion_log` - When PM completion is logged

### Additional Events:
- `user_account_approved` - When user account is approved
- `user_account_rejected` - When user account is rejected
- `campaign_started` - When reward campaign starts
- `campaign_ending_soon` - When campaign is ending soon
- `campaign_ended` - When campaign has ended

## Testing Checklist

- [ ] Deploy migration `20260904150000_add_reward_and_pm_reminder_email_events.sql`
- [ ] Deploy updated `isri-api` function with new email services
- [ ] Deploy `pm-reminder-cron` function
- [ ] Set up `CRON_SECRET` in Supabase secrets
- [ ] Configure cron job in Supabase Dashboard
- [ ] Test PM reminder endpoints manually
- [ ] Deploy `resend-webhook` function
- [ ] Set up `RESEND_WEBHOOK_SECRET` in Supabase secrets
- [ ] Configure webhook in Resend Dashboard
- [ ] Test reward redemption email flow
- [ ] Test PM assignment email flow
- [ ] Verify email delivery via Resend dashboard
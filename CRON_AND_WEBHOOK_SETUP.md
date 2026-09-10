# ISRI email cron and webhook setup

## PM reminder schedule

The deployed `pm-reminder-cron` Edge Function keeps Supabase JWT verification
enabled and additionally requires the verified token to have the `service_role`
claim. Store the legacy service-role JWT in Supabase Vault and use it only from
the server-side Cron job. Never put it in the frontend or repository.

Create a daily HTTP Cron job in **Supabase Dashboard > Integrations > Cron**:

- Method: `POST`
- URL: `https://nzwtybjijnreeylbmjlp.supabase.co/functions/v1/pm-reminder-cron`
- Schedule: `0 2 * * *` (02:00 UTC, which is 09:00 in Thailand)
- Header: `Authorization: Bearer <service-role JWT read from Vault>`
- Header: `Content-Type: application/json`
- Body: `{}`

The job performs these actions:

- notifies the assigned technician and approved administrators about PM plans
  due within seven days;
- notifies them once more when the same due date becomes overdue;
- writes both in-app notifications and email outbox rows;
- sends queued email immediately and retries older deliverable rows;
- deduplicates reminders by event, plan, recipient, and PM due date.

After creating the job, confirm at least one successful run in
`cron.job_run_details`. The Edge Function being ACTIVE does not prove that a
Cron schedule exists.

## Resend webhook

The deployed `resend-webhook` must have JWT verification disabled because
Resend does not send a Supabase user JWT. The handler authenticates every raw
request with Resend's Svix headers and `RESEND_WEBHOOK_SECRET`, including a
five-minute timestamp tolerance.

In **Resend > Webhooks**, register:

- URL: `https://nzwtybjijnreeylbmjlp.supabase.co/functions/v1/resend-webhook`
- Events: `email.delivered`, `email.bounced`, `email.complained`

The signing secret displayed by Resend must be stored as the Supabase Edge
Function secret `RESEND_WEBHOOK_SECRET`. Do not add a custom bearer header.

The handler reads `data.email_id` from Resend's single-event payload and updates
the matching `email_outbox.provider_message_id` row. Replay a test event from
Resend after setup and confirm the row moves from `sent` to `delivered`,
`bounced`, or `complained`.

## Required Edge Function secrets

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `APP_URL`
- `RESEND_WEBHOOK_SECRET`
- Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

`CRON_SECRET` is no longer used by the current PM cron implementation. The Cron
request is authorized by the gateway-verified service-role JWT instead.

## Manual queue processing

An approved administrator can process up to 25 pending or retryable rows with:

```text
POST /admin/email-outbox/process
{ "limit": 25 }
```

Email failure never rolls back the repair, reward, or PM workflow state.

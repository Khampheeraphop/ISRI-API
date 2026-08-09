# ISRI API

The production backend is implemented as Supabase Edge Functions, kept separately from the React application.

- `supabase/functions/isri-api` validates Supabase JWTs and exposes the ISRI API.
- PostgreSQL schema, row-level security, storage buckets, and migrations are managed in the Supabase project.
- The browser uses only the publishable Supabase key. Service-role credentials remain inside Edge Functions.

The first API module covers the Google-authenticated profile, onboarding, approval flow, locations, and incident creation. It now includes:

- administrator-only location create, update, delete, and QR lookup;
- private `incident-attachments` uploads through one-time signed upload URLs;
- file metadata recorded in `files` and linked with `incident_files` only after an incident is created;
- reporter-only incident list and detail endpoints, with short-lived signed read URLs for attachments.

Further modules will migrate work orders, PM, rewards, and campaigns from the temporary client-side store.

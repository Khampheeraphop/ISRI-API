# ISRI API

The production backend is implemented as Supabase Edge Functions, kept separately from the React application.

- `supabase/functions/isri-api` validates Supabase JWTs and exposes the ISRI API.
- PostgreSQL schema, row-level security, storage buckets, and migrations are managed in the Supabase project.
- The browser uses only the publishable Supabase key. Service-role credentials remain inside Edge Functions.

The first API module covers the Google-authenticated profile, onboarding, approval flow, locations, and incident creation. Further modules will migrate work orders, PM, rewards, and campaigns from the temporary client-side store.

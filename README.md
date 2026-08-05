# ISRI API

Backend is intentionally deferred until a later sprint. Sprint 0 uses the typed mock entity store in `web/src/mock/entityStore.ts`, accessed only through the reusable React Query hooks.

When the API is introduced, its clients should replace the store implementation without changing feature pages or generic hooks.

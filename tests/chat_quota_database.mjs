// Isolated PostgreSQL checks; never connects to Supabase or uses real credentials.
import { PGlite } from "../../tmp/pglite/package/dist/index.js";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = await PGlite.create();
const actor = "10000000-0000-4000-8000-000000000001";
const pending = "20000000-0000-4000-8000-000000000002";
await db.exec(`create role anon; create role authenticated; create role service_role;
create table public.profiles(id uuid primary key, approval_status text, role text);
insert into public.profiles values ('${actor}', 'approved', 'reporter'), ('${pending}', 'pending', 'reporter');`);
await db.exec(
  await readFile(
    new URL(
      "../supabase/migrations/20260913090000_add_isri_chat_quota.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const consume = async (id = actor) =>
  (await db.query("select public.consume_isri_chat_quota($1) as ok", [id]))
    .rows[0].ok;
assert.equal(await consume(pending), false);
for (let i = 0; i < 10; i++) assert.equal(await consume(), true);
assert.equal(await consume(), false);
await db.exec(
  "update public.isri_chat_quotas set minute_at = now() - interval '1 hour'",
);
assert.equal(await consume(), true);
await db.exec(
  "update public.isri_chat_quotas set minute_at = now() - interval '1 hour', day_count = 100",
);
assert.equal(await consume(), false);
await db.exec("update public.isri_chat_quotas set day_at = current_date - 2");
assert.equal(await consume(), true);
await db.exec("set role authenticated");
await assert.rejects(consume, /permission denied/);
await assert.rejects(
  () => db.query("select * from public.isri_chat_quotas"),
  /permission denied/,
);
await db.exec("reset role; set role service_role");
assert.equal(await consume(), true);
await db.exec("reset role");
assert.equal(
  (await db.query("select count(*)::int as count from public.isri_chat_quotas"))
    .rows[0].count,
  1,
);
await db.close();
console.log(
  "Chat quota: approval, minute/day limits, rollover, and SQL privileges passed.",
);

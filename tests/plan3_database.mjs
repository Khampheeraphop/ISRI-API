// Local-only PostgreSQL integration checks. No network or production credentials.
// Run: node api/tests/plan3_database.mjs
import { PGlite } from "../../tmp/pglite/package/dist/index.js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url);
const schema = JSON.parse(
  await readFile(new URL("artifacts/plan3-schema-before.json", root), "utf8"),
);
const db = await PGlite.create();
const q = (name) => '"' + name.replaceAll('"', '""') + '"';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create sequence public.incident_ticket_sequence;`);
for (const e of schema.enums)
  await db.exec(
    `create type public.${q(e.name)} as enum (${e.labels.map((x) => "'" + x.replaceAll("'", "''") + "'").join(",")})`,
  );
for (const t of schema.tables) {
  await db.exec(
    `create table public.${q(t.name)} (${t.columns.map((c) => `${q(c.name)} ${c.type}${c.default ? " default " + c.default : ""}${c.notnull ? " not null" : ""}`).join(",")})`,
  );
}
for (const foreign of [false, true])
  for (const t of schema.tables)
    for (const c of t.constraints ?? []) {
      if ((c.kind === "f") === foreign)
        await db.exec(
          `alter table public.${q(t.name)} add constraint ${q(c.name)} ${c.definition}`,
        );
    }
for (const f of schema.functions) await db.exec(f);
await db.exec(`create trigger incidents_award_verified_points after update of status on public.incidents for each row execute function public.award_verified_incident_points();
  create trigger apply_pm_completion_to_schedule after insert on public.pm_logs for each row execute function public.apply_pm_completion_to_schedule();
  create unique index point_transactions_incident_earn_key on public.point_transactions(ref_incident_id) where transaction_type='earn' and ref_incident_id is not null;
  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant all on all sequences in schema public to service_role;`);
const ids = {};
for (const role of ["reporter", "admin", "technician", "dispatcher"]) {
  const {
    rows: [row],
  } = await db.query(
    "insert into auth.users values(gen_random_uuid()) returning id",
  );
  ids[role] = row.id;
  await db.query(
    `insert into public.profiles(id,email,full_name,role,approval_status) values($1,$2,$3::text,$3::text::public.app_role,'approved')`,
    [row.id, role + "@local.test", role],
  );
}
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
ids.location = (
  await one(
    `insert into public.managed_locations(code,building,floor,zone) values('LOCAL-TEST','Test','1','Test') returning id`,
  )
).id;
ids.reward = (
  await one(
    `insert into public.reward_items(name,description,point_cost,stock,is_active,reward_period) values('Local reward','Local integration fixture',40,1,true,'standard') returning id`,
  )
).id;
await db.query(
  "insert into public.point_wallets(user_id,balance) values($1,100)",
  [ids.reporter],
);
const original = (
  await one(
    `select public.redeem_reward($1,$2,'pickup','Local Tester','000') as result`,
    [ids.reporter, ids.reward],
  )
).result;
ids.legacy = original.redemption_id;
await db.query("update public.reward_items set point_cost=90 where id=$1", [
  ids.reward,
]);
await db.exec(
  await readFile(new URL("artifacts/plan3-enums.sql", root), "utf8"),
);
await db.exec(
  await readFile(new URL("artifacts/plan3-workflows.sql", root), "utf8"),
);
const results = [];
async function check(name, fn) {
  await db.exec("begin; set local role service_role;");
  try {
    await fn();
    results.push({ name, status: "passed" });
    console.log("PASS " + name);
  } finally {
    await db.exec("rollback");
  }
}
async function rejected(sql, args, pattern) {
  await db.exec("savepoint expected_failure");
  try {
    await assert.rejects(db.query(sql, args), pattern);
  } finally {
    await db.exec("rollback to savepoint expected_failure");
  }
}
const status = (id, s, note = "Local test") =>
  db.query(`select public.set_reward_redemption_status($1,$2,$3,$4)`, [
    id,
    s,
    ids.admin,
    note,
  ]);
const redeem = async () =>
  (
    await one(
      `select public.redeem_reward($1,$2,'pickup','Local Tester','000') as result`,
      [ids.reporter, ids.reward],
    )
  ).result.redemption_id;
await check(
  "historical charge backfill and refund use original 40 points after price changes to 90",
  async () => {
    assert.equal(
      (
        await one(
          "select point_cost from public.reward_redemptions where id=$1",
          [ids.legacy],
        )
      ).point_cost,
      40,
    );
    await status(ids.legacy, "cancelled");
    assert.equal(
      (
        await one("select balance from public.point_wallets where user_id=$1", [
          ids.reporter,
        ])
      ).balance,
      100,
    );
    assert.equal(
      (
        await one("select stock from public.reward_items where id=$1", [
          ids.reward,
        ])
      ).stock,
      1,
    );
    assert.equal(
      (
        await one(
          "select amount from public.point_transactions where ref_redemption_id=$1 and transaction_type='refund'",
          [ids.legacy],
        )
      ).amount,
      40,
    );
    await rejected(
      "select public.set_reward_redemption_status($1,$2,$3,$4)",
      [ids.legacy, "cancelled", ids.admin, "Again"],
      /not available/,
    );
  },
);
await check(
  "out of stock leaves balance, ledger and request count unchanged",
  async () => {
    const before = await one(
      "select (select count(*) from public.reward_redemptions) requests,(select count(*) from public.point_transactions) ledger",
    );
    await rejected(
      `select public.redeem_reward($1,$2,'pickup','Local Tester','000')`,
      [ids.reporter, ids.reward],
      /out of stock/,
    );
    assert.deepEqual(
      await one(
        "select (select count(*) from public.reward_redemptions) requests,(select count(*) from public.point_transactions) ledger",
      ),
      before,
    );
    assert.equal(
      (
        await one("select balance from public.point_wallets where user_id=$1", [
          ids.reporter,
        ])
      ).balance,
      60,
    );
  },
);
await check(
  "insufficient points leaves stock and wallet unchanged",
  async () => {
    await db.query("update public.reward_items set stock=1 where id=$1", [
      ids.reward,
    ]);
    await rejected(
      `select public.redeem_reward($1,$2,'pickup','Local Tester','000')`,
      [ids.reporter, ids.reward],
      /Insufficient/,
    );
    assert.equal(
      (
        await one("select stock from public.reward_items where id=$1", [
          ids.reward,
        ])
      ).stock,
      1,
    );
    assert.equal(
      (
        await one("select balance from public.point_wallets where user_id=$1", [
          ids.reporter,
        ])
      ).balance,
      60,
    );
  },
);
await check(
  "approval is required before delivery; each stage records actor/time and notifications",
  async () => {
    await rejected(
      "select public.set_reward_redemption_status($1,$2,$3,$4)",
      [ids.legacy, "fulfilled", ids.admin, "Skip"],
      /not available/,
    );
    await rejected(
      "select public.set_reward_redemption_status($1,$2,$3,$4)",
      [ids.legacy, "approved", ids.technician, "No access"],
      /Administrator/,
    );
    await status(ids.legacy, "approved");
    const row = await one(
      "select approved_at,approved_by from public.reward_redemptions where id=$1",
      [ids.legacy],
    );
    assert.equal(row.approved_by, ids.admin);
    assert.ok(row.approved_at);
    await status(ids.legacy, "fulfilled");
    assert.ok(
      (
        await one(
          "select fulfilled_at from public.reward_redemptions where id=$1",
          [ids.legacy],
        )
      ).fulfilled_at,
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from public.notifications where user_id=$1 and type='reward_status'",
          [ids.reporter],
        )
      ).n,
      2,
    );
    await rejected(
      "select public.set_reward_redemption_status($1,$2,$3,$4)",
      [ids.legacy, "cancelled", ids.admin, "After delivery"],
      /not available/,
    );
  },
);
await check(
  "new redemption reserves once, notifies admin and approved cancellation refunds snapshot",
  async () => {
    await db.query(
      "update public.reward_items set stock=1,point_cost=20 where id=$1",
      [ids.reward],
    );
    const id = await redeem();
    assert.equal(
      (
        await one("select balance from public.point_wallets where user_id=$1", [
          ids.reporter,
        ])
      ).balance,
      40,
    );
    assert.equal(
      (
        await one("select stock from public.reward_items where id=$1", [
          ids.reward,
        ])
      ).stock,
      0,
    );
    assert.ok(
      (
        await one(
          "select count(*)::int n from public.notifications where user_id=$1 and type='reward_status'",
          [ids.admin],
        )
      ).n > 0,
    );
    await rejected(
      `select public.redeem_reward($1,$2,'pickup','Local Tester','000')`,
      [ids.reporter, ids.reward],
      /out of stock/,
    );
    await status(id, "approved");
    await db.query(
      "update public.reward_items set point_cost=500 where id=$1",
      [ids.reward],
    );
    await status(id, "cancelled");
    assert.equal(
      (
        await one("select balance from public.point_wallets where user_id=$1", [
          ids.reporter,
        ])
      ).balance,
      60,
    );
  },
);
await check(
  "PM records execution, clamps month end and preserves latest schedule on backdated logs",
  async () => {
    const id = (
      await one(
        `insert into public.pm_schedules(location_id,location_label,asset_name,plan_details,interval_months,last_done_at,next_due_at,assigned_technician_id)
    values($1,'Test','Local PM','Local maintenance plan',1,null,'2026-01-31T00:00:00+07:00',$2) returning id`,
        [ids.location, ids.technician],
      )
    ).id;
    const logSql = `insert into public.pm_logs(schedule_id,technician_id,completed_at,notes) values($1,$2,$3,'Local maintenance result')`;
    await rejected(
      logSql,
      [id, ids.admin, "2026-01-31T00:00:00+07:00"],
      /not assigned/,
    );
    await db.query(logSql, [id, ids.technician, "2026-01-31T00:00:00+07:00"]);
    assert.equal(
      (
        await one("select next_due_at from public.pm_schedules where id=$1", [
          id,
        ])
      ).next_due_at.toISOString(),
      "2026-02-27T17:00:00.000Z",
    );
    await db.query(logSql, [id, ids.technician, "2026-01-01T00:00:00+07:00"]);
    assert.equal(
      (
        await one("select next_due_at from public.pm_schedules where id=$1", [
          id,
        ])
      ).next_due_at.toISOString(),
      "2026-02-27T17:00:00.000Z",
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from public.pm_logs where schedule_id=$1",
          [id],
        )
      ).n,
      2,
    );
    await rejected(logSql, [id, ids.technician, "2099-01-01"], /invalid/);
  },
);
await check(
  "points awarded only after dispatcher closure, use assigned SLA snapshot and earn once",
  async () => {
    const id = (
      await one(
        `insert into public.incidents(location_id,location_label,category,urgency_reported,urgency_verified,urgency_verified_by,urgency_verified_at,description,reporter_id)
    values($1,'Test','ไฟฟ้า','urgent','urgent',$3,now(),'Local integration incident',$2) returning id`,
        [ids.location, ids.reporter, ids.dispatcher],
      )
    ).id;
    const work = (
      await one(
        `insert into public.work_orders(incident_id,technician_id,assigned_by,respond_due_at,resolve_due_at,sla_point_value)
    values($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours',37) returning id`,
        [id, ids.technician, ids.dispatcher],
      )
    ).id;
    await db.query(
      "update public.incidents set status='pending_repair_approval' where id=$1",
      [id],
    );
    assert.equal(
      (
        await one(
          "select count(*)::int n from public.point_transactions where ref_incident_id=$1",
          [id],
        )
      ).n,
      0,
    );
    await rejected(
      "update public.incidents set status='done' where id=$1",
      [id],
      /Assigned SLA/,
    );
    await db.query("update public.work_orders set status='done' where id=$1", [
      work,
    ]);
    await db.query(
      "insert into public.work_order_history(work_order_id,status,changed_by,event_type) values($1,'done',$2,'completion')",
      [work, ids.dispatcher],
    );
    await db.query("update public.incidents set status='done' where id=$1", [
      id,
    ]);
    assert.equal(
      (
        await one(
          "select amount from public.point_transactions where ref_incident_id=$1",
          [id],
        )
      ).amount,
      37,
    );
    await db.query("update public.incidents set status='done' where id=$1", [
      id,
    ]);
    assert.equal(
      (
        await one(
          "select count(*)::int n from public.point_transactions where ref_incident_id=$1",
          [id],
        )
      ).n,
      1,
    );
  },
);
await check(
  "browser roles cannot call privileged redemption RPCs",
  async () => {
    for (const role of ["anon", "authenticated"]) {
      const row = await one(
        `select has_function_privilege($1,'public.redeem_reward(uuid,uuid,reward_fulfillment_method,text,text,text,text)','execute') allowed`,
        [role],
      );
      assert.equal(row.allowed, false);
    }
  },
);
await check("campaign expiry respects Thai end date without resetting permanent points", async () => {
  const campaign = (await one(`insert into public.reward_campaigns(name,period_type,start_date,end_date,prize_description,status)
    values('Local expired campaign','custom',(now() at time zone 'Asia/Bangkok')::date-2,(now() at time zone 'Asia/Bangkok')::date-1,'Local prize','active') returning id`)).id;
  const before = await one('select balance from public.point_wallets where user_id=$1', [ids.reporter]);
  await db.query('select public.finalize_expired_campaigns()');
  assert.equal((await one('select status from public.reward_campaigns where id=$1', [campaign])).status, 'ended');
  assert.deepEqual(await one('select balance from public.point_wallets where user_id=$1', [ids.reporter]), before);
});
await writeFile(
  new URL("artifacts/plan3-database-test-results.json", root),
  JSON.stringify(
    {
      engine:
        "PGlite 0.5.8 / PostgreSQL 18; schema captured from Supabase PostgreSQL 17",
      results,
    },
    null,
    2,
  ),
);
await db.close();
console.log(`${results.length} local database checks passed`);

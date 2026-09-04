import { assertEquals } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ActivityHistoryRepository } from "../supabase/functions/isri-api/repositories/activityHistoryRepository.ts";

type Row = Record<string, unknown>;
function fixture(extra = 0) {
  const incidents = Array.from({ length: 6 + extra }, (_, i) => ({
    id: `i${String(i + 1).padStart(4, "0")}`,
    ticket_number: `T${i + 1}`,
    reporter_id: i === 5 ? "other" : "reporter",
    status:
      i === 3 ? "rejected" : i === 4 ? "pending_assignment" : "in_progress",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    rejected_by: i === 3 ? "dispatcher" : null,
    rejected_at: i === 3 ? "2026-08-02T00:00:00Z" : null,
    rejection_reason: i === 3 ? "duplicate" : null,
    category: "test",
    location_label: "test",
    asset_name: null,
    description: "test",
  }));
  const orders = [
    {
      id: "w1",
      incident_id: "i0001",
      technician_id: "technician",
      assigned_by: "dispatcher",
      status: "pending",
    },
    {
      id: "w2",
      incident_id: "i0002",
      technician_id: "other",
      assigned_by: "other",
      status: "done",
    },
    {
      id: "w3",
      incident_id: "i0003",
      technician_id: "other",
      assigned_by: "other",
      status: "in_progress",
    },
    {
      id: "w6",
      incident_id: "i0006",
      technician_id: "other",
      assigned_by: "other",
      status: "done",
    },
  ].map((row) => ({
    ...row,
    assigned_at: "2026-08-01T01:00:00Z",
    updated_at: "2026-08-05T00:00:00Z",
  }));
  const events = [
    {
      id: "e1",
      work_order_id: "w3",
      changed_by: "technician",
      changed_at: "2026-08-02T00:00:00Z",
      status: "pending_repair_approval",
      event_type: "completion",
      note: "repair done",
    },
    {
      id: "e2",
      work_order_id: "w3",
      changed_by: "dispatcher",
      changed_at: "2026-08-03T00:00:00Z",
      status: "in_progress",
      event_type: "repair_note",
      note: "rework",
    },
  ];
  const tables: Record<string, Row[]> = {
    incidents,
    work_orders: orders,
    work_order_history: events,
    work_order_assignees: [
      { work_order_id: "w2", technician_id: "technician" },
    ],
  };
  const db = createClient("http://fixture.invalid", "fixture-key", {
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").pop()!;
        let rows = [...tables[table]];
        for (const [key, value] of url.searchParams) {
          if (value.startsWith("eq."))
            rows = rows.filter((row) => String(row[key]) === value.slice(3));
          if (value.startsWith("in.(")) {
            const values = value.slice(4, -1).split(",");
            rows = rows.filter((row) => values.includes(String(row[key])));
          }
        }
        const order = url.searchParams.get("order")?.split(".")[0];
        if (order)
          rows.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        rows = rows.slice(
          offset,
          offset + Number(url.searchParams.get("limit") ?? 1000),
        );
        if (
          table === "incidents" &&
          url.searchParams.get("select")?.includes("work_orders(")
        )
          rows = rows.map((row) => ({
            ...row,
            work_orders: orders.filter((order) => order.incident_id === row.id),
          }));
        return new Response(JSON.stringify(rows), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  return new ActivityHistoryRepository(db);
}
Deno.test(
  "history scopes reporter, technician/support/past actor, dispatcher/rejection and admin",
  async () => {
    const repo = fixture();
    const ids = (rows: Awaited<ReturnType<typeof repo.listForActor>>) =>
      rows.map((row) => row.id).sort();
    assertEquals(ids(await repo.listForActor("reporter", "reporter")), [
      "i0001",
      "i0002",
      "i0003",
      "i0004",
      "i0005",
    ]);
    assertEquals(ids(await repo.listForActor("technician", "technician")), [
      "i0001",
      "i0002",
      "i0003",
    ]);
    assertEquals(ids(await repo.listForActor("dispatcher", "dispatcher")), [
      "i0001",
      "i0003",
      "i0004",
    ]);
    assertEquals((await repo.listForActor("admin", "admin")).length, 6);
  },
);
Deno.test("history details deny unrelated users and empty scopes", async () => {
  const repo = fixture();
  for (const role of ["reporter", "technician", "dispatcher"] as const) {
    assertEquals(await repo.listForActor(role, role, "i0006"), []);
    assertEquals(await repo.listForActor("nobody", role), []);
  }
});
Deno.test(
  "history keeps rework context, current state and personal action separate",
  async () => {
    const [row] = await fixture().listForActor(
      "technician",
      "technician",
      "i0003",
    );
    assertEquals(row.status, "in_progress");
    assertEquals(row.latestEvent.note, "rework");
    assertEquals(row.latestEvent.previous_status, "pending_repair_approval");
    assertEquals(row.myLatestEvent?.status, "pending_repair_approval");
  },
);
Deno.test(
  "history includes unassigned and rejected incidents without a work order",
  async () => {
    const repo = fixture();
    const [rejected] = await repo.listForActor(
      "dispatcher",
      "dispatcher",
      "i0004",
    );
    assertEquals(rejected.workOrderId, null);
    assertEquals(rejected.latestEvent.event_type, "incident_rejected");
    assertEquals(rejected.myLatestEvent?.note, "duplicate");
    const [pending] = await repo.listForActor("reporter", "reporter", "i0005");
    assertEquals(pending.status, "pending_assignment");
    assertEquals(pending.latestEvent.event_type, "incident_created");
  },
);
Deno.test("history reads beyond the database page limit", async () => {
  assertEquals((await fixture(510).listForActor("admin", "admin")).length, 516);
});

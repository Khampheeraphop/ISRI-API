import { assertEquals, assertRejects } from "jsr:@std/assert";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DashboardRepository } from "../supabase/functions/isri-api/repositories/dashboardRepository.ts";
type Row = Record<string, unknown>;
function fixture(tables: Record<string, Row[]>, failTable?: string) {
  return new DashboardRepository(
    createClient("http://fixture.invalid", "fixture-key", {
      global: {
        fetch: async (input) => {
          const url = new URL(String(input));
          const table = url.pathname.split("/").pop()!;
          if (table === failTable)
            return Response.json(
              { message: "fixture database failure" },
              { status: 500 },
            );
          let rows = [...(tables[table] ?? [])];
          for (const [key, value] of url.searchParams) {
            if (value.startsWith("eq."))
              rows = rows.filter((r) => String(r[key]) === value.slice(3));
            if (value.startsWith("gte."))
              rows = rows.filter(
                (r) => Date.parse(String(r[key])) >= Date.parse(value.slice(4)),
              );
            if (value.startsWith("lt."))
              rows = rows.filter(
                (r) => Date.parse(String(r[key])) < Date.parse(value.slice(3)),
              );
            if (value.startsWith("in.("))
              rows = rows.filter((r) =>
                value.slice(4, -1).split(",").includes(String(r[key])),
              );
          }
          rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          const offset = Number(url.searchParams.get("offset") ?? 0);
          return Response.json(
            rows.slice(
              offset,
              offset + Number(url.searchParams.get("limit") ?? 1000),
            ),
          );
        },
      },
    }),
  );
}
Deno.test(
  "dashboard aggregates more than 1000 reports without losing totals",
  async () => {
    const repo = fixture({
      incidents: Array.from({ length: 1201 }, (_, i) => ({
        id: `i${i}`,
        status: "submitted",
        created_at: "2026-09-01T00:00:00Z",
        location_id: "l1",
        location_label: "A",
        asset_name: null,
      })),
    });
    assertEquals(
      (await repo.getMonthlyReportingCounts("2026-09")).at(-1)?.count,
      1201,
    );
    const summary = await repo.summary("2026-09");
    assertEquals(summary.statusCounts, [{ status: "submitted", count: 1201 }]);
    assertEquals(summary.attention.pendingAssignment, 1201);
    assertEquals(summary.hotspots[0].count, 1201);
  },
);
Deno.test(
  "dashboard PM uses execution month and reflects new due date and technician assignment",
  async () => {
    const tables = {
      pm_schedules: [
        {
          id: "p1",
          location_label: "A",
          asset_name: "Lamp",
          next_due_at: "2099-01-01T00:00:00Z",
          assigned_technician_id: "t1",
        },
      ],
      profiles: [
        {
          id: "t1",
          full_name: "Tech",
          role: "technician",
          approval_status: "approved",
        },
      ],
      pm_logs: [
        {
          id: "l1",
          schedule_id: "p1",
          completed_at: "2026-08-31T17:00:00Z",
          created_at: "2026-10-01T00:00:00Z",
          notes: "Changed lamp",
          profiles: { full_name: "Tech" },
          pm_schedules: { asset_name: "Lamp", location_label: "A" },
        },
        {
          id: "l2",
          schedule_id: "p1",
          completed_at: "2026-09-30T17:00:00Z",
          created_at: "2026-10-01T00:00:00Z",
          notes: "Next month",
        },
      ],
    };
    const summary = await fixture(tables).summary("2026-09");
    assertEquals(summary.pm.completedCount, 1);
    assertEquals(summary.pm.completedPlanCount, 1);
    assertEquals(summary.pm.latestCompletions[0].technicianName, "Tech");
    assertEquals(summary.pm.latestCompletions[0].notes, "Changed lamp");
    assertEquals(summary.pm.unassignedCount, 0);
    assertEquals(summary.pm.overdueCount, 0);
    assertEquals(summary.technicianWorkload[0].pmAssignedCount, 1);
  },
);
Deno.test(
  "dashboard propagates query failures instead of displaying misleading zero metrics",
  async () => {
    await assertRejects(async () => {
      await fixture({}, "pm_logs").summary("2026-09");
    });
  },
);

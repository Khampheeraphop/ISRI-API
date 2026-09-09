import { assertEquals } from "jsr:@std/assert";
import {
  calculateDashboardSla, calculateHotspots, calculateTechnicianWorkload,
  type DashboardOrder,
} from "../supabase/functions/isri-api/_shared/dashboardMetrics.ts";

const order: DashboardOrder = {
  id: "w1", incident_id: "i1", technician_id: "t1", status: "done",
  assigned_at: "2026-08-31T16:00:00Z", respond_due_at: "2026-08-31T17:00:00Z",
  resolve_due_at: "2026-09-30T17:00:00Z", created_at: "2026-09-01T00:00:00Z",
};
const starts = [{ id: "i1", created_at: "2026-08-31T16:00:00Z" }];
Deno.test("KPI includes Thai month start, excludes next month closure and counts first acceptance only", () => {
  const history = [
    { id: "3", work_order_id: "w1", status: "done", changed_at: "2026-09-30T17:00:00Z" },
    { id: "2", work_order_id: "w1", status: "in_progress", changed_at: "2026-09-05T01:00:00Z" },
    { id: "1", work_order_id: "w1", status: "in_progress", changed_at: "2026-08-31T17:00:00Z" },
  ];
  assertEquals(calculateDashboardSla([order], history, starts, "2026-09"), {
    responseOnTimeRate: 100, averageResponseMinutes: 60,
    resolutionOnTimeRate: null, averageClosureMinutes: null,
    respondedCount: 1, closedCount: 0, responseOnTimeCount: 1, resolutionOnTimeCount: 0,
  });
  const october = calculateDashboardSla([order], history, starts, "2026-10");
  assertEquals(october.respondedCount, 0);
  assertEquals(october.closedCount, 1);
  assertEquals(october.resolutionOnTimeRate, 100);
});
Deno.test("KPI rework does not move an earlier acceptance into the selected month", () => {
  const result = calculateDashboardSla([order], [
    { id: "1", work_order_id: "w1", status: "in_progress", changed_at: "2026-08-31T16:30:00Z" },
    { id: "2", work_order_id: "w1", status: "in_progress", changed_at: "2026-09-01T17:00:00Z" },
    { id: "3", work_order_id: "w1", status: "done", changed_at: "2026-09-01T18:00:00Z" },
  ], starts, "2026-09");
  assertEquals(result.respondedCount, 0);
  assertEquals(result.closedCount, 1);
  assertEquals(result.averageClosureMinutes, 1080);
});
Deno.test("KPI excludes unresolved orders from rates and shows null without valid samples", () => {
  const result = calculateDashboardSla([order], [], starts, "2026-09");
  assertEquals(result.responseOnTimeRate, null);
  assertEquals(result.averageClosureMinutes, null);
  const invalid = calculateDashboardSla([{ ...order, created_at: "2026-09-02T00:00:00Z" }], [
    { id: "1", work_order_id: "w1", status: "done", changed_at: "2026-09-01T00:00:00Z" },
  ], [{ id: "i1", created_at: "2026-09-02T00:00:00Z" }], "2026-09");
  assertEquals(invalid.closedCount, 0);
});
Deno.test("workload counts both roles once, includes old backlog, excludes closed work from backlog", () => {
  const rows = calculateTechnicianWorkload([{ id: "t1", full_name: "Main" }, { id: "t2", full_name: "Support" }], [
    { ...order, status: "pending_repair_approval", resolve_due_at: "2026-09-01T00:00:00Z" },
    { ...order, id: "w2", assigned_at: "2026-09-02T00:00:00Z" },
  ], [
    { work_order_id: "w1", technician_id: "t1", assignment_role: "primary" },
    { work_order_id: "w1", technician_id: "t2", assignment_role: "support" },
    { work_order_id: "w2", technician_id: "t2", assignment_role: "support" },
  ], [{ assigned_technician_id: "t2", next_due_at: "2026-09-02T00:00:00Z" }], "2026-09", new Date("2026-09-05T00:00:00Z"));
  assertEquals(rows.map((row) => [row.assignedCount, row.primaryCount, row.supportCount, row.activeCount, row.overdueCount, row.pendingReviewCount]), [
    [1, 1, 0, 1, 1, 1], [1, 0, 1, 1, 1, 1],
  ]);
  assertEquals(rows[1].pmDueCount, 1);
});
Deno.test("hotspots group hierarchy, retain distinct area IDs and ignore rejected reports", () => {
  const base = { id: "i", location_id: "l1", location_label: "same label", asset_name: "lamp", status: "done", created_at: "2026-09-01" };
  const groups = calculateHotspots([
    base, { ...base, id: "2", status: "in_progress" },
    { ...base, id: "3", location_id: "l2" },
    { ...base, id: "4", location_id: "l2", status: "rejected" },
  ], [{ id: "l1", building: "A", floor: "1", zone: "x" }, { id: "l2", building: "A", floor: "1", zone: "y" }]);
  assertEquals(groups.building[0].count, 3);
  assertEquals(groups.floor[0].count, 3);
  assertEquals(groups.area.length, 1);
  assertEquals(groups.asset[0].count, 2);
  assertEquals(groups.asset[0].openCount, 1);
});

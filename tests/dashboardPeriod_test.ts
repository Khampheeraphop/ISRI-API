import { assertEquals } from "jsr:@std/assert";
import {
  getBangkokPeriodMonth,
  getDashboardMonthRange,
  getDashboardReportingPeriod,
} from "../supabase/functions/isri-api/_shared/dashboardPeriod.ts";

Deno.test("dashboard month range uses Bangkok calendar boundaries", () => {
  const range = getDashboardMonthRange("2026-08");

  assertEquals(range.since.toISOString(), "2026-07-31T17:00:00.000Z");
  assertEquals(range.until.toISOString(), "2026-08-31T17:00:00.000Z");
});

Deno.test("dashboard reporting period keeps six Thai calendar months across years", () => {
  const period = getDashboardReportingPeriod("2026-01");

  assertEquals(period.months, [
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
  ]);
  assertEquals(period.since.toISOString(), "2025-07-31T17:00:00.000Z");
  assertEquals(period.until.toISOString(), "2026-01-31T17:00:00.000Z");
});

Deno.test("dashboard groups timestamps by Bangkok month", () => {
  assertEquals(
    getBangkokPeriodMonth("2026-07-31T16:30:00.000Z"),
    "2026-07",
  );
  assertEquals(
    getBangkokPeriodMonth("2026-07-31T18:30:00.000Z"),
    "2026-08",
  );
});

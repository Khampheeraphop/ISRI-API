import type { DatabaseClient } from "../_shared/types.ts";
import {
  getBangkokPeriodMonth,
  getDashboardMonthRange,
  getDashboardReportingPeriod,
} from "../_shared/dashboardPeriod.ts";
import {
  activeIncidentStatuses,
  activeWorkOrderStatuses,
  calculateDashboardSla,
  calculateHotspots,
  calculateTechnicianWorkload,
  type DashboardAssignment,
  type DashboardEvent,
  type DashboardIncident,
  type DashboardLocation,
  type DashboardOrder,
} from "../_shared/dashboardMetrics.ts";

// Supabase caps rows per request. Page aggregates to avoid silently truncated totals.
async function readAll<T>(query: {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: unknown }>;
}): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query.range(from, from + 499);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
const incidentColumns =
  "id, location_id, location_label, asset_name, status, created_at";
const orderColumns =
  "id, incident_id, technician_id, status, respond_due_at, resolve_due_at, assigned_at, created_at";
type Plan = {
  id: string;
  location_label: string;
  asset_name: string;
  next_due_at: string;
  assigned_technician_id: string | null;
};
type PmLog = {
  id: string;
  schedule_id: string;
  completed_at: string;
  created_at: string;
  notes: string;
  profiles: { full_name: string } | null;
  pm_schedules: { asset_name: string; location_label: string } | null;
};
export class DashboardRepository {
  constructor(private readonly db: DatabaseClient) {}
  async getMonthlyReportingCounts(month: string) {
    const period = getDashboardReportingPeriod(month);
    const counts = new Map(period.months.map((value) => [value, 0]));
    const rows = await readAll(
      this.db
        .from("incidents")
        .select("id,created_at")
        .gte("created_at", period.since.toISOString())
        .lt("created_at", period.until.toISOString())
        .order("id"),
    );
    for (const row of rows) {
      const key = getBangkokPeriodMonth(row.created_at);
      if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
    }
    return [...counts].map(([month, count]) => ({ month, count }));
  }
  async summary(month: string) {
    const now = new Date();
    const { since, until } = getDashboardMonthRange(month);
    const today = new Date(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
        now,
      ) + "T00:00:00+07:00",
    );
    const pmUntil = new Date(today.getTime() + 31 * 86400000);
    const [
      incidents,
      openIncidents,
      activeOrders,
      periodOrders,
      recentHistory,
      technicians,
      wallets,
      transactions,
      redemptions,
      rewards,
      campaigns,
      plans,
      locations,
      pmLogs,
    ] = await Promise.all([
      readAll(
        this.db
          .from("incidents")
          .select(incidentColumns)
          .gte("created_at", since.toISOString())
          .lt("created_at", until.toISOString())
          .order("id"),
      ),
      readAll(
        this.db
          .from("incidents")
          .select(incidentColumns)
          .in("status", activeIncidentStatuses)
          .order("id"),
      ),
      readAll(
        this.db
          .from("work_orders")
          .select(orderColumns)
          .in("status", activeWorkOrderStatuses)
          .order("id"),
      ),
      readAll(
        this.db
          .from("work_orders")
          .select(orderColumns)
          .gte("assigned_at", since.toISOString())
          .lt("assigned_at", until.toISOString())
          .order("id"),
      ),
      readAll(
        this.db
          .from("work_order_history")
          .select("id,work_order_id,status,changed_at")
          .gte("changed_at", since.toISOString())
          .lt("changed_at", until.toISOString())
          .order("id"),
      ),
      readAll(
        this.db
          .from("profiles")
          .select("id,full_name")
          .eq("approval_status", "approved")
          .eq("role", "technician")
          .order("id"),
      ),
      readAll(
        this.db
          .from("point_wallets")
          .select("user_id,balance")
          .order("user_id"),
      ),
      readAll(
        this.db
          .from("point_transactions")
          .select("id,amount,transaction_type")
          .gte("created_at", since.toISOString())
          .lt("created_at", until.toISOString())
          .order("id"),
      ),
      readAll(
        this.db
          .from("reward_redemptions")
          .select("id")
          .gte("redeemed_at", since.toISOString())
          .lt("redeemed_at", until.toISOString())
          .order("id"),
      ),
      readAll(
        this.db
          .from("reward_items")
          .select("id")
          .eq("is_active", true)
          .order("id"),
      ),
      readAll(
        this.db
          .from("reward_campaigns")
          .select("id")
          .eq("status", "active")
          .order("id"),
      ),
      readAll(
        this.db
          .from("pm_schedules")
          .select(
            "id,location_label,asset_name,next_due_at,assigned_technician_id",
          )
          .order("id"),
      ),
      readAll(
        this.db
          .from("managed_locations")
          .select("id,building,floor,zone")
          .order("id"),
      ),
      readAll(
        this.db
          .from("pm_logs")
          .select(
            "id,schedule_id,completed_at,created_at,notes,profiles!pm_logs_technician_id_fkey(full_name),pm_schedules(asset_name,location_label)",
          )
          .gte("completed_at", since.toISOString())
          .lt("completed_at", until.toISOString())
          .order("id"),
      ),
    ]);
    const recentIds = [
      ...new Set(recentHistory.map((row) => row.work_order_id)),
    ];
    const recentOrders: DashboardOrder[] = [],
      fullHistory: DashboardEvent[] = [];
    for (let offset = 0; offset < recentIds.length; offset += 200) {
      const ids = recentIds.slice(offset, offset + 200);
      const [orders, events] = await Promise.all([
        readAll(
          this.db
            .from("work_orders")
            .select(orderColumns)
            .in("id", ids)
            .order("id"),
        ),
        readAll(
          this.db
            .from("work_order_history")
            .select("id,work_order_id,status,changed_at")
            .in("work_order_id", ids)
            .order("id"),
        ),
      ]);
      recentOrders.push(...orders);
      fullHistory.push(...events);
    }
    const incidentIds = [
      ...new Set(recentOrders.map((row) => row.incident_id)),
    ];
    const starts: Array<{ id: string; created_at: string }> = [];
    for (let offset = 0; offset < incidentIds.length; offset += 200)
      starts.push(
        ...(await readAll(
          this.db
            .from("incidents")
            .select("id,created_at")
            .in("id", incidentIds.slice(offset, offset + 200))
            .order("id"),
        )),
      );
    const workloadOrders = [
      ...new Map(
        [...activeOrders, ...periodOrders].map((row) => [row.id, row]),
      ).values(),
    ] as DashboardOrder[];
    const teams: DashboardAssignment[] = [];
    for (let offset = 0; offset < workloadOrders.length; offset += 200)
      teams.push(
        ...(await readAll(
          this.db
            .from("work_order_assignees")
            .select("work_order_id,technician_id,assignment_role")
            .in(
              "work_order_id",
              workloadOrders.slice(offset, offset + 200).map((row) => row.id),
            )
            .order("work_order_id")
            .order("technician_id"),
        )),
      );
    const hotspotGroups = calculateHotspots(
      incidents as DashboardIncident[],
      locations as DashboardLocation[],
    );
    const pmPlans = plans as Plan[];
    const logs = pmLogs as unknown as PmLog[];
    const duePlans = pmPlans
      .filter((plan) => Date.parse(plan.next_due_at) < pmUntil.getTime())
      .sort(
        (a, b) =>
          Date.parse(a.next_due_at) - Date.parse(b.next_due_at) ||
          a.id.localeCompare(b.id),
      );
    return {
      generatedAt: now.toISOString(),
      periodMonth: month,
      attention: {
        overdue: activeOrders.filter(
          (row) => Date.parse(row.resolve_due_at) < now.getTime(),
        ).length,
        nearDue: activeOrders.filter((row) => {
          const diff = Date.parse(row.resolve_due_at) - now.getTime();
          return diff >= 0 && diff <= 86400000;
        }).length,
        pendingAssignment: openIncidents.filter((row) =>
          ["submitted", "pending_assignment"].includes(row.status),
        ).length,
      },
      sla: calculateDashboardSla(recentOrders, fullHistory, starts, month),
      statusCounts: Object.entries(
        incidents.reduce<Record<string, number>>((counts, row) => {
          counts[row.status] = (counts[row.status] ?? 0) + 1;
          return counts;
        }, {}),
      ).map(([status, count]) => ({ status, count })),
      hotspots: hotspotGroups.asset,
      hotspotGroups,
      technicianWorkload: calculateTechnicianWorkload(
        technicians,
        workloadOrders,
        teams,
        pmPlans,
        month,
        now,
      ),
      pm: {
        overdueCount: duePlans.filter(
          (plan) => Date.parse(plan.next_due_at) < today.getTime(),
        ).length,
        dueSoonCount: duePlans.filter(
          (plan) => Date.parse(plan.next_due_at) >= today.getTime(),
        ).length,
        unassignedCount: pmPlans.filter((plan) => !plan.assigned_technician_id)
          .length,
        completedCount: logs.length,
        completedPlanCount: new Set(logs.map((log) => log.schedule_id)).size,
        items: duePlans.slice(0, 5).map((plan) => ({
          id: plan.id,
          locationLabel: plan.location_label,
          assetName: plan.asset_name,
          nextDueAt: plan.next_due_at,
          state:
            Date.parse(plan.next_due_at) < today.getTime()
              ? "overdue"
              : "due_soon",
        })),
        latestCompletions: logs
          .sort(
            (a, b) =>
              Date.parse(b.completed_at) - Date.parse(a.completed_at) ||
              Date.parse(b.created_at) - Date.parse(a.created_at),
          )
          .slice(0, 5)
          .map((log) => ({
            id: log.id,
            scheduleId: log.schedule_id,
            completedAt: log.completed_at,
            recordedAt: log.created_at,
            notes: log.notes,
            technicianName: log.profiles?.full_name ?? "ไม่ระบุ",
            assetName: log.pm_schedules?.asset_name ?? "แผน PM",
            locationLabel: log.pm_schedules?.location_label ?? "",
          })),
      },
      incentives: {
        totalWalletPoints: wallets.reduce(
          (sum, row) => sum + Number(row.balance),
          0,
        ),
        pointsIssued: transactions
          .filter((row) => row.transaction_type === "earn")
          .reduce((sum, row) => sum + Number(row.amount), 0),
        redemptionCount: redemptions.length,
        activeRewardCount: rewards.length,
        activeCampaignCount: campaigns.length,
      },
    };
  }
}

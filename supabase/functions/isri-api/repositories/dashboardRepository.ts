import type { DatabaseClient } from "../_shared/types.ts";
import {
  getBangkokPeriodMonth,
  getDashboardMonthRange,
  getDashboardReportingPeriod,
} from "../_shared/dashboardPeriod.ts";

type IncidentRow = {
  id: string;
  ticket_number: string;
  location_label: string;
  asset_name: string | null;
  category: string;
  urgency_reported: string;
  status: string;
  created_at: string;
};

type WorkOrderRow = {
  id: string;
  incident_id: string;
  technician_id: string;
  status: string;
  respond_due_at: string;
  resolve_due_at: string;
  assigned_at: string | null;
  created_at: string;
};

type HistoryRow = {
  work_order_id: string;
  status: string;
  changed_at: string;
};

type TechnicianRow = { id: string; full_name: string };

type IncidentTimestampRow = { id: string; created_at: string };

type PmScheduleRow = {
  id: string;
  location_label: string;
  asset_name: string;
  next_due_at: string;
};

const activeWorkOrderStatuses = new Set([
  "pending",
  "in_progress",
  "waiting_parts",
  "pending_parts_approval",
  "pending_repair_approval",
]);

const activeIncidentStatuses = [
  "submitted",
  "pending_assignment",
  "assigned",
  "in_progress",
  "pending_parts_approval",
  "waiting_parts",
  "pending_repair_approval",
];

export class DashboardRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getMonthlyReportingCounts(periodMonth: string) {
    const period = getDashboardReportingPeriod(periodMonth);
    const months = new Map(period.months.map((month) => [month, 0]));

    const { data, error } = await this.db
      .from("incidents")
      .select("created_at")
      .gte("created_at", period.since.toISOString())
      .lt("created_at", period.until.toISOString());
    if (error) throw error;

    for (const incident of data ?? []) {
      const month = getBangkokPeriodMonth(String(incident.created_at));
      if (months.has(month)) months.set(month, (months.get(month) ?? 0) + 1);
    }

    return [...months.entries()].map(([month, count]) => ({ month, count }));
  }

  async summary(periodMonth: string) {
    const now = new Date();
    const thaiToday = new Date(now.getTime() + 7 * 3600000)
      .toISOString()
      .slice(0, 10);
    const pmToday = new Date(thaiToday + "T00:00:00+07:00");
    const pmDueSoonUntil = new Date(pmToday);
    pmDueSoonUntil.setUTCDate(pmDueSoonUntil.getUTCDate() + 31);
    const { since, until } = getDashboardMonthRange(periodMonth);

    const [
      incidentsResult,
      openIncidentsResult,
      activeWorkOrdersResult,
      periodWorkOrdersResult,
      recentHistoryResult,
      techniciansResult,
      pointWalletsResult,
      pointTransactionsResult,
      rewardRedemptionsResult,
      activeRewardsResult,
      activeCampaignsResult,
      pmSchedulesResult,
      overduePmCountResult,
      dueSoonPmCountResult,
    ] = await Promise.all([
      this.db
        .from("incidents")
        .select(
          "id, ticket_number, location_label, asset_name, category, urgency_reported, status, created_at",
        )
        .gte("created_at", since.toISOString())
        .lt("created_at", until.toISOString())
        .order("created_at", { ascending: false }),
      this.db
        .from("incidents")
        .select(
          "id, ticket_number, location_label, asset_name, category, urgency_reported, status, created_at",
        )
        .in("status", activeIncidentStatuses),
      this.db
        .from("work_orders")
        .select(
          "id, incident_id, technician_id, status, respond_due_at, resolve_due_at, assigned_at, created_at",
        )
        .in("status", [...activeWorkOrderStatuses]),
      this.db
        .from("work_orders")
        .select(
          "id, incident_id, technician_id, status, respond_due_at, resolve_due_at, assigned_at, created_at",
        )
        .gte("assigned_at", since.toISOString())
        .lt("assigned_at", until.toISOString()),
      this.db
        .from("work_order_history")
        .select("work_order_id, status, changed_at")
        .gte("changed_at", since.toISOString())
        .lt("changed_at", until.toISOString()),
      this.db
        .from("profiles")
        .select("id, full_name")
        .eq("approval_status", "approved")
        .eq("role", "technician")
        .order("full_name"),
      this.db.from("point_wallets").select("balance"),
      this.db
        .from("point_transactions")
        .select("amount, transaction_type")
        .gte("created_at", since.toISOString())
        .lt("created_at", until.toISOString()),
      this.db
        .from("reward_redemptions")
        .select("id")
        .gte("redeemed_at", since.toISOString())
        .lt("redeemed_at", until.toISOString()),
      this.db.from("reward_items").select("id").eq("is_active", true),
      this.db.from("reward_campaigns").select("id").eq("status", "active"),
      this.db
        .from("pm_schedules")
        .select("id, location_label, asset_name, next_due_at")
        .lt("next_due_at", pmDueSoonUntil.toISOString())
        .order("next_due_at")
        .limit(5),
      this.db
        .from("pm_schedules")
        .select("id", { count: "exact", head: true })
        .lt("next_due_at", pmToday.toISOString()),
      this.db
        .from("pm_schedules")
        .select("id", { count: "exact", head: true })
        .gte("next_due_at", pmToday.toISOString())
        .lt("next_due_at", pmDueSoonUntil.toISOString()),
    ]);

    for (
      const result of [
        incidentsResult,
        openIncidentsResult,
        activeWorkOrdersResult,
        periodWorkOrdersResult,
        recentHistoryResult,
        techniciansResult,
        pointWalletsResult,
        pointTransactionsResult,
        rewardRedemptionsResult,
        activeRewardsResult,
        activeCampaignsResult,
        pmSchedulesResult,
        overduePmCountResult,
        dueSoonPmCountResult,
      ]
    ) {
      if (result.error) throw result.error;
    }

    const incidents = (incidentsResult.data ?? []) as IncidentRow[];
    const openIncidents = (openIncidentsResult.data ?? []) as IncidentRow[];
    const activeWorkOrders = (activeWorkOrdersResult.data ??
      []) as WorkOrderRow[];
    const periodWorkOrders = (periodWorkOrdersResult.data ??
      []) as WorkOrderRow[];
    const recentHistory = (recentHistoryResult.data ?? []) as HistoryRow[];
    const technicians = (techniciansResult.data ?? []) as TechnicianRow[];
    const pmSchedules = (pmSchedulesResult.data ?? []) as PmScheduleRow[];
    const totalWalletPoints = (pointWalletsResult.data ?? []).reduce(
      (sum, wallet) => sum + Number(wallet.balance),
      0,
    );
    const pointsIssued = (pointTransactionsResult.data ?? []).reduce(
      (sum, transaction) =>
        transaction.transaction_type === "earn"
          ? sum + Number(transaction.amount)
          : sum,
      0,
    );

    const recentOrderIds = [
      ...new Set(recentHistory.map((event) => event.work_order_id)),
    ];
    const [recentOrdersResult, recentOrderHistoryResult] = recentOrderIds.length
      ? await Promise.all([
        this.db
          .from("work_orders")
          .select(
            "id, incident_id, technician_id, status, respond_due_at, resolve_due_at, assigned_at, created_at",
          )
          .in("id", recentOrderIds),
        this.db
          .from("work_order_history")
          .select("work_order_id, status, changed_at")
          .in("work_order_id", recentOrderIds)
          .order("changed_at"),
      ])
      : [
        { data: [], error: null },
        { data: [], error: null },
      ];
    if (recentOrdersResult.error) throw recentOrdersResult.error;
    if (recentOrderHistoryResult.error) throw recentOrderHistoryResult.error;

    const recentOrders = (recentOrdersResult.data ?? []) as WorkOrderRow[];
    const recentIncidentIds = [
      ...new Set(recentOrders.map((order) => order.incident_id)),
    ];
    const recentIncidentsResult = recentIncidentIds.length
      ? await this.db
        .from("incidents")
        .select("id, created_at")
        .in("id", recentIncidentIds)
      : { data: [], error: null };
    if (recentIncidentsResult.error) throw recentIncidentsResult.error;
    const fullRecentOrderHistory = (recentOrderHistoryResult.data ??
      []) as HistoryRow[];
    const recentIncidentCreatedAt = new Map(
      ((recentIncidentsResult.data ?? []) as IncidentTimestampRow[]).map(
        (incident) => [incident.id, incident.created_at],
      ),
    );
    const historyByWorkOrder = new Map<string, HistoryRow[]>();
    for (const event of fullRecentOrderHistory) {
      const events = historyByWorkOrder.get(event.work_order_id) ?? [];
      events.push(event);
      historyByWorkOrder.set(event.work_order_id, events);
    }

    const openWorkOrders = activeWorkOrders;
    const overdue = openWorkOrders.filter(
      (item) => new Date(item.resolve_due_at) < now,
    );
    const nearDue = openWorkOrders.filter((item) => {
      const due = new Date(item.resolve_due_at).getTime();
      const remaining = due - now.getTime();
      return remaining >= 0 && remaining <= 24 * 60 * 60 * 1000;
    });
    const pendingAssignment = openIncidents.filter(
      (item) =>
        item.status === "submitted" || item.status === "pending_assignment",
    );

    const acceptedAt = (order: WorkOrderRow) =>
      (historyByWorkOrder.get(order.id) ?? []).find(
        (event) => event.status === "in_progress",
      )?.changed_at;
    const completedAt = (order: WorkOrderRow) =>
      (historyByWorkOrder.get(order.id) ?? []).find(
        (event) => event.status === "done",
      )?.changed_at;
    const responded = recentOrders
      .map((order) => ({
        order,
        occurredAt: acceptedAt(order),
        incidentCreatedAt: recentIncidentCreatedAt.get(order.incident_id),
      }))
      .filter(
        (
          item,
        ): item is {
          order: WorkOrderRow;
          occurredAt: string;
          incidentCreatedAt: string;
        } =>
          item.occurredAt !== undefined &&
          item.incidentCreatedAt !== undefined &&
          new Date(item.occurredAt) >= since,
      );
    const completed = recentOrders
      .map((order) => ({
        order,
        occurredAt: completedAt(order),
        incidentCreatedAt: recentIncidentCreatedAt.get(order.incident_id),
      }))
      .filter(
        (
          item,
        ): item is {
          order: WorkOrderRow;
          occurredAt: string;
          incidentCreatedAt: string;
        } =>
          item.occurredAt !== undefined &&
          item.incidentCreatedAt !== undefined &&
          new Date(item.occurredAt) >= since,
      );
    const responseOnTime = responded.filter(
      ({ order, occurredAt }) =>
        new Date(occurredAt) <= new Date(order.respond_due_at),
    ).length;
    const averageResponseMinutes = responded.length
      ? Math.round(
        responded.reduce(
          (sum, { occurredAt, incidentCreatedAt }) =>
            sum +
            (new Date(occurredAt).getTime() -
                new Date(incidentCreatedAt).getTime()) /
              60000,
          0,
        ) / responded.length,
      )
      : null;
    const resolutionOnTime = completed.filter(
      ({ order, occurredAt }) =>
        new Date(occurredAt) <= new Date(order.resolve_due_at),
    ).length;
    const averageClosureMinutes = completed.length
      ? Math.round(
        completed.reduce(
          (sum, { occurredAt, incidentCreatedAt }) =>
            sum +
            (new Date(occurredAt).getTime() -
                new Date(incidentCreatedAt).getTime()) /
              60000,
          0,
        ) / completed.length,
      )
      : null;

    const hotspotMap = new Map<
      string,
      {
        locationLabel: string;
        assetName: string | null;
        count: number;
        openCount: number;
      }
    >();
    for (const incident of incidents) {
      const key = `${incident.location_label}|${incident.asset_name ?? ""}`;
      const current = hotspotMap.get(key) ?? {
        locationLabel: incident.location_label,
        assetName: incident.asset_name,
        count: 0,
        openCount: 0,
      };
      current.count += 1;
      if (!["done", "rejected"].includes(incident.status)) {
        current.openCount += 1;
      }
      hotspotMap.set(key, current);
    }

    const workloadByTechnician = new Map<string, number>();
    for (const order of periodWorkOrders) {
      workloadByTechnician.set(
        order.technician_id,
        (workloadByTechnician.get(order.technician_id) ?? 0) + 1,
      );
    }

    return {
      generatedAt: now.toISOString(),
      periodMonth,
      attention: {
        overdue: overdue.length,
        nearDue: nearDue.length,
        pendingAssignment: pendingAssignment.length,
      },
      sla: {
        responseOnTimeRate: responded.length
          ? Math.round((responseOnTime / responded.length) * 100)
          : null,
        averageResponseMinutes,
        resolutionOnTimeRate: completed.length
          ? Math.round((resolutionOnTime / completed.length) * 100)
          : null,
        averageClosureMinutes,
      },
      statusCounts: Object.entries(
        incidents.reduce<Record<string, number>>((counts, incident) => {
          counts[incident.status] = (counts[incident.status] ?? 0) + 1;
          return counts;
        }, {}),
      ).map(([status, count]) => ({ status, count })),
      hotspots: [...hotspotMap.values()]
        .filter((item) => item.count >= 2)
        .sort(
          (left, right) =>
            right.count - left.count || right.openCount - left.openCount,
        )
        .slice(0, 5),
      pm: {
        overdueCount: overduePmCountResult.count ?? 0,
        dueSoonCount: dueSoonPmCountResult.count ?? 0,
        items: pmSchedules.map((schedule) => ({
          id: schedule.id,
          locationLabel: schedule.location_label,
          assetName: schedule.asset_name,
          nextDueAt: schedule.next_due_at,
          state: new Date(schedule.next_due_at) < pmToday
            ? "overdue"
            : "due_soon",
        })),
      },
      technicianWorkload: technicians
        .map((technician) => ({
          technicianId: technician.id,
          technicianName: technician.full_name,
          assignedCount: workloadByTechnician.get(technician.id) ?? 0,
        }))
        .sort((left, right) => right.assignedCount - left.assignedCount),
      incentives: {
        totalWalletPoints,
        pointsIssued,
        redemptionCount: (rewardRedemptionsResult.data ?? []).length,
        activeRewardCount: (activeRewardsResult.data ?? []).length,
        activeCampaignCount: (activeCampaignsResult.data ?? []).length,
      },
    };
  }
}

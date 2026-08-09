import type { DatabaseClient } from "../_shared/types.ts";

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

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthBuckets(since: Date, until: Date) {
  const cursor = new Date(since.getFullYear(), since.getMonth(), 1);
  const last = new Date(until.getFullYear(), until.getMonth(), 1);
  const buckets = new Map<string, { reported: number; completed: number }>();
  while (cursor <= last) {
    buckets.set(monthKey(cursor), { reported: 0, completed: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return buckets;
}

export class DashboardRepository {
  constructor(private readonly db: DatabaseClient) {}

  async summary(days: number) {
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - days);

    const [
      incidentsResult,
      openIncidentsResult,
      activeWorkOrdersResult,
      recentHistoryResult,
      techniciansResult,
    ] = await Promise.all([
      this.db
        .from("incidents")
        .select(
          "id, ticket_number, location_label, asset_name, category, urgency_reported, status, created_at",
        )
        .gte("created_at", since.toISOString())
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
        .from("work_order_history")
        .select("work_order_id, status, changed_at")
        .gte("changed_at", since.toISOString()),
      this.db
        .from("profiles")
        .select("id, full_name")
        .eq("approval_status", "approved")
        .eq("role", "technician")
        .order("full_name"),
    ]);

    for (const result of [
      incidentsResult,
      openIncidentsResult,
      activeWorkOrdersResult,
      recentHistoryResult,
      techniciansResult,
    ]) {
      if (result.error) throw result.error;
    }

    const incidents = (incidentsResult.data ?? []) as IncidentRow[];
    const openIncidents = (openIncidentsResult.data ?? []) as IncidentRow[];
    const activeWorkOrders = (activeWorkOrdersResult.data ??
      []) as WorkOrderRow[];
    const recentHistory = (recentHistoryResult.data ?? []) as HistoryRow[];
    const technicians = (techniciansResult.data ?? []) as TechnicianRow[];

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
    const fullRecentOrderHistory = (recentOrderHistoryResult.data ??
      []) as HistoryRow[];
    const incidentById = new Map(
      [...incidents, ...openIncidents].map((item) => [item.id, item]),
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
    const pendingReview = openWorkOrders.filter((item) =>
      ["pending_parts_approval", "pending_repair_approval"].includes(
        item.status,
      ),
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
      .map((order) => ({ order, occurredAt: acceptedAt(order) }))
      .filter(
        (item): item is { order: WorkOrderRow; occurredAt: string } =>
          item.occurredAt !== undefined && new Date(item.occurredAt) >= since,
      );
    const completed = recentOrders
      .map((order) => ({ order, occurredAt: completedAt(order) }))
      .filter(
        (item): item is { order: WorkOrderRow; occurredAt: string } =>
          item.occurredAt !== undefined && new Date(item.occurredAt) >= since,
      );
    const responseOnTime = responded.filter(
      ({ order, occurredAt }) =>
        new Date(occurredAt) <= new Date(order.respond_due_at),
    ).length;
    const resolutionOnTime = completed.filter(
      ({ order, occurredAt }) =>
        new Date(occurredAt) <= new Date(order.resolve_due_at),
    ).length;
    const averageResolutionMinutes = completed.length
      ? Math.round(
          completed.reduce(
            (sum, { order, occurredAt }) =>
              sum +
              (new Date(occurredAt).getTime() -
                new Date(order.created_at).getTime()) /
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
      if (incident.status !== "done") current.openCount += 1;
      hotspotMap.set(key, current);
    }

    const workloadByTechnician = new Map<string, number>();
    for (const order of openWorkOrders)
      workloadByTechnician.set(
        order.technician_id,
        (workloadByTechnician.get(order.technician_id) ?? 0) + 1,
      );

    const months = monthBuckets(since, now);
    for (const incident of incidents) {
      const key = incident.created_at.slice(0, 7);
      const current = months.get(key);
      if (!current) continue;
      current.reported += 1;
    }
    for (const event of recentHistory) {
      if (event.status !== "done") continue;
      const current = months.get(event.changed_at.slice(0, 7));
      if (current) current.completed += 1;
    }

    const reviewRows = pendingReview.map((order) => {
      const incident = incidentById.get(order.incident_id);
      return {
        workOrderId: order.id,
        ticketNumber: incident?.ticket_number ?? "-",
        locationLabel: incident?.location_label ?? "-",
        status: order.status,
        resolveDueAt: order.resolve_due_at,
      };
    });
    const unassignedRows = pendingAssignment.map((incident) => ({
      incidentId: incident.id,
      ticketNumber: incident.ticket_number,
      locationLabel: incident.location_label,
      status: incident.status,
      createdAt: incident.created_at,
    }));

    return {
      generatedAt: now.toISOString(),
      periodDays: days,
      attention: {
        overdue: overdue.length,
        nearDue: nearDue.length,
        pendingAssignment: pendingAssignment.length,
        pendingReview: pendingReview.length,
      },
      sla: {
        responseOnTimeRate: responded.length
          ? Math.round((responseOnTime / responded.length) * 100)
          : null,
        resolutionOnTimeRate: completed.length
          ? Math.round((resolutionOnTime / completed.length) * 100)
          : null,
        averageResolutionMinutes,
      },
      trend: [...months.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, value]) => ({ month, ...value })),
      statusCounts: Object.entries(
        incidents.reduce<Record<string, number>>((counts, incident) => {
          counts[incident.status] = (counts[incident.status] ?? 0) + 1;
          return counts;
        }, {}),
      ).map(([status, count]) => ({ status, count })),
      hotspots: [...hotspotMap.values()]
        .sort(
          (left, right) =>
            right.count - left.count || right.openCount - left.openCount,
        )
        .slice(0, 5),
      technicianWorkload: technicians
        .map((technician) => ({
          technicianId: technician.id,
          technicianName: technician.full_name,
          activeCount: workloadByTechnician.get(technician.id) ?? 0,
        }))
        .sort((left, right) => right.activeCount - left.activeCount),
      attentionItems: {
        unassigned: unassignedRows.slice(0, 5),
        review: reviewRows
          .sort(
            (left, right) =>
              new Date(left.resolveDueAt).getTime() -
              new Date(right.resolveDueAt).getTime(),
          )
          .slice(0, 5),
      },
    };
  }
}

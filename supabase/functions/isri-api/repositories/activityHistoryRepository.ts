import type { AppRole, DatabaseClient } from "../_shared/types.ts";

type Event = {
  id: string;
  status: string;
  changed_at: string;
  changed_by: string | null;
  event_type: string;
  note: string | null;
  previous_status?: string | null;
};
type Order = {
  id: string;
  status: string;
  assigned_at: string | null;
  updated_at: string;
};
type Incident = {
  id: string;
  ticket_number: string;
  location_label: string;
  asset_name: string | null;
  category: string;
  description: string;
  status: string;
  reporter_id: string;
  rejection_reason: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at: string;
  work_orders: Order | Order[] | null;
};
type HistoryEvent = Event & { work_order_id: string };
const incidentColumns =
  "id, ticket_number, location_label, asset_name, category, description, status, reporter_id, rejection_reason, rejected_at, rejected_by, created_at, updated_at, work_orders(id, status, assigned_at, updated_at)";

export function summarizeActivity(
  incident: Incident,
  events: Event[],
  actorId: string,
) {
  const order = Array.isArray(incident.work_orders)
    ? incident.work_orders[0]
    : incident.work_orders;
  const timeline: Event[] = [
    {
      id: `incident-created-${incident.id}`,
      status: "pending_assignment",
      changed_at: incident.created_at,
      changed_by: incident.reporter_id,
      event_type: "incident_created",
      note: "สร้างรายการแจ้งซ่อม",
    },
    ...events,
  ];
  if (incident.rejected_at)
    timeline.push({
      id: `incident-rejected-${incident.id}`,
      status: "rejected",
      changed_at: incident.rejected_at,
      changed_by: incident.rejected_by,
      event_type: "incident_rejected",
      note: incident.rejection_reason,
    });
  if (
    order?.assigned_at &&
    !events.some((event) => event.changed_at === order.assigned_at)
  ) {
    timeline.push({
      id: `assigned-${order.id}`,
      status: "pending",
      changed_at: order.assigned_at,
      changed_by: null,
      event_type: "assigned",
      note: "มอบหมายงานให้ทีมช่าง",
    });
  }
  timeline.sort(
    (a, b) =>
      Date.parse(a.changed_at) - Date.parse(b.changed_at) || a.id.localeCompare(b.id),
  );
  timeline.forEach((event, index) => {
    event.previous_status = timeline[index - 1]?.status ?? null;
  });
  timeline.reverse();
  return {
    id: incident.id,
    ticketNumber: incident.ticket_number,
    locationLabel: incident.location_label,
    assetName: incident.asset_name,
    category: incident.category,
    description: incident.description,
    status: order?.status ?? incident.status,
    createdAt: incident.created_at,
    workOrderId: order?.id ?? null,
    latestEvent: timeline[0],
    myLatestEvent:
      timeline.find((event) => event.changed_by === actorId) ?? null,
  };
}

export class ActivityHistoryRepository {
  constructor(private readonly db: DatabaseClient) {}

  // Page every source, so PostgREST's row limit cannot silently hide old activity.
  private async all<T>(
    query: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<T[]> {
    const result: T[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await query(from, from + 499);
      if (error) throw error;
      const rows = (data ?? []) as T[];
      result.push(...rows);
      if (rows.length < 500) return result;
    }
  }

  private async involvedIncidentIds(
    actorId: string,
    role: "technician" | "dispatcher",
  ) {
    const [owned, actions, assignments, rejected] = await Promise.all([
      this.all<{ id: string; incident_id: string }>((from, to) =>
        this.db
          .from("work_orders")
          .select("id, incident_id")
          .eq(role === "technician" ? "technician_id" : "assigned_by", actorId)
          .order("id")
          .range(from, to),
      ),
      this.all<{ work_order_id: string }>((from, to) =>
        this.db
          .from("work_order_history")
          .select("work_order_id, id")
          .eq("changed_by", actorId)
          .order("id")
          .range(from, to),
      ),
      role === "technician"
        ? this.all<{ work_order_id: string }>((from, to) =>
            this.db
              .from("work_order_assignees")
              .select("work_order_id")
              .eq("technician_id", actorId)
              .order("work_order_id")
              .range(from, to),
          )
        : [],
      role === "dispatcher"
        ? this.all<{ id: string }>((from, to) =>
            this.db
              .from("incidents")
              .select("id")
              .eq("rejected_by", actorId)
              .order("id")
              .range(from, to),
          )
        : [],
    ]);
    const ids = new Set([
      ...owned.map((row) => row.incident_id),
      ...rejected.map((row) => row.id),
    ]);
    const orderIds = [
      ...new Set([...actions, ...assignments].map((row) => row.work_order_id)),
    ];
    for (let start = 0; start < orderIds.length; start += 200) {
      const orders = await this.all<{ incident_id: string }>((from, to) =>
        this.db
          .from("work_orders")
          .select("id, incident_id")
          .in("id", orderIds.slice(start, start + 200))
          .order("id")
          .range(from, to),
      );
      orders.forEach((order) => ids.add(order.incident_id));
    }
    return [...ids];
  }

  async listForActor(actorId: string, role: AppRole, incidentId?: string) {
    const scope =
      role === "technician" || role === "dispatcher"
        ? await this.involvedIncidentIds(actorId, role)
        : null;
    if (scope && (!scope.length || (incidentId && !scope.includes(incidentId))))
      return [];
    const batches = scope
      ? Array.from({ length: Math.ceil(scope.length / 200) }, (_, index) =>
          scope.slice(index * 200, (index + 1) * 200),
        )
      : [null];
    const incidents: Incident[] = [];
    for (const ids of batches) {
      incidents.push(
        ...(await this.all<Incident>((from, to) => {
          let query = this.db.from("incidents").select(incidentColumns);
          if (role === "reporter") query = query.eq("reporter_id", actorId);
          if (ids) query = query.in("id", ids);
          if (incidentId) query = query.eq("id", incidentId);
          return query.order("id").range(from, to);
        })),
      );
    }
    const orderIds = incidents.flatMap((incident) => {
      const order = Array.isArray(incident.work_orders)
        ? incident.work_orders[0]
        : incident.work_orders;
      return order ? [order.id] : [];
    });
    const eventsByOrder = new Map<string, HistoryEvent[]>();
    for (let start = 0; start < orderIds.length; start += 200) {
      const events = await this.all<HistoryEvent>((from, to) =>
        this.db
          .from("work_order_history")
          .select(
            "id, work_order_id, status, changed_at, changed_by, event_type, note",
          )
          .in("work_order_id", orderIds.slice(start, start + 200))
          .order("id")
          .range(from, to),
      );
      for (const event of events) {
        const current = eventsByOrder.get(event.work_order_id) ?? [];
        current.push(event);
        eventsByOrder.set(event.work_order_id, current);
      }
    }
    return incidents
      .map((incident) => {
        const order = Array.isArray(incident.work_orders)
          ? incident.work_orders[0]
          : incident.work_orders;
        return summarizeActivity(
          incident,
          order ? (eventsByOrder.get(order.id) ?? []) : [],
          actorId,
        );
      })
      .sort(
        (a, b) =>
          b.latestEvent.changed_at.localeCompare(a.latestEvent.changed_at) ||
          b.id.localeCompare(a.id),
      );
  }
}


import { getDashboardMonthRange } from "./dashboardPeriod.ts";

export type DashboardIncident = {
  id: string;
  location_id: string;
  location_label: string;
  asset_name: string | null;
  status: string;
  created_at: string;
};
export type DashboardOrder = {
  id: string;
  incident_id: string;
  technician_id: string;
  status: string;
  respond_due_at: string;
  resolve_due_at: string;
  assigned_at: string | null;
  created_at: string | null;
};
export type DashboardEvent = {
  id: string;
  work_order_id: string;
  status: string;
  changed_at: string;
};
export type DashboardAssignment = {
  work_order_id: string;
  technician_id: string;
  assignment_role: string;
};
export type DashboardLocation = {
  id: string;
  building: string;
  floor: string;
  zone: string;
};
export const activeIncidentStatuses = [
  "submitted",
  "pending_assignment",
  "assigned",
  "in_progress",
  "pending_parts_approval",
  "waiting_parts",
  "pending_repair_approval",
];
export const activeWorkOrderStatuses = [
  "pending",
  "in_progress",
  "pending_parts_approval",
  "waiting_parts",
  "pending_repair_approval",
];

export function calculateDashboardSla(
  orders: DashboardOrder[],
  events: DashboardEvent[],
  incidents: Array<{ id: string; created_at: string }>,
  month: string,
) {
  const { since, until } = getDashboardMonthRange(month);
  const created = new Map(
    incidents.map((row) => [row.id, Date.parse(row.created_at)]),
  );
  const history = new Map<string, DashboardEvent[]>();
  for (const event of [...events].sort(
    (a, b) =>
      Date.parse(a.changed_at) - Date.parse(b.changed_at) ||
      a.id.localeCompare(b.id),
  )) {
    const rows = history.get(event.work_order_id) ?? [];
    rows.push(event);
    history.set(event.work_order_id, rows);
  }
  const samples = (status: string) =>
    orders.flatMap((order) => {
      // First acceptance remains the acceptance even after parts/rework cycles.
      const event = history.get(order.id)?.find((row) => row.status === status);
      const start =
        status === "done"
          ? Date.parse(order.created_at ?? order.assigned_at ?? "") ||
            created.get(order.incident_id)
          : created.get(order.incident_id);
      const occurred = event ? Date.parse(event.changed_at) : NaN;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(occurred) ||
        occurred < since.getTime() ||
        occurred >= until.getTime() ||
        occurred < start!
      )
        return [];
      return [
        {
          minutes: (occurred - start!) / 60000,
          onTime:
            occurred <=
            Date.parse(
              status === "done" ? order.resolve_due_at : order.respond_due_at,
            ),
        },
      ];
    });
  const responded = samples("in_progress"),
    closed = samples("done");
  const average = (items: typeof responded) =>
    items.length
      ? Math.round(
          items.reduce((sum, item) => sum + item.minutes, 0) / items.length,
        )
      : null;
  const onTime = (items: typeof responded) =>
    items.filter((item) => item.onTime).length;
  return {
    responseOnTimeRate: responded.length
      ? Math.round((onTime(responded) / responded.length) * 100)
      : null,
    averageResponseMinutes: average(responded),
    resolutionOnTimeRate: closed.length
      ? Math.round((onTime(closed) / closed.length) * 100)
      : null,
    averageClosureMinutes: average(closed),
    respondedCount: responded.length,
    closedCount: closed.length,
    responseOnTimeCount: onTime(responded),
    resolutionOnTimeCount: onTime(closed),
  };
}

export function calculateTechnicianWorkload(
  technicians: Array<{ id: string; full_name: string }>,
  orders: DashboardOrder[],
  assignments: DashboardAssignment[],
  pmPlans: Array<{
    assigned_technician_id: string | null;
    next_due_at: string;
  }>,
  month: string,
  now: Date,
) {
  const { since, until } = getDashboardMonthRange(month);
  const teams = new Map<string, Map<string, string>>();
  for (const order of orders)
    teams.set(order.id, new Map([[order.technician_id, "primary"]]));
  for (const assignment of assignments)
    teams
      .get(assignment.work_order_id)
      ?.set(assignment.technician_id, assignment.assignment_role);
  const today = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now) +
      "T00:00:00+07:00",
  );
  const dueUntil = today.getTime() + 31 * 86400000;
  return technicians
    .map((tech) => {
      let primaryCount = 0,
        supportCount = 0,
        activeCount = 0,
        overdueCount = 0,
        pendingReviewCount = 0;
      for (const order of orders) {
        const role = teams.get(order.id)?.get(tech.id);
        if (!role) continue;
        const assigned = Date.parse(order.assigned_at ?? "");
        if (assigned >= since.getTime() && assigned < until.getTime()) {
          if (role === "primary") primaryCount++;
          else supportCount++;
        }
        if (activeWorkOrderStatuses.includes(order.status)) {
          activeCount++;
          if (Date.parse(order.resolve_due_at) < now.getTime()) overdueCount++;
          if (
            ["pending_parts_approval", "pending_repair_approval"].includes(
              order.status,
            )
          )
            pendingReviewCount++;
        }
      }
      const plans = pmPlans.filter(
        (plan) => plan.assigned_technician_id === tech.id,
      );
      return {
        technicianId: tech.id,
        technicianName: tech.full_name,
        assignedCount: primaryCount + supportCount,
        primaryCount,
        supportCount,
        activeCount,
        overdueCount,
        pendingReviewCount,
        pmAssignedCount: plans.length,
        pmDueCount: plans.filter(
          (plan) => Date.parse(plan.next_due_at) < dueUntil,
        ).length,
      };
    })
    .sort(
      (a, b) =>
        b.activeCount - a.activeCount ||
        b.assignedCount - a.assignedCount ||
        a.technicianName.localeCompare(b.technicianName),
    );
}

export type Hotspot = {
  key: string;
  locationLabel: string;
  assetName: string | null;
  count: number;
  openCount: number;
};
export function calculateHotspots(
  incidents: DashboardIncident[],
  locations: DashboardLocation[],
) {
  const locationMap = new Map(locations.map((row) => [row.id, row]));
  const groups = {
    building: new Map<string, Hotspot>(),
    floor: new Map<string, Hotspot>(),
    area: new Map<string, Hotspot>(),
    asset: new Map<string, Hotspot>(),
  };
  for (const incident of incidents) {
    if (incident.status === "rejected") continue;
    const location = locationMap.get(incident.location_id);
    const values: Array<[keyof typeof groups, string, string, string | null]> =
      [
        ["area", incident.location_id, incident.location_label, null],
        [
          "asset",
          JSON.stringify([
            incident.location_id,
            incident.asset_name?.trim() ?? "",
          ]),
          incident.location_label,
          incident.asset_name,
        ],
      ];
    if (location) {
      values.push(
        ["building", location.building, location.building, null],
        [
          "floor",
          JSON.stringify([location.building, location.floor]),
          `${location.building} · ${location.floor}`,
          null,
        ],
      );
    }
    for (const [group, key, label, asset] of values) {
      const row = groups[group].get(key) ?? {
        key,
        locationLabel: label,
        assetName: asset,
        count: 0,
        openCount: 0,
      };
      row.count++;
      if (activeIncidentStatuses.includes(incident.status)) row.openCount++;
      groups[group].set(key, row);
    }
  }
  const top = (map: Map<string, Hotspot>) =>
    [...map.values()]
      .filter((row) => row.count >= 2)
      .sort(
        (a, b) =>
          b.count - a.count ||
          b.openCount - a.openCount ||
          a.key.localeCompare(b.key),
      )
      .slice(0, 5);
  return {
    building: top(groups.building),
    floor: top(groups.floor),
    area: top(groups.area),
    asset: top(groups.asset),
  };
}

import type { DatabaseClient } from "../_shared/types.ts";

export class WorkOrderRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getSlaRule(urgency: string) {
    const { data, error } = await this.db
      .from("sla_rules")
      .select("response_minutes, resolve_minutes, point_value")
      .eq("urgency_level", urgency)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(input: {
    incidentId: string;
    technicianId: string;
    assignedBy: string;
    incidentCreatedAt: string;
    responseMinutes: number;
    resolveMinutes: number;
    pointValue: number;
  }) {
    const start = new Date(input.incidentCreatedAt).getTime();
    const assignedAt = new Date().toISOString();
    const { data, error } = await this.db
      .from("work_orders")
      .insert({
        incident_id: input.incidentId,
        technician_id: input.technicianId,
        assigned_by: input.assignedBy,
        assigned_at: assignedAt,
        status: "pending",
        respond_due_at: new Date(
          start + input.responseMinutes * 60000,
        ).toISOString(),
        resolve_due_at: new Date(
          start + input.resolveMinutes * 60000,
        ).toISOString(),
        sla_point_value: input.pointValue,
      })
      .select(
        "id, incident_id, technician_id, status, assigned_by, assigned_at, respond_due_at, resolve_due_at, created_at",
      )
      .single();
    if (error) throw error;
    const { error: historyError } = await this.db
      .from("work_order_history")
      .insert({
        work_order_id: data.id,
        status: "pending",
        changed_by: input.assignedBy,
        changed_at: assignedAt,
      });
    if (historyError) throw historyError;
    return data;
  }

  private async listForTechnician(
    technicianId: string,
    options: { completedOnly: boolean },
  ) {
    const { data: assignments, error: assignmentsError } = await this.db
      .from("work_order_assignees")
      .select("work_order_id, assignment_role")
      .eq("technician_id", technicianId);
    if (assignmentsError) throw assignmentsError;
    const assignmentByOrderId = new Map(
      (assignments ?? []).map((assignment) => [
        assignment.work_order_id,
        assignment.assignment_role,
      ]),
    );
    const workOrderIds = [...assignmentByOrderId.keys()];
    if (!workOrderIds.length) return [];
    let query = this.db
      .from("work_orders")
      .select(
        "id, incident_id, status, respond_due_at, resolve_due_at, assigned_at, updated_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .in("id", workOrderIds);
    query = options.completedOnly
      ? query.eq("status", "done").order("updated_at", { ascending: false })
      : query.neq("status", "done").order("assigned_at", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((order) => ({
      ...order,
      assignment_role: assignmentByOrderId.get(order.id),
    }));
  }

  async listActiveForTechnician(technicianId: string) {
    return this.listForTechnician(technicianId, { completedOnly: false });
  }

  async listHistoryForTechnician(technicianId: string) {
    return this.listForTechnician(technicianId, { completedOnly: true });
  }

  async listHistoryForDispatcher(dispatcherId: string) {
    const { data, error } = await this.db
      .from("work_orders")
      .select(
        "id, incident_id, status, respond_due_at, resolve_due_at, assigned_at, updated_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .eq("assigned_by", dispatcherId)
      .eq("status", "done")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  private async technicianCanAccess(workOrderId: string, technicianId: string) {
    const { data, error } = await this.db
      .from("work_order_assignees")
      .select("work_order_id")
      .eq("work_order_id", workOrderId)
      .eq("technician_id", technicianId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async getForAction(
    id: string,
    actorId: string,
    actorRole: "technician" | "dispatcher" | "admin",
  ) {
    if (
      actorRole === "technician" &&
      !(await this.technicianCanAccess(id, actorId))
    )
      return null;
    let query = this.db
      .from("work_orders")
      .select("id, incident_id, status, technician_id, assigned_by")
      .eq("id", id);
    if (actorRole === "dispatcher") query = query.eq("assigned_by", actorId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async applyAction(
    id: string,
    input: {
      expectedStatus: string;
      status: string;
      actorId: string;
      note: string | null;
      eventType: string;
      incidentStatus: string;
      attachments: Array<{
        objectPath: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    },
  ) {
    const { data, error } = await this.db.rpc("apply_work_order_action", {
      p_work_order_id: id,
      p_expected_status: input.expectedStatus,
      p_status: input.status,
      p_actor_id: input.actorId,
      p_note: input.note,
      p_event_type: input.eventType,
      p_incident_status: input.incidentStatus,
      p_attachments: input.attachments,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("Work order action did not return a result.");
    return {
      id: result.id,
      incident_id: result.incident_id,
      status: result.status,
      historyId: result.history_id,
    };
  }

  async historyForIncident(incidentId: string) {
    const { data: order, error: orderError } = await this.db
      .from("work_orders")
      .select("id, technician_id, assigned_by, assigned_at, status")
      .eq("incident_id", incidentId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return { workOrder: null, events: [] };
    const assignees = await this.listAssignees(order.id);
    const { data: events, error: eventsError } = await this.db
      .from("work_order_history")
      .select("id, status, changed_by, changed_at, note, event_type, metadata")
      .eq("work_order_id", order.id)
      .order("changed_at");
    if (eventsError) throw eventsError;
    return { workOrder: { ...order, assignees }, events: events ?? [] };
  }

  async listAssignees(workOrderId: string) {
    const { data, error } = await this.db
      .from("work_order_assignees")
      .select("technician_id, assignment_role, profiles(full_name)")
      .eq("work_order_id", workOrderId)
      .order("assignment_role");
    if (error) throw error;
    return (data ?? []).map((assignee) => {
      const profile = assignee.profiles as unknown as
        | { full_name?: string }
        | Array<{ full_name?: string }>
        | null;
      return {
        technician_id: assignee.technician_id,
        assignment_role: assignee.assignment_role,
        full_name: Array.isArray(profile)
          ? (profile[0]?.full_name ?? "ไม่ระบุ")
          : (profile?.full_name ?? "ไม่ระบุ"),
      };
    });
  }

  async getByIdForActor(
    id: string,
    actorId: string,
    actorRole: "technician" | "dispatcher" | "admin",
  ) {
    if (
      actorRole === "technician" &&
      !(await this.technicianCanAccess(id, actorId))
    )
      return null;
    let query = this.db
      .from("work_orders")
      .select(
        "id, incident_id, technician_id, assigned_by, assigned_at, status, respond_due_at, resolve_due_at, created_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .eq("id", id);
    if (actorRole === "dispatcher") query = query.eq("assigned_by", actorId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data
      ? { ...data, assignees: await this.listAssignees(data.id) }
      : null;
  }

  async listReviewForActor(actorId: string, actorRole: "dispatcher" | "admin") {
    let query = this.db
      .from("work_orders")
      .select(
        "id, incident_id, technician_id, assigned_by, assigned_at, status, respond_due_at, resolve_due_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .in("status", ["pending_parts_approval", "pending_repair_approval"])
      .order("assigned_at", { ascending: true });
    if (actorRole === "dispatcher") query = query.eq("assigned_by", actorId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }
}

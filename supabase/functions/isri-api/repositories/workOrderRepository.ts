import type { DatabaseClient } from "../_shared/types.ts";

export class WorkOrderRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getSlaRule(urgency: string) {
    const { data, error } = await this.db
      .from("sla_rules")
      .select("response_minutes, resolve_minutes")
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

  async listForTechnician(technicianId: string) {
    const { data, error } = await this.db
      .from("work_orders")
      .select(
        "id, incident_id, status, respond_due_at, resolve_due_at, assigned_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .eq("technician_id", technicianId)
      .order("resolve_due_at");
    if (error) throw error;
    return data;
  }

  async getForAction(
    id: string,
    actorId: string,
    actorRole: "technician" | "dispatcher" | "admin",
  ) {
    let query = this.db
      .from("work_orders")
      .select("id, incident_id, status, technician_id, assigned_by")
      .eq("id", id);
    if (actorRole === "technician") query = query.eq("technician_id", actorId);
    if (actorRole === "dispatcher") query = query.eq("assigned_by", actorId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async applyAction(
    id: string,
    input: {
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
    const { data: events, error: eventsError } = await this.db
      .from("work_order_history")
      .select("id, status, changed_by, changed_at, note, event_type, metadata")
      .eq("work_order_id", order.id)
      .order("changed_at");
    if (eventsError) throw eventsError;
    return { workOrder: order, events: events ?? [] };
  }

  async getByIdForActor(
    id: string,
    actorId: string,
    actorRole: "technician" | "dispatcher" | "admin",
  ) {
    let query = this.db
      .from("work_orders")
      .select(
        "id, incident_id, technician_id, assigned_by, assigned_at, status, respond_due_at, resolve_due_at, created_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .eq("id", id);
    if (actorRole === "technician") query = query.eq("technician_id", actorId);
    if (actorRole === "dispatcher") query = query.eq("assigned_by", actorId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async listReviewForActor(actorId: string, actorRole: "dispatcher" | "admin") {
    let query = this.db
      .from("work_orders")
      .select(
        "id, incident_id, technician_id, assigned_by, assigned_at, status, respond_due_at, resolve_due_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)",
      )
      .in("status", ["pending_parts_approval", "pending_repair_approval"])
      .order("resolve_due_at");
    if (actorRole === "dispatcher") query = query.eq("assigned_by", actorId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }
}

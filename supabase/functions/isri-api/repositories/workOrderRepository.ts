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
    const { data, error } = await this.db.from("work_orders")
      .select("id, incident_id, status, respond_due_at, resolve_due_at, assigned_at, incidents(ticket_number, location_label, asset_name, category, urgency_reported, description, status)")
      .eq("technician_id", technicianId)
      .order("resolve_due_at");
    if (error) throw error;
    return data;
  }

  async changeStatus(id: string, technicianId: string, status: "in_progress" | "waiting_parts" | "done", note: string | null) {
    const { data, error } = await this.db.from("work_orders")
      .update({ status })
      .eq("id", id)
      .eq("technician_id", technicianId)
      .select("id, incident_id, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const { error: historyError } = await this.db.from("work_order_history").insert({
      work_order_id: id,
      status,
      changed_by: technicianId,
      note,
      event_type: status === "waiting_parts" ? "parts_requested" : status === "done" ? "completion" : "status_change",
    });
    if (historyError) throw historyError;
    return data;
  }
}

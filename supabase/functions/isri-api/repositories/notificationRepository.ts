import type { DatabaseClient } from "../_shared/types.ts";

export class NotificationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createMany(
    userIds: string[],
    input: {
      type:
        | "new_assignment_pending"
        | "job_assigned"
        | "job_done"
        | "incident_rejected"
        | "reward_status";
      message: string;
      incidentId: string;
    },
  ) {
    if (!userIds.length) return;
    const { error } = await this.db.from("notifications").insert(
      userIds.map((userId) => ({
        user_id: userId,
        type: input.type,
        message: input.message,
        related_incident_id: input.incidentId,
      })),
    );
    if (error) throw error;
  }

  async listForUser(userId: string) {
    const { data, error } = await this.db
      .from("notifications")
      .select("id, type, message, related_incident_id, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    const incidentIds = (data ?? [])
      .map((notification) => notification.related_incident_id)
      .filter((id): id is string => Boolean(id));
    if (!incidentIds.length) return data ?? [];
    const { data: workOrders, error: workOrdersError } = await this.db
      .from("work_orders")
      .select("id, incident_id")
      .in("incident_id", incidentIds);
    if (workOrdersError) throw workOrdersError;
    const workOrderByIncident = new Map(
      (workOrders ?? []).map((workOrder) => [
        workOrder.incident_id,
        workOrder.id,
      ]),
    );
    return (data ?? []).map((notification) => ({
      ...notification,
      work_order_id: notification.related_incident_id
        ? (workOrderByIncident.get(notification.related_incident_id) ?? null)
        : null,
    }));
  }

  async markRead(id: string, userId: string) {
    const { data, error } = await this.db
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, is_read")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async markAllRead(userId: string) {
    const { error } = await this.db
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
    if (error) throw error;
  }
}

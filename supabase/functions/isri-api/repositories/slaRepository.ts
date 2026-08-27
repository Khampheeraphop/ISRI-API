import type { DatabaseClient } from "../_shared/types.ts";

const columns =
  "id, urgency_level, response_minutes, resolve_minutes, point_value, updated_at";

export class SlaRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listRules() {
    const { data, error } = await this.db
      .from("sla_rules")
      .select(columns)
      .order("urgency_level");
    if (error) throw error;
    return data ?? [];
  }

  async updateRule(
    id: string,
    input: { responseMinutes: number; resolveMinutes: number; pointValue: number },
  ) {
    const { data, error } = await this.db
      .from("sla_rules")
      .update({
        response_minutes: input.responseMinutes,
        resolve_minutes: input.resolveMinutes,
        point_value: input.pointValue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(columns)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async summary() {
    const now = new Date().toISOString();
    const { count, error } = await this.db
      .from("work_orders")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "pending",
        "in_progress",
        "waiting_parts",
        "pending_parts_approval",
        "pending_repair_approval",
      ])
      .lt("resolve_due_at", now);
    if (error) throw error;
    return { overdueCount: count ?? 0, generatedAt: now };
  }
}

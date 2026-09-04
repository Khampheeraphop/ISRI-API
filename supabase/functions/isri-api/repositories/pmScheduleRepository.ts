import type { DatabaseClient } from "../_shared/types.ts";

const scheduleColumns =
  "id, location_id, location_label, asset_name, plan_details, interval_months, last_done_at, next_due_at, assigned_technician_id, created_at, updated_at, profiles!pm_schedules_assigned_technician_id_fkey(full_name, email)";
const logColumns =
  "id, schedule_id, completed_at, technician_id, notes, created_at, profiles!pm_logs_technician_id_fkey(full_name)";

export class PmScheduleRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listSchedules(technicianId?: string) {
    let query = this.db
      .from("pm_schedules")
      .select(scheduleColumns)
      // PM is an operational queue, so preserve first-created-first-served.
      .order("next_due_at", { ascending: true });
    if (technicianId) query = query.eq("assigned_technician_id", technicianId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async findSchedule(id: string) {
    const { data, error } = await this.db
      .from("pm_schedules")
      .select(scheduleColumns)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByLocationAndAsset(
    locationId: string,
    assetName: string,
    excludeId?: string,
  ) {
    let query = this.db
      .from("pm_schedules")
      .select("id")
      .eq("location_id", locationId)
      .eq("asset_name", assetName);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(input: {
    locationId: string;
    locationLabel: string;
    assetName: string;
    planDetails: string;
    intervalMonths: number;
    lastDoneAt: string | null;
    nextDueAt: string;
    assignedTechnicianId?: string | null;
  }) {
    const { data, error } = await this.db
      .from("pm_schedules")
      .insert({
        location_id: input.locationId,
        location_label: input.locationLabel,
        asset_name: input.assetName,
        plan_details: input.planDetails,
        interval_months: input.intervalMonths,
        last_done_at: input.lastDoneAt,
        next_due_at: input.nextDueAt,
        assigned_technician_id: input.assignedTechnicianId ?? null,
      })
      .select(scheduleColumns)
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    input: {
      locationId: string;
      locationLabel: string;
      assetName: string;
      planDetails: string;
      intervalMonths: number;
      lastDoneAt: string | null;
      nextDueAt: string;
      assignedTechnicianId?: string | null;
    },
  ) {
    const { data, error } = await this.db
      .from("pm_schedules")
      .update({
        location_id: input.locationId,
        location_label: input.locationLabel,
        asset_name: input.assetName,
        plan_details: input.planDetails,
        interval_months: input.intervalMonths,
        next_due_at: input.nextDueAt,
        assigned_technician_id: input.assignedTechnicianId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(scheduleColumns)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listLogs(scheduleId: string) {
    const { data, error } = await this.db
      .from("pm_logs")
      .select(logColumns)
      .eq("schedule_id", scheduleId)
      .order("completed_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async recordCompletion(input: {
    scheduleId: string;
    technicianId: string;
    completedAt: string;
    notes: string;
  }) {
    const { data, error } = await this.db
      .from("pm_logs")
      .insert({
        schedule_id: input.scheduleId,
        technician_id: input.technicianId,
        notes: input.notes,
        completed_at: input.completedAt,
      })
      .select(logColumns)
      .single();
    if (error) throw error;
    return data;
  }
}

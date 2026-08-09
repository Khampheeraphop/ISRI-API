import type { DatabaseClient } from "../_shared/types.ts";

const scheduleColumns =
  "id, location_id, location_label, asset_name, interval_months, last_done_at, next_due_at, created_at, updated_at";
const logColumns =
  "id, schedule_id, completed_at, technician_id, notes, created_at";

export class PmScheduleRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listSchedules() {
    const { data, error } = await this.db
      .from("pm_schedules")
      .select(scheduleColumns)
      .order("next_due_at");
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

  async create(input: {
    locationId: string;
    locationLabel: string;
    assetName: string;
    intervalMonths: number;
    lastDoneAt: string;
    nextDueAt: string;
  }) {
    const { data, error } = await this.db
      .from("pm_schedules")
      .insert({
        location_id: input.locationId,
        location_label: input.locationLabel,
        asset_name: input.assetName,
        interval_months: input.intervalMonths,
        last_done_at: input.lastDoneAt,
        next_due_at: input.nextDueAt,
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
      intervalMonths: number;
      lastDoneAt: string;
      nextDueAt: string;
    },
  ) {
    const { data, error } = await this.db
      .from("pm_schedules")
      .update({
        location_id: input.locationId,
        location_label: input.locationLabel,
        asset_name: input.assetName,
        interval_months: input.intervalMonths,
        last_done_at: input.lastDoneAt,
        next_due_at: input.nextDueAt,
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
    notes: string;
  }) {
    const { data, error } = await this.db
      .from("pm_logs")
      .insert({
        schedule_id: input.scheduleId,
        technician_id: input.technicianId,
        notes: input.notes,
        completed_at: new Date().toISOString(),
      })
      .select(logColumns)
      .single();
    if (error) throw error;
    return data;
  }
}

import type { DatabaseClient } from "../_shared/types.ts";

const columns =
  "id, code, building, floor, zone, asset_name, qr_scope, created_at, updated_at";

export class LocationRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list() {
    const { data, error } = await this.db
      .from("managed_locations")
      .select(columns)
      // The QR management screen is an administrative catalogue: the newest
      // location must be immediately visible after it is created.
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async findByCode(code: string) {
    const { data, error } = await this.db
      .from("managed_locations")
      .select(columns)
      .eq("code", code)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findById(id: string) {
    const { data, error } = await this.db
      .from("managed_locations")
      .select("id, building, floor, zone")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(input: {
    building: string;
    floor: string;
    zone: string;
    assetName: string | null;
    qrScope: "area" | "asset";
  }) {
    const { data, error } = await this.db
      .from("managed_locations")
      .insert({
        // The QR token is an opaque, server-generated identifier. It is never
        // entered by an administrator and remains stable when location details change.
        code: `LOC-${crypto
          .randomUUID()
          .replaceAll("-", "")
          .slice(0, 12)
          .toUpperCase()}`,
        building: input.building,
        floor: input.floor,
        zone: input.zone,
        asset_name: input.assetName,
        qr_scope: input.qrScope,
      })
      .select(columns)
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    input: {
      building: string;
      floor: string;
      zone: string;
      assetName: string | null;
      qrScope: "area" | "asset";
    },
  ) {
    const { data, error } = await this.db
      .from("managed_locations")
      .update({
        building: input.building,
        floor: input.floor,
        zone: input.zone,
        asset_name: input.assetName,
        qr_scope: input.qrScope,
      })
      .eq("id", id)
      .select(columns)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async delete(id: string) {
    const { error } = await this.db
      .from("managed_locations")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }

  async isInUse(id: string) {
    const [incidents, schedules, floorPlans] = await Promise.all([
      this.db
        .from("incidents")
        .select("id", { count: "exact", head: true })
        .eq("location_id", id),
      this.db
        .from("pm_schedules")
        .select("id", { count: "exact", head: true })
        .eq("location_id", id),
      this.db.from("floor_plans").select("layout"),
    ]);

    if (incidents.error) throw incidents.error;
    if (schedules.error) throw schedules.error;
    if (floorPlans.error) throw floorPlans.error;

    const isPlacedOnFloorPlan = (floorPlans.data ?? []).some((plan) => {
      const layout = plan.layout as {
        elements?: Array<{ locationId?: unknown }>;
      } | null;
      return (
        layout?.elements?.some((element) => element.locationId === id) ?? false
      );
    });

    return Boolean(incidents.count || schedules.count || isPlacedOnFloorPlan);
  }
}

import type { DatabaseClient } from "../_shared/types.ts";

const columns =
  "id, code, building, floor, zone, asset_name, created_at, updated_at";

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
  }) {
    const { data, error } = await this.db
      .from("managed_locations")
      .insert({
        // The QR token is an opaque, server-generated identifier. It is never
        // entered by an administrator and remains stable when location details change.
        code: `LOC-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
        building: input.building,
        floor: input.floor,
        zone: input.zone,
        asset_name: input.assetName,
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
    },
  ) {
    const { data, error } = await this.db
      .from("managed_locations")
      .update({
        building: input.building,
        floor: input.floor,
        zone: input.zone,
        asset_name: input.assetName,
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
}

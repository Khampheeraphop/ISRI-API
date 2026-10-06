import type { DatabaseClient } from "../_shared/types.ts";

export type FloorPlanElement = {
  id: string;
  type: "room" | "area" | "asset" | "label";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fontSize?: number;
  locationId: string | null;
  parentId: string | null;
};

export type FloorPlanLayout = { elements: FloorPlanElement[] };

type Background = {
  bucket: string;
  objectPath: string;
  fileName: string;
} | null;

const planColumns =
  "id,building,floor,name,canvas_width,canvas_height,background_bucket,background_object_path,background_file_name,layout,version,is_published,created_at,updated_at";

export class FloorPlanRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list() {
    const { data, error } = await this.db
      .from("floor_plans")
      .select(planColumns)
      .order("building")
      .order("floor");
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string) {
    const { data, error } = await this.db
      .from("floor_plans")
      .select(planColumns)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listVersions(floorPlanId: string) {
    const { data, error } = await this.db
      .from("floor_plan_versions")
      .select("id,version,is_published,created_at,saved_by")
      .eq("floor_plan_id", floorPlanId)
      .order("version", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async save(input: {
    id?: string;
    building: string;
    floor: string;
    name: string;
    canvasWidth: number;
    canvasHeight: number;
    layout: FloorPlanLayout;
    background: Background;
    isPublished: boolean;
    userId: string;
  }) {
    const existing = input.id ? await this.findById(input.id) : null;
    const nextVersion = existing ? Number(existing.version) + 1 : 1;
    const payload = {
      building: input.building,
      floor: input.floor,
      name: input.name,
      canvas_width: input.canvasWidth,
      canvas_height: input.canvasHeight,
      background_bucket: input.background?.bucket ?? null,
      background_object_path: input.background?.objectPath ?? null,
      background_file_name: input.background?.fileName ?? null,
      layout: input.layout,
      version: nextVersion,
      is_published: input.isPublished,
      updated_by: input.userId,
    };
    const query = existing
      ? this.db.from("floor_plans").update(payload).eq("id", existing.id)
      : this.db.from("floor_plans").insert({
          ...payload,
          created_by: input.userId,
        });
    const { data, error } = await query.select(planColumns).single();
    if (error) throw error;
    const { error: versionError } = await this.db
      .from("floor_plan_versions")
      .insert({
        floor_plan_id: data.id,
        version: nextVersion,
        layout: input.layout,
        background_bucket: input.background?.bucket ?? null,
        background_object_path: input.background?.objectPath ?? null,
        background_file_name: input.background?.fileName ?? null,
        is_published: input.isPublished,
        saved_by: input.userId,
      });
    if (versionError) throw versionError;
    return data;
  }
}

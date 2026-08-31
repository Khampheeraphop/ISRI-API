import type { DatabaseClient } from "../_shared/types.ts";
import type { IncidentAttachment } from "./fileRepository.ts";

export class IncidentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listForReporter(reporterId: string) {
    const { data, error } = await this.db
      .from("incidents")
      .select(
        "id, ticket_number, location_id, location_label, asset_name, category, other_category, urgency_reported, description, status, rejection_reason, rejected_at, created_at, updated_at",
      )
      .eq("reporter_id", reporterId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async create(input: {
    locationId: string;
    locationLabel: string;
    assetName: string | null;
    category: string;
    otherCategory: string | null;
    urgencyReported: string;
    description: string;
    reporterId: string;
    attachments: IncidentAttachment[];
  }) {
    const { data, error } = await this.db
      .from("incidents")
      .insert({
        location_id: input.locationId,
        location_label: input.locationLabel,
        asset_name: input.assetName,
        category: input.category,
        other_category: input.otherCategory,
        urgency_reported: input.urgencyReported,
        description: input.description,
        reporter_id: input.reporterId,
        status: "pending_assignment",
      })
      .select("id, ticket_number, status, created_at")
      .single();
    if (error) throw error;
    if (input.attachments.length) {
      const { data: fileRows, error: filesError } = await this.db
        .from("files")
        .insert(
          input.attachments.map((file) => ({
            bucket: "incident-attachments",
            object_path: file.objectPath,
            file_name: file.fileName,
            mime_type: file.mimeType,
            size_bytes: file.sizeBytes,
            uploaded_by: input.reporterId,
          })),
        )
        .select("id");
      if (filesError) throw filesError;
      const { error: linksError } = await this.db.from("incident_files").insert(
        (fileRows ?? []).map((file) => ({
          incident_id: data.id,
          file_id: file.id,
        })),
      );
      if (linksError) throw linksError;
    }
    return data;
  }

  async findForReporter(id: string, reporterId: string) {
    const { data: incident, error: incidentError } = await this.db
      .from("incidents")
      .select(
        "id, ticket_number, location_id, location_label, asset_name, category, other_category, urgency_reported, description, status, rejection_reason, rejected_at, created_at, updated_at",
      )
      .eq("id", id)
      .eq("reporter_id", reporterId)
      .maybeSingle();
    if (incidentError) throw incidentError;
    if (!incident) return null;
    const { data: fileLinks, error: filesError } = await this.db
      .from("incident_files")
      .select(
        "files(id, bucket, object_path, file_name, mime_type, size_bytes)",
      )
      .eq("incident_id", id);
    if (filesError) throw filesError;
    return { incident, fileLinks: fileLinks ?? [] };
  }

  async lifecycleEvents(incidentId: string) {
    const { data, error } = await this.db
      .from("incidents")
      .select(
        "id, reporter_id, created_at, status, rejection_reason, rejected_by, rejected_at",
      )
      .eq("id", incidentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return [];
    const events = [
      {
        id: `incident-created-${data.id}`,
        status: "pending_assignment",
        changed_by: data.reporter_id,
        changed_at: data.created_at,
        note: "สร้างรายการแจ้งซ่อม",
        event_type: "incident_created",
      },
    ];
    if (
      data.status === "rejected" &&
      data.rejection_reason &&
      data.rejected_by &&
      data.rejected_at
    ) {
      events.push({
        id: `incident-rejected-${data.id}`,
        status: "rejected",
        changed_by: data.rejected_by,
        changed_at: data.rejected_at,
        note: data.rejection_reason,
        event_type: "incident_rejected",
      });
    }
    return events;
  }

  async findForDispatch(id: string) {
    const { data, error } = await this.db
      .from("incidents")
      .select(
        "id, ticket_number, category, other_category, urgency_reported, urgency_verified, created_at",
      )
      .eq("id", id)
      .eq("status", "pending_assignment")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findForDispatchDetail(id: string) {
    const { data: incident, error: incidentError } = await this.db
      .from("incidents")
      .select(
        "id, ticket_number, location_id, location_label, asset_name, category, other_category, urgency_reported, urgency_verified, description, status, created_at, updated_at",
      )
      .eq("id", id)
      .eq("status", "pending_assignment")
      .maybeSingle();
    if (incidentError) throw incidentError;
    if (!incident) return null;
    const { data: fileLinks, error: filesError } = await this.db
      .from("incident_files")
      .select(
        "files(id, bucket, object_path, file_name, mime_type, size_bytes)",
      )
      .eq("incident_id", id);
    if (filesError) throw filesError;
    return { incident, fileLinks: fileLinks ?? [] };
  }

  async listPendingAssignment() {
    const { data, error } = await this.db
      .from("incidents")
      .select(
        "id, ticket_number, location_label, asset_name, category, other_category, urgency_reported, urgency_verified, description, created_at",
      )
      .eq("status", "pending_assignment")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  async findActiveForLocation(locationId: string) {
    const { data, error } = await this.db
      .from("incidents")
      .select("id")
      .eq("location_id", locationId)
      .in("status", [
        "submitted",
        "pending_assignment",
        "assigned",
        "in_progress",
        "pending_parts_approval",
        "waiting_parts",
        "pending_repair_approval",
      ])
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async markAssigned(id: string) {
    const { error } = await this.db
      .from("incidents")
      .update({ status: "assigned" })
      .eq("id", id);
    if (error) throw error;
  }

  async verifyUrgency(id: string, urgency: string, verifiedBy: string) {
    const { data, error } = await this.db
      .from("incidents")
      .update({
        urgency_verified: urgency,
        urgency_verified_by: verifiedBy,
        urgency_verified_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending_assignment")
      .select("id, urgency_verified")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async updateStatus(id: string, status: string) {
    const { error } = await this.db
      .from("incidents")
      .update({ status })
      .eq("id", id);
    if (error) throw error;
  }

  async rejectPendingAssignment(input: {
    id: string;
    reason: string;
    rejectedBy: string;
  }) {
    const { data, error } = await this.db
      .from("incidents")
      .update({
        status: "rejected",
        rejection_reason: input.reason,
        rejected_by: input.rejectedBy,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("status", "pending_assignment")
      .select("id, ticket_number, status, rejection_reason, rejected_at")
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}

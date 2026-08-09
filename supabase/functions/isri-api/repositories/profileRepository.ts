import type {
  AppRole,
  ApprovalStatus,
  DatabaseClient,
  Profile,
  Specialty,
} from "../_shared/types.ts";
import { profileColumns } from "../_shared/types.ts";

export class ProfileRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string): Promise<Profile | null> {
    const { data, error } = await this.db
      .from("profiles")
      .select(profileColumns)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as Profile | null;
  }

  async updateOnboarding(
    id: string,
    requestedPosition: string,
    specialties: Specialty[],
  ) {
    const { data, error } = await this.db
      .from("profiles")
      .update({
        requested_position: requestedPosition,
        technician_specialties: specialties,
        rejection_reason: null,
      })
      .eq("id", id)
      .select(profileColumns)
      .single();
    if (error) throw error;
    return data as Profile;
  }

  async list(approvalStatus: ApprovalStatus | null) {
    let query = this.db
      .from("profiles")
      .select(`${profileColumns}, created_at`)
      .order("created_at", { ascending: true });
    if (approvalStatus) query = query.eq("approval_status", approvalStatus);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async listApprovedByRole(role: AppRole) {
    const { data, error } = await this.db
      .from("profiles")
      .select(profileColumns)
      .eq("approval_status", "approved")
      .eq("role", role);
    if (error) throw error;
    return data as Profile[];
  }

  async namesByIds(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const { data, error } = await this.db
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set(ids)]);
    if (error) throw error;
    return new Map(
      (data ?? []).map((profile) => [profile.id, profile.full_name]),
    );
  }

  async setApproval(input: {
    id: string;
    approvalStatus: ApprovalStatus;
    role: AppRole | null;
    specialties: Specialty[];
    actedBy: string;
    note: string | null;
  }) {
    const { data, error } = await this.db
      .from("profiles")
      .update({
        approval_status: input.approvalStatus,
        role: input.approvalStatus === "approved" ? input.role : null,
        technician_specialties:
          input.approvalStatus === "approved" && input.role === "technician"
            ? input.specialties
            : [],
        approved_by: input.approvalStatus === "approved" ? input.actedBy : null,
        approved_at:
          input.approvalStatus === "approved" ? new Date().toISOString() : null,
        rejection_reason:
          input.approvalStatus === "rejected" ? input.note : null,
      })
      .eq("id", input.id)
      .select(profileColumns)
      .single();
    if (error) throw error;
    const { error: historyError } = await this.db
      .from("user_approval_history")
      .insert({
        user_id: input.id,
        action: input.approvalStatus,
        role: input.approvalStatus === "approved" ? input.role : null,
        specialties:
          input.approvalStatus === "approved" && input.role === "technician"
            ? input.specialties
            : [],
        note: input.note,
        acted_by: input.actedBy,
      });
    if (historyError) throw historyError;
    return data as Profile;
  }
}

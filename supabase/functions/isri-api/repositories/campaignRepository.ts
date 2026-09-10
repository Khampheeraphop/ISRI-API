import { HttpError } from "../_shared/http.ts";
import type { DatabaseClient } from "../_shared/types.ts";

const rewardColumns =
  "id, name, description, point_cost, stock, is_active, image_file_id, reward_period, files(id, bucket, object_path, file_name, mime_type, size_bytes)";
const awardColumns =
  "id, campaign_id, user_id, reward_item_id, rank, status, awarded_at, fulfilled_at, cancelled_at, admin_note, profiles!campaign_awards_user_id_fkey(full_name)";
const campaignColumns = `id, name, period_type, start_date, end_date, prize_description, status, reward_item_id, winner_count, reserved_reward_count, created_at, updated_at, reward_item:reward_items!reward_campaigns_reward_item_id_fkey(${rewardColumns}), campaign_awards(${awardColumns})`;

export type CampaignInput = {
  name: string;
  periodType: "monthly" | "yearly" | "custom";
  startDate: string;
  endDate: string;
  rewardItemId: string;
  winnerCount: number;
};

function campaignError(cause: { message?: string } | null): never {
  throw new HttpError(cause?.message || "ไม่สามารถบันทึกแคมเปญได้", 409);
}

export class CampaignRepository {
  constructor(private readonly db: DatabaseClient) {}

  async finalizeExpired() {
    const { error } = await this.db.rpc("finalize_expired_campaigns");
    if (error) campaignError(error);
  }

  async list() {
    await this.finalizeExpired();
    const { data, error } = await this.db
      .from("reward_campaigns")
      .select(campaignColumns)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async findById(id: string) {
    await this.finalizeExpired();
    const { data, error } = await this.db
      .from("reward_campaigns")
      .select(campaignColumns)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listScores(campaignId: string) {
    const { data, error } = await this.db
      .from("campaign_scores")
      .select("campaign_id, user_id, points, last_scored_at")
      .eq("campaign_id", campaignId)
      .order("points", { ascending: false })
      .order("last_scored_at", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data ?? [];
  }

  async create(input: CampaignInput) {
    const { data, error } = await this.db.rpc("create_reward_campaign", {
      p_name: input.name,
      p_period_type: input.periodType,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_reward_item_id: input.rewardItemId,
      p_winner_count: input.winnerCount,
    });
    if (error) campaignError(error);
    const campaign = await this.findById(data.id);
    if (!campaign) throw new HttpError("ไม่พบแคมเปญหลังบันทึก", 500);
    return campaign;
  }

  async update(id: string, input: CampaignInput) {
    const { data, error } = await this.db.rpc("update_reward_campaign", {
      p_campaign_id: id,
      p_name: input.name,
      p_period_type: input.periodType,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_reward_item_id: input.rewardItemId,
      p_winner_count: input.winnerCount,
    });
    if (error) campaignError(error);
    const campaign = await this.findById(data.id);
    if (!campaign) throw new HttpError("ไม่พบแคมเปญหลังบันทึก", 500);
    return campaign;
  }

  async close(id: string) {
    const { data, error } = await this.db.rpc("finalize_reward_campaign", {
      p_campaign_id: id,
    });
    if (error) campaignError(error);
    const campaign = await this.findById(data.id);
    if (!campaign) throw new HttpError("ไม่พบแคมเปญหลังปิดรอบ", 500);
    return campaign;
  }

  async updateAwardStatus(input: {
    awardId: string;
    status: "fulfilled" | "cancelled";
    note: string | null;
  }) {
    const { data, error } = await this.db.rpc("update_campaign_award_status", {
      p_award_id: input.awardId,
      p_status: input.status,
      p_admin_note: input.note,
    });
    if (error) campaignError(error);
    return data;
  }
}

import type { DatabaseClient } from "../_shared/types.ts";

const campaignColumns =
  "id, name, period_type, start_date, end_date, prize_description, status, created_at, updated_at";

export type CampaignInput = {
  name: string;
  periodType: "monthly" | "yearly" | "custom";
  startDate: string;
  endDate: string;
  prizeDescription: string;
};

export class CampaignRepository {
  constructor(private readonly db: DatabaseClient) {}

  async finalizeExpired() {
    const { error } = await this.db.rpc("finalize_expired_campaigns");
    if (error) throw error;
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
    const { data, error } = await this.db
      .from("reward_campaigns")
      .insert({
        name: input.name,
        period_type: input.periodType,
        start_date: input.startDate,
        end_date: input.endDate,
        prize_description: input.prizeDescription,
        status: "active",
      })
      .select(campaignColumns)
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, input: CampaignInput) {
    await this.finalizeExpired();
    const { data, error } = await this.db
      .from("reward_campaigns")
      .update({
        name: input.name,
        period_type: input.periodType,
        start_date: input.startDate,
        end_date: input.endDate,
        prize_description: input.prizeDescription,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "active")
      .select(campaignColumns)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async close(id: string) {
    const { data, error } = await this.db
      .from("reward_campaigns")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "active")
      .select(campaignColumns)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}

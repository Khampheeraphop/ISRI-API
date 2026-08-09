import type { DatabaseClient } from "../_shared/types.ts";

const rewardColumns =
  "id, name, description, point_cost, stock, is_active, image_file_id, reward_period, created_at, updated_at, files(id, bucket, object_path, file_name, mime_type, size_bytes)";

export class RewardRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listCatalog(includeInactive = false) {
    let query = this.db
      .from("reward_items")
      .select(rewardColumns)
      .order("created_at");
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async listWallet(userId: string) {
    const [wallet, transactions] = await Promise.all([
      this.db
        .from("point_wallets")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle(),
      this.db
        .from("point_transactions")
        .select(
          "id, amount, transaction_type, reason, ref_incident_id, ref_reward_item_id, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ]);
    if (wallet.error) throw wallet.error;
    if (transactions.error) throw transactions.error;
    return {
      balance: wallet.data?.balance ?? 0,
      transactions: transactions.data ?? [],
    };
  }

  async redeem(userId: string, rewardItemId: string) {
    const { data, error } = await this.db.rpc("redeem_reward", {
      p_user_id: userId,
      p_reward_item_id: rewardItemId,
    });
    if (error) throw error;
    return data;
  }

  async create(input: {
    name: string;
    description: string;
    pointCost: number;
    stock: number;
    isActive: boolean;
    rewardPeriod: "standard" | "annual";
    imageFileId: string;
  }) {
    const { data, error } = await this.db
      .from("reward_items")
      .insert({
        name: input.name,
        description: input.description,
        point_cost: input.pointCost,
        stock: input.stock,
        is_active: input.isActive,
        reward_period: input.rewardPeriod,
        image_file_id: input.imageFileId,
      })
      .select(rewardColumns)
      .single();
    if (error) throw error;
    return data;
  }

  async update(
    id: string,
    input: {
      name: string;
      description: string;
      pointCost: number;
      stock: number;
      isActive: boolean;
      rewardPeriod: "standard" | "annual";
      imageFileId?: string;
    },
  ) {
    const { data, error } = await this.db
      .from("reward_items")
      .update({
        name: input.name,
        description: input.description,
        point_cost: input.pointCost,
        stock: input.stock,
        is_active: input.isActive,
        reward_period: input.rewardPeriod,
        ...(input.imageFileId ? { image_file_id: input.imageFileId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(rewardColumns)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async delete(id: string) {
    const { error } = await this.db.from("reward_items").delete().eq("id", id);
    if (error) throw error;
  }
}

import type { DatabaseClient } from "../_shared/types.ts";

const rewardColumns =
  "id, name, description, point_cost, stock, is_active, image_file_id, reward_period, created_at, updated_at, files(id, bucket, object_path, file_name, mime_type, size_bytes)";

export class RewardRepository {
  constructor(private readonly db: DatabaseClient) {}

  async listCatalog(includeInactive = false) {
    let query = this.db
      .from("reward_items")
      .select(rewardColumns)
      .order("created_at", { ascending: false });
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async listWallet(userId: string) {
    const [wallet, transactions, redemptions] = await Promise.all([
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
      this.db
        .from("reward_redemptions")
        .select(
          "id, reward_item_id, status, fulfillment_method, recipient_name, phone, delivery_address, requester_note, admin_note, redeemed_at, fulfilled_at, cancelled_at, reward_items(name, point_cost)",
        )
        .eq("user_id", userId)
        .order("redeemed_at", { ascending: false }),
    ]);
    if (wallet.error) throw wallet.error;
    if (transactions.error) throw transactions.error;
    if (redemptions.error) throw redemptions.error;
    return {
      balance: wallet.data?.balance ?? 0,
      transactions: transactions.data ?? [],
      redemptions: redemptions.data ?? [],
    };
  }

  async redeem(
    userId: string,
    input: {
      rewardItemId: string;
      fulfillmentMethod: "pickup" | "delivery";
      recipientName: string;
      phone: string;
      deliveryAddress: string | null;
      requesterNote: string | null;
    },
  ) {
    const { data, error } = await this.db.rpc("redeem_reward", {
      p_user_id: userId,
      p_reward_item_id: input.rewardItemId,
      p_fulfillment_method: input.fulfillmentMethod,
      p_recipient_name: input.recipientName,
      p_phone: input.phone,
      p_delivery_address: input.deliveryAddress,
      p_requester_note: input.requesterNote,
    });
    if (error) throw error;
    return data;
  }

  async listRedemptions() {
    const { data, error } = await this.db
      .from("reward_redemptions")
      .select(
        "id, user_id, reward_item_id, status, fulfillment_method, recipient_name, phone, delivery_address, requester_note, admin_note, redeemed_at, fulfilled_at, cancelled_at, profiles!reward_redemptions_user_id_fkey(full_name, email), reward_items(name, point_cost)",
      )
      .order("redeemed_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async updateRedemptionStatus(input: {
    id: string;
    status: "fulfilled" | "cancelled";
    actorId: string;
    note: string | null;
  }) {
    const { data, error } = await this.db.rpc("set_reward_redemption_status", {
      p_redemption_id: input.id,
      p_status: input.status,
      p_actor_id: input.actorId,
      p_admin_note: input.note,
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

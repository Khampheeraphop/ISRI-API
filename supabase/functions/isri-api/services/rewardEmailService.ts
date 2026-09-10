import {
  EmailOutboxRepository,
  type QueuedWorkflowEmail,
} from "../repositories/emailOutboxRepository.ts";
import type { DatabaseClient } from "../_shared/types.ts";
import { WorkflowEmailService } from "./workflowEmailService.ts";

// @ts-ignore - Deno types not available in this environment
const Deno = globalThis.Deno || {
  env: {
    get: (key: string) => (globalThis as any)[key] || null,
  },
};

const APP_URL =
  typeof Deno !== "undefined"
    ? Deno.env.get("APP_URL") || "http://localhost:5173"
    : "http://localhost:5173";

export class RewardEmailService {
  constructor(
    private readonly outbox: EmailOutboxRepository,
    private readonly db: DatabaseClient,
    private readonly workflowEmails?: WorkflowEmailService,
  ) {}

  private async enqueueAndDeliver(emails: QueuedWorkflowEmail[]) {
    try {
      await this.outbox.enqueueMany(emails);
      await this.workflowEmails?.deliverPending(25);
    } catch (error) {
      // Reward state is already committed. Email delivery must remain best effort.
      console.error("Failed to enqueue or deliver reward email", error);
    }
  }

  async enqueueRedemptionSubmitted(
    redemptionId: string,
    userId: string,
    rewardName: string,
    pointCost: number,
  ) {
    // Get user info
    const { data: user } = await this.db
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .single();

    if (!user) return;

    // Get admin emails
    const { data: admins } = await this.db
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "admin")
      .eq("approval_status", "approved");

    const emails: QueuedWorkflowEmail[] = [];

    // Email to user
    emails.push({
      recipientUserId: userId,
      recipientEmail: user.email,
      eventKey: "reward_redemption_submitted",
      relatedRedemptionId: redemptionId,
      payload: {
        recipientName: user.full_name,
        rewardName,
        pointCost,
        locationLabel: null, // Reward emails don't need location
        actionUrl: `${APP_URL}/rewards`,
      },
    });

    // Emails to admins
    if (admins) {
      for (const admin of admins) {
        emails.push({
          recipientUserId: admin.id,
          recipientEmail: admin.email,
          eventKey: "reward_redemption_submitted",
          relatedRedemptionId: redemptionId,
          payload: {
            recipientName: admin.full_name,
            rewardName,
            pointCost,
            locationLabel: null,
          actionUrl: `${APP_URL}/rewards/redemptions`,
          },
        });
      }
    }

    await this.enqueueAndDeliver(emails);
  }

  async enqueueRedemptionApproved(
    redemptionId: string,
    userId: string,
    rewardName: string,
    pointCost: number,
    fulfillmentMethod: "pickup" | "delivery",
  ) {
    const { data: user } = await this.db
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .single();

    if (!user) return;

    await this.enqueueAndDeliver([
      {
        recipientUserId: userId,
        recipientEmail: user.email,
        eventKey: "reward_redemption_approved",
        relatedRedemptionId: redemptionId,
        payload: {
          recipientName: user.full_name,
          rewardName,
          pointCost,
          fulfillmentMethod,
          locationLabel: null,
          actionUrl: `${APP_URL}/rewards`,
        },
      },
    ]);
  }

  async enqueueRedemptionFulfilled(
    redemptionId: string,
    userId: string,
    rewardName: string,
    adminNote: string | null,
  ) {
    const { data: user } = await this.db
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .single();

    if (!user) return;

    await this.enqueueAndDeliver([
      {
        recipientUserId: userId,
        recipientEmail: user.email,
        eventKey: "reward_redemption_fulfilled",
        relatedRedemptionId: redemptionId,
        payload: {
          recipientName: user.full_name,
          rewardName,
          note: adminNote,
          locationLabel: null,
          actionUrl: `${APP_URL}/rewards`,
        },
      },
    ]);
  }

  async enqueueRedemptionCancelled(
    redemptionId: string,
    userId: string,
    rewardName: string,
    pointCost: number,
    rejectionReason: string,
  ) {
    const { data: user } = await this.db
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .single();

    if (!user) return;

    await this.enqueueAndDeliver([
      {
        recipientUserId: userId,
        recipientEmail: user.email,
        eventKey: "reward_redemption_cancelled",
        relatedRedemptionId: redemptionId,
        payload: {
          recipientName: user.full_name,
          rewardName,
          pointCost,
          rejectionReason,
          locationLabel: null,
          actionUrl: `${APP_URL}/rewards`,
        },
      },
    ]);
  }
}

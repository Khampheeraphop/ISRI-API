import type { DatabaseClient } from "../_shared/types.ts";
import type {
  EmailEventKey,
  WorkflowEmailPayload,
} from "../services/workflowEmailTemplate.ts";

export interface EmailAttachment {
  filename: string;
  content: string;
  content_type?: string;
}

export interface QueuedWorkflowEmail {
  recipientUserId: string;
  recipientEmail: string;
  eventKey: EmailEventKey;
  relatedIncidentId?: string | null;
  relatedWorkOrderId?: string | null;
  relatedPmScheduleId?: string | null;
  relatedRedemptionId?: string | null;
  payload: WorkflowEmailPayload;
  attachments?: EmailAttachment[] | null;
}

export interface EmailOutboxItem extends QueuedWorkflowEmail {
  id: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  idempotencyKey: string;
}

const outboxColumns =
  "id, recipient_user_id, recipient_email, event_key, related_incident_id, related_work_order_id, related_pm_schedule_id, related_redemption_id, payload, attachments, status, attempts, idempotency_key";

export class EmailOutboxRepository {
  constructor(private readonly db: DatabaseClient) {}

  async enqueueMany(items: QueuedWorkflowEmail[]) {
    const uniqueByRecipientAndEvent = new Map<string, QueuedWorkflowEmail>();
    for (const item of items) {
      if (!item.recipientEmail.trim()) continue;
      uniqueByRecipientAndEvent.set(
        `${item.eventKey}:${item.recipientUserId}:${item.relatedIncidentId ?? ""}:${item.relatedWorkOrderId ?? ""}:${item.relatedPmScheduleId ?? ""}:${item.relatedRedemptionId ?? ""}`,
        item,
      );
    }
    const values = [...uniqueByRecipientAndEvent.values()];
    if (!values.length) return [];
    const { data, error } = await this.db
      .from("email_outbox")
      .insert(
        values.map((item) => ({
          recipient_user_id: item.recipientUserId,
          recipient_email: item.recipientEmail.trim(),
          event_key: item.eventKey,
          related_incident_id: item.relatedIncidentId ?? null,
          related_work_order_id: item.relatedWorkOrderId ?? null,
          related_pm_schedule_id: item.relatedPmScheduleId ?? null,
          related_redemption_id: item.relatedRedemptionId ?? null,
          payload: item.payload,
          attachments: item.attachments ?? null,
        })),
      )
      .select("id");
    if (error) throw error;
    return data ?? [];
  }

  async listDeliverable(limit: number) {
    const { data, error } = await this.db
      .from("email_outbox")
      .select(outboxColumns)
      .in("status", ["pending", "failed"])
      .lt("attempts", 5)
      .lte("scheduled_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(toOutboxItem);
  }

  async claim(id: string, currentAttempts: number) {
    const { data, error } = await this.db
      .from("email_outbox")
      .update({
        status: "sending",
        attempts: currentAttempts + 1,
        last_error: null,
      })
      .eq("id", id)
      .in("status", ["pending", "failed"])
      .eq("attempts", currentAttempts)
      .select(outboxColumns)
      .maybeSingle();
    if (error) throw error;
    return data ? toOutboxItem(data) : null;
  }

  async markSent(id: string, providerMessageId: string | null) {
    const { error } = await this.db
      .from("email_outbox")
      .update({
        status: "sent",
        provider_message_id: providerMessageId,
        last_error: null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async markFailed(id: string, attempts: number, cause: string) {
    const retryMinutes = Math.min(30, Math.max(1, attempts) * 2);
    const { error } = await this.db
      .from("email_outbox")
      .update({
        status: "failed",
        last_error: cause.slice(0, 2000),
        scheduled_at: new Date(
          Date.now() + retryMinutes * 60_000,
        ).toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }
}

function toOutboxItem(row: Record<string, unknown>): EmailOutboxItem {
  return {
    id: String(row.id),
    recipientUserId: String(row.recipient_user_id),
    recipientEmail: String(row.recipient_email),
    eventKey: row.event_key as EmailEventKey,
    relatedIncidentId: row.related_incident_id
      ? String(row.related_incident_id)
      : null,
    relatedWorkOrderId: row.related_work_order_id
      ? String(row.related_work_order_id)
      : null,
    relatedPmScheduleId: row.related_pm_schedule_id
      ? String(row.related_pm_schedule_id)
      : null,
    relatedRedemptionId: row.related_redemption_id
      ? String(row.related_redemption_id)
      : null,
    payload: (row.payload ?? {}) as WorkflowEmailPayload,
    attachments: (row.attachments ?? null) as EmailAttachment[] | null,
    status: row.status as EmailOutboxItem["status"],
    attempts: Number(row.attempts),
    idempotencyKey: String(row.idempotency_key),
  };
}

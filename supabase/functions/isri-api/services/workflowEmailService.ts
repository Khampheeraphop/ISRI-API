import {
  EmailOutboxRepository,
  type QueuedWorkflowEmail,
} from "../repositories/emailOutboxRepository.ts";
import { renderWorkflowEmail } from "./workflowEmailTemplate.ts";

export class WorkflowEmailService {
  constructor(private readonly outbox: EmailOutboxRepository) {}

  async enqueueMany(items: QueuedWorkflowEmail[]) {
    return await this.outbox.enqueueMany(items);
  }

  async deliverPending(limit = 10) {
    const config = this.readConfiguration();
    if (!config) {
      return {
        attempted: 0,
        sent: 0,
        failed: 0,
        skipped: "not_configured" as const,
      };
    }
    const candidates = await this.outbox.listDeliverable(
      Math.max(1, Math.min(25, limit)),
    );
    let sent = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const item = await this.outbox.claim(candidate.id, candidate.attempts);
      if (!item) continue;
      const message = renderWorkflowEmail(item.eventKey, item.payload);
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "ISRI Email Service/1.0",
            "Idempotency-Key": item.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [item.recipientEmail],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(item.attachments?.length
              ? { attachments: item.attachments }
              : {}),
          }),
        });
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(
            `Resend returned ${response.status}: ${responseText.slice(0, 1000)}`,
          );
        }
        let providerMessageId: string | null = null;
        try {
          const body = JSON.parse(responseText) as { id?: unknown };
          providerMessageId = typeof body.id === "string" ? body.id : null;
        } catch {
          // A successful provider response without JSON is still a sent email.
        }
        await this.outbox.markSent(item.id, providerMessageId);
        sent += 1;
      } catch (cause) {
        const description =
          cause instanceof Error ? cause.message : String(cause);
        await this.outbox.markFailed(item.id, item.attempts, description);
        console.error("Workflow email delivery failed", {
          outboxId: item.id,
          eventKey: item.eventKey,
          attempts: item.attempts,
          description,
        });
        failed += 1;
      }
    }
    return { attempted: candidates.length, sent, failed, skipped: null };
  }

  readConfiguration() {
    const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
    const from = Deno.env.get("EMAIL_FROM")?.trim() || "ISRI <noreply@isri.local>";
    const appUrl =
      Deno.env.get("APP_URL")?.trim().replace(/\/$/, "") ||
      "http://localhost:5173";
    if (!apiKey) return null;
    return { apiKey, from, appUrl };
  }
}

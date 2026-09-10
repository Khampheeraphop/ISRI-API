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

export class PmReminderService {
  constructor(
    private readonly outbox: EmailOutboxRepository,
    private readonly db: DatabaseClient,
    private readonly workflowEmails?: WorkflowEmailService,
  ) {}

  private reminderDedupeKey(
    eventKey: "pm_due_soon" | "pm_overdue",
    scheduleId: string,
    recipientId: string,
    nextDueAt: string,
  ) {
    return `${eventKey}:${scheduleId}:${recipientId}:${nextDueAt}`;
  }

  private async enqueueAndDeliver(emails: QueuedWorkflowEmail[]) {
    if (!emails.length) return;
    await this.outbox.enqueueMany(emails);
    await this.workflowEmails?.deliverPending(25);
  }

  private async enqueueReminderNotifications(emails: QueuedWorkflowEmail[]) {
    const reminders = emails.filter(
      (email) => email.eventKey === "pm_due_soon" || email.eventKey === "pm_overdue",
    );
    if (!reminders.length) return;
    const { error } = await this.db.from("notifications").upsert(
      reminders.map((email) => ({
        user_id: email.recipientUserId,
        type: email.eventKey,
        message: `${email.eventKey === "pm_overdue" ? "PM เกินกำหนด" : "PM ใกล้ครบกำหนด"}: ${email.payload.assetName ?? "แผน PM"} ที่ ${email.payload.locationLabel ?? "สถานที่ที่กำหนด"}`,
        related_pm_schedule_id: email.relatedPmScheduleId,
        dedupe_key: email.dedupeKey,
      })),
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  async checkPmDueSoon(daysAhead = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

    const { data: dueSoonSchedules } = await this.db
      .from("pm_schedules")
      .select(
        `
        id,
        asset_name,
        location_label,
        next_due_at,
        assigned_technician_id,
        profiles!pm_schedules_assigned_technician_id_fkey(full_name, email)
      `,
      )
      .eq("status", "active")
      .lte("next_due_at", cutoffDate.toISOString())
      .gt("next_due_at", new Date().toISOString())
      .not("assigned_technician_id", "is", null);

    if (!dueSoonSchedules || dueSoonSchedules.length === 0) return 0;

    const emails: QueuedWorkflowEmail[] = [];

    for (const schedule of dueSoonSchedules as any[]) {
      const technician = schedule.profiles;
      if (!technician) continue;

      // Email to assigned technician
      emails.push({
        recipientUserId: schedule.assigned_technician_id,
        recipientEmail: technician.email,
        eventKey: "pm_due_soon",
        relatedPmScheduleId: schedule.id,
        dedupeKey: this.reminderDedupeKey(
          "pm_due_soon",
          schedule.id,
          schedule.assigned_technician_id,
          schedule.next_due_at,
        ),
        payload: {
          recipientName: technician.full_name,
          assetName: schedule.asset_name,
          locationLabel: schedule.location_label,
          nextDueAt: schedule.next_due_at,
          actionUrl: `${APP_URL}/pm/${schedule.id}/complete?tab=history`,
        },
      });

      // Email to admins
      const { data: admins } = await this.db
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "admin")
        .eq("approval_status", "approved");

      if (admins) {
        for (const admin of admins) {
          emails.push({
            recipientUserId: admin.id,
            recipientEmail: admin.email,
            eventKey: "pm_due_soon",
            relatedPmScheduleId: schedule.id,
            dedupeKey: this.reminderDedupeKey(
              "pm_due_soon",
              schedule.id,
              admin.id,
              schedule.next_due_at,
            ),
            payload: {
              recipientName: admin.full_name,
              assetName: schedule.asset_name,
              locationLabel: schedule.location_label,
              nextDueAt: schedule.next_due_at,
              actionUrl: `${APP_URL}/pm/${schedule.id}/complete?tab=history`,
            },
          });
        }
      }
    }

    await this.enqueueReminderNotifications(emails);
    await this.enqueueAndDeliver(emails);
    return emails.length;
  }

  async checkPmOverdue() {
    const { data: overdueSchedules } = await this.db
      .from("pm_schedules")
      .select(
        `
        id,
        asset_name,
        location_label,
        next_due_at,
        assigned_technician_id,
        profiles!pm_schedules_assigned_technician_id_fkey(full_name, email)
      `,
      )
      .eq("status", "active")
      .lt("next_due_at", new Date().toISOString())
      .not("assigned_technician_id", "is", null);

    if (!overdueSchedules || overdueSchedules.length === 0) return 0;

    const emails: QueuedWorkflowEmail[] = [];

    for (const schedule of overdueSchedules as any[]) {
      const technician = schedule.profiles;
      if (!technician) continue;

      // Email to assigned technician
      emails.push({
        recipientUserId: schedule.assigned_technician_id,
        recipientEmail: technician.email,
        eventKey: "pm_overdue",
        relatedPmScheduleId: schedule.id,
        dedupeKey: this.reminderDedupeKey(
          "pm_overdue",
          schedule.id,
          schedule.assigned_technician_id,
          schedule.next_due_at,
        ),
        payload: {
          recipientName: technician.full_name,
          assetName: schedule.asset_name,
          locationLabel: schedule.location_label,
          nextDueAt: schedule.next_due_at,
          actionUrl: `${APP_URL}/pm/${schedule.id}/complete?tab=history`,
        },
      });

      // Email to admins
      const { data: admins } = await this.db
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "admin")
        .eq("approval_status", "approved");

      if (admins) {
        for (const admin of admins) {
          emails.push({
            recipientUserId: admin.id,
            recipientEmail: admin.email,
            eventKey: "pm_overdue",
            relatedPmScheduleId: schedule.id,
            dedupeKey: this.reminderDedupeKey(
              "pm_overdue",
              schedule.id,
              admin.id,
              schedule.next_due_at,
            ),
            payload: {
              recipientName: admin.full_name,
              assetName: schedule.asset_name,
              locationLabel: schedule.location_label,
              nextDueAt: schedule.next_due_at,
              actionUrl: `${APP_URL}/pm/${schedule.id}/complete?tab=history`,
            },
          });
        }
      }
    }

    await this.enqueueReminderNotifications(emails);
    await this.enqueueAndDeliver(emails);
    return emails.length;
  }

  async enqueuePmCompletionLog(
    scheduleId: string,
    technicianId: string,
    assetName: string,
    locationLabel: string,
  ) {
    // Get technician info
    const { data: technician } = await this.db
      .from("profiles")
      .select("full_name, email")
      .eq("id", technicianId)
      .single();

    if (!technician) return;

    // Get admin emails
    const { data: admins } = await this.db
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "admin")
      .eq("approval_status", "approved");

    const emails: QueuedWorkflowEmail[] = [];

    // Emails to admins
    if (admins) {
      for (const admin of admins) {
        emails.push({
          recipientUserId: admin.id,
          recipientEmail: admin.email,
          eventKey: "pm_completion_log",
          relatedPmScheduleId: scheduleId,
          payload: {
            recipientName: admin.full_name,
            assetName,
            locationLabel,
            actionByName: technician.full_name,
            actionUrl: `${APP_URL}/pm/${scheduleId}/complete?tab=history`,
          },
        });
      }
    }

    await this.enqueueAndDeliver(emails);
  }
}

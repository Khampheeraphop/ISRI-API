import { HttpError } from "../_shared/http.ts";
import { LocationRepository } from "../repositories/locationRepository.ts";
import { PmScheduleRepository } from "../repositories/pmScheduleRepository.ts";
import { ProfileRepository } from "../repositories/profileRepository.ts";
import { WorkflowEmailService } from "./workflowEmailService.ts";
import { generatePmCalendarInvite } from "./icalendarGenerator.ts";

export type PmScheduleInput = {
  locationId: string;
  assetName: string;
  planDetails: string;
  intervalMonths: number;
  lastDoneAt: string | null;
  nextDueAt?: string;
  assignedTechnicianId?: string | null;
};

export function addMonths(date: Date, months: number) {
  // Shift to Thai wall time before month arithmetic, then convert back to UTC.
  const next = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return new Date(next.getTime() - 7 * 60 * 60 * 1000);
}

export function requirePmAssignment(
  schedule: { assigned_technician_id?: string | null },
  technicianId: string,
) {
  if (schedule.assigned_technician_id !== technicianId) {
    throw new HttpError("This PM plan is not assigned to you.", 403);
  }
}

export function parsePmScheduleInput(
  body: Record<string, unknown> | null,
): PmScheduleInput {
  const locationId =
    typeof body?.locationId === "string" ? body.locationId : "";
  const assetName =
    typeof body?.assetName === "string" ? body.assetName.trim() : "";
  const planDetails =
    typeof body?.planDetails === "string" ? body.planDetails.trim() : "";
  const intervalMonths = Number(body?.intervalMonths);
  const lastDoneAt =
    typeof body?.lastDoneAt === "string" ? body.lastDoneAt : "";
  const completedDate = lastDoneAt ? new Date(lastDoneAt) : null;
  const dueDate =
    typeof body?.nextDueAt === "string" ? new Date(body.nextDueAt) : null;
  const rawTechnicianId = body?.assignedTechnicianId;
  const assignedTechnicianId =
    typeof rawTechnicianId === "string" && rawTechnicianId.trim()
      ? rawTechnicianId.trim()
      : null;

  if (!/^[0-9a-f-]{36}$/i.test(locationId)) {
    throw new HttpError("PM location is invalid.");
  }
  if (assetName.length < 2 || assetName.length > 200) {
    throw new HttpError("PM asset name must contain 2–200 characters.");
  }
  if (planDetails.length < 10 || planDetails.length > 2000) {
    throw new HttpError("PM plan details must contain 10–2,000 characters.");
  }
  if (
    !Number.isInteger(intervalMonths) ||
    intervalMonths < 1 ||
    intervalMonths > 60
  ) {
    throw new HttpError("PM interval must be between 1 and 60 months.");
  }
  if (
    completedDate &&
    (Number.isNaN(completedDate.getTime()) || completedDate > new Date())
  ) {
    throw new HttpError("PM completion date is invalid.");
  }
  if (
    (!dueDate && !completedDate) ||
    (dueDate &&
      (Number.isNaN(dueDate.getTime()) ||
        (completedDate && dueDate <= completedDate)))
  ) {
    throw new HttpError(
      "PM next due date must be valid and after the last completion.",
    );
  }
  if (assignedTechnicianId && !/^[0-9a-f-]{36}$/i.test(assignedTechnicianId)) {
    throw new HttpError("PM assigned technician is invalid.");
  }

  return {
    locationId,
    assetName,
    planDetails,
    intervalMonths,
    lastDoneAt: completedDate?.toISOString() ?? null,
    nextDueAt: dueDate?.toISOString(),
    assignedTechnicianId,
  };
}

export class PmScheduleService {
  constructor(
    private readonly schedules: PmScheduleRepository,
    private readonly locations: LocationRepository,
    private readonly profiles?: ProfileRepository,
    private readonly workflowEmails?: WorkflowEmailService,
  ) {}

  async create(input: PmScheduleInput) {
    await this.ensureScheduleIsUnique(input);
    if (input.assignedTechnicianId) {
      await this.ensureTechnicianValid(input.assignedTechnicianId);
    }
    const created = await this.save(input);
    if (created && input.assignedTechnicianId) {
      await this.sendCalendarInvite(created, "pm_schedule_assigned");
    }
    return created;
  }

  async update(id: string, input: PmScheduleInput) {
    await this.ensureScheduleIsUnique(input, id);
    if (input.assignedTechnicianId) {
      await this.ensureTechnicianValid(input.assignedTechnicianId);
    }
    const values = await this.buildValues(input);
    const updated = await this.schedules.update(id, values);
    if (updated && updated.assigned_technician_id) {
      await this.sendCalendarInvite(updated, "pm_schedule_updated");
    }
    return updated;
  }

  async complete(
    scheduleId: string,
    technicianId: string,
    completedAt: string,
    notes: string,
  ) {
    const schedule = await this.schedules.findSchedule(scheduleId);
    if (!schedule) throw new HttpError("PM schedule was not found.", 404);
    requirePmAssignment(schedule, technicianId);
    const normalizedNotes = notes.trim();
    const completedDate = new Date(completedAt);
    if (normalizedNotes.length < 10 || normalizedNotes.length > 4000) {
      throw new HttpError("PM notes must contain 10–4,000 characters.");
    }
    if (Number.isNaN(completedDate.getTime()) || completedDate > new Date()) {
      throw new HttpError("PM completion date is invalid.");
    }

    const log = await this.schedules.recordCompletion({
      scheduleId,
      technicianId,
      completedAt: completedDate.toISOString(),
      notes: normalizedNotes,
    });
    const updatedSchedule = await this.schedules.findSchedule(scheduleId);
    if (!updatedSchedule) {
      throw new HttpError("PM schedule was not found after completion.", 404);
    }
    return { schedule: updatedSchedule, log };
  }

  private async save(input: PmScheduleInput) {
    return this.schedules.create(await this.buildValues(input));
  }

  private async ensureScheduleIsUnique(
    input: PmScheduleInput,
    excludeId?: string,
  ) {
    const existing = await this.schedules.findByLocationAndAsset(
      input.locationId,
      input.assetName,
      excludeId,
    );
    if (existing) {
      throw new HttpError(
        "PM plan for this location and asset already exists.",
        409,
      );
    }
  }

  private async ensureTechnicianValid(technicianId: string) {
    if (!this.profiles) return;
    const technician = await this.profiles.findById(technicianId);
    if (
      !technician ||
      technician.approval_status !== "approved" ||
      technician.role !== "technician"
    ) {
      throw new HttpError(
        "Assigned PM user must be an approved technician.",
        400,
      );
    }
  }

  private async sendCalendarInvite(
    schedule: Record<string, unknown>,
    eventKey: "pm_schedule_assigned" | "pm_schedule_updated",
  ) {
    if (!this.profiles || !this.workflowEmails) return;
    const technicianId =
      typeof schedule.assigned_technician_id === "string"
        ? schedule.assigned_technician_id
        : null;
    if (!technicianId) return;

    try {
      const technician = await this.profiles.findById(technicianId);
      if (!technician || !technician.email) return;

      const emailConfig = this.workflowEmails.readConfiguration();
      const appUrl = emailConfig?.appUrl || "http://localhost:5173";
      const fromEmail = emailConfig?.from || "noreply@isri.local";

      const calendar = generatePmCalendarInvite({
        scheduleId: String(schedule.id),
        assetName: String(schedule.asset_name),
        locationLabel: String(schedule.location_label),
        planDetails: String(schedule.plan_details),
        intervalMonths: Number(schedule.interval_months),
        nextDueAt: String(schedule.next_due_at),
        appUrl,
        technicianName: technician.full_name,
        technicianEmail: technician.email,
        organizerEmail: fromEmail,
      });

      await this.workflowEmails.enqueueMany([
        {
          recipientUserId: technician.id,
          recipientEmail: technician.email,
          eventKey,
          relatedPmScheduleId: String(schedule.id),
          payload: {
            recipientName: technician.full_name,
            assetName: String(schedule.asset_name),
            locationLabel: String(schedule.location_label),
            intervalMonths: Number(schedule.interval_months),
            nextDueAt: String(schedule.next_due_at),
            note: String(schedule.plan_details),
            actionUrl: `${appUrl}/pm/${schedule.id}/complete`,
            googleCalendarUrl: calendar.googleCalendarUrl,
          },
          attachments: [
            {
              filename: "pm-schedule.ics",
              content: calendar.base64Ics,
              content_type: "text/calendar; method=REQUEST; charset=UTF-8",
            },
          ],
        },
      ]);
      await this.workflowEmails.deliverPending();
    } catch (err) {
      // Don't let calendar invite failure abort PM schedule creation/update.
      console.error("Failed to enqueue PM calendar invite email", err);
    }
  }

  private async buildValues(input: PmScheduleInput) {
    const location = await this.locations.findById(input.locationId);
    if (!location) throw new HttpError("PM location was not found.", 404);
    return {
      ...input,
      locationLabel: `${location.building} · ${location.floor} · ${location.zone}`,
      nextDueAt:
        input.nextDueAt ??
        addMonths(
          new Date(input.lastDoneAt!),
          input.intervalMonths,
        ).toISOString(),
    };
  }
}

import { HttpError } from "../_shared/http.ts";
import { LocationRepository } from "../repositories/locationRepository.ts";
import { PmScheduleRepository } from "../repositories/pmScheduleRepository.ts";

type PmScheduleInput = {
  locationId: string;
  assetName: string;
  intervalMonths: number;
  lastDoneAt: string;
};

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function parsePmScheduleInput(
  body: Record<string, unknown> | null,
): PmScheduleInput {
  const locationId =
    typeof body?.locationId === "string" ? body.locationId : "";
  const assetName =
    typeof body?.assetName === "string" ? body.assetName.trim() : "";
  const intervalMonths = Number(body?.intervalMonths);
  const lastDoneAt =
    typeof body?.lastDoneAt === "string" ? body.lastDoneAt : "";
  const completedDate = new Date(lastDoneAt);

  if (!/^[0-9a-f-]{36}$/i.test(locationId))
    throw new HttpError("PM location is invalid.");
  if (assetName.length < 2 || assetName.length > 200)
    throw new HttpError("PM asset name must contain 2–200 characters.");
  if (
    !Number.isInteger(intervalMonths) ||
    intervalMonths < 1 ||
    intervalMonths > 60
  )
    throw new HttpError("PM interval must be between 1 and 60 months.");
  if (Number.isNaN(completedDate.getTime()) || completedDate > new Date())
    throw new HttpError("PM completion date is invalid.");

  return {
    locationId,
    assetName,
    intervalMonths,
    lastDoneAt: completedDate.toISOString(),
  };
}

export class PmScheduleService {
  constructor(
    private readonly schedules: PmScheduleRepository,
    private readonly locations: LocationRepository,
  ) {}

  async create(input: PmScheduleInput) {
    return this.save(input);
  }

  async update(id: string, input: PmScheduleInput) {
    const values = await this.buildValues(input);
    return this.schedules.update(id, values);
  }

  async complete(scheduleId: string, technicianId: string, notes: string) {
    const schedule = await this.schedules.findSchedule(scheduleId);
    if (!schedule) throw new HttpError("PM schedule was not found.", 404);
    const normalizedNotes = notes.trim();
    if (normalizedNotes.length < 10 || normalizedNotes.length > 4000)
      throw new HttpError("PM notes must contain 10–4,000 characters.");

    const log = await this.schedules.recordCompletion({
      scheduleId,
      technicianId,
      notes: normalizedNotes,
    });
    const updatedSchedule = await this.schedules.findSchedule(scheduleId);
    if (!updatedSchedule)
      throw new HttpError("PM schedule was not found after completion.", 404);
    return { schedule: updatedSchedule, log };
  }

  private async save(input: PmScheduleInput) {
    return this.schedules.create(await this.buildValues(input));
  }

  private async buildValues(input: PmScheduleInput) {
    const location = await this.locations.findById(input.locationId);
    if (!location) throw new HttpError("PM location was not found.", 404);
    const lastDoneAt = new Date(input.lastDoneAt);
    return {
      ...input,
      locationLabel: `${location.building} · ${location.floor} · ${location.zone}`,
      nextDueAt: addMonths(lastDoneAt, input.intervalMonths).toISOString(),
    };
  }
}

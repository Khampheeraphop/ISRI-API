import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  error,
  HttpError,
  json,
  optionsResponse,
  parseJson,
  parsePath,
} from "./_shared/http.ts";
import {
  allowedCategories,
  allowedRoles,
  allowedSpecialties,
  isApproved,
  type ApprovalStatus,
  type AppRole,
  type Profile,
  type Specialty,
} from "./_shared/types.ts";
import { ProfileRepository } from "./repositories/profileRepository.ts";
import { LocationRepository } from "./repositories/locationRepository.ts";
import { IncidentRepository } from "./repositories/incidentRepository.ts";
import {
  FileRepository,
  type IncidentAttachment,
  type WorkOrderAttachment,
} from "./repositories/fileRepository.ts";
import { NotificationRepository } from "./repositories/notificationRepository.ts";
import { WorkOrderRepository } from "./repositories/workOrderRepository.ts";
import { DashboardRepository } from "./repositories/dashboardRepository.ts";
import { SlaRepository } from "./repositories/slaRepository.ts";
import { PmScheduleRepository } from "./repositories/pmScheduleRepository.ts";
import { RewardRepository } from "./repositories/rewardRepository.ts";
import {
  CampaignRepository,
  type CampaignInput,
} from "./repositories/campaignRepository.ts";
import { validateWorkOrderAction } from "./services/workOrderWorkflowService.ts";
import {
  PmScheduleService,
  parsePmScheduleInput,
} from "./services/pmScheduleService.ts";

async function requireSession(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey)
    throw new HttpError("Server configuration is incomplete.", 500);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new HttpError("Authentication is required.", 401);
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data, error: authError } = await db.auth.getUser(
    authorization.slice("Bearer ".length),
  );
  if (authError || !data.user)
    throw new HttpError("Your session is invalid or has expired.", 401);
  const profiles = new ProfileRepository(db);
  const profile = await profiles.findById(data.user.id);
  if (!profile) throw new HttpError("User profile was not found.", 403);
  return { db, profile, profiles };
}

function requireApproved(profile: Profile) {
  if (!isApproved(profile))
    throw new HttpError("Your account is waiting for approval.", 403);
}

function requireAdmin(profile: Profile) {
  if (!isApproved(profile) || profile.role !== "admin")
    throw new HttpError("Administrator access is required.", 403);
}

function requireDispatcher(profile: Profile) {
  if (
    !isApproved(profile) ||
    (profile.role !== "dispatcher" && profile.role !== "admin")
  )
    throw new HttpError("Dispatcher access is required.", 403);
}

function requirePmViewer(profile: Profile) {
  if (
    !isApproved(profile) ||
    (profile.role !== "technician" && profile.role !== "admin")
  )
    throw new HttpError("PM access is required.", 403);
}

function requireTechnician(profile: Profile) {
  if (!isApproved(profile) || profile.role !== "technician")
    throw new HttpError("Technician access is required.", 403);
}

function locationInput(body: Record<string, unknown> | null) {
  const text = (key: string, required = true) => {
    const value = typeof body?.[key] === "string" ? body[key].trim() : "";
    if ((required && !value) || value.length > 120)
      throw new HttpError("Location data is invalid.");
    return value;
  };
  return {
    building: text("building"),
    floor: text("floor"),
    zone: text("zone"),
    assetName: text("assetName", false) || null,
  };
}

function slaInput(body: Record<string, unknown> | null) {
  const responseMinutes = Number(body?.responseMinutes);
  const resolveMinutes = Number(body?.resolveMinutes);
  if (
    !Number.isInteger(responseMinutes) ||
    !Number.isInteger(resolveMinutes) ||
    responseMinutes < 1 ||
    resolveMinutes < responseMinutes ||
    resolveMinutes > 525_600
  )
    throw new HttpError("SLA duration is invalid.");
  return { responseMinutes, resolveMinutes };
}

function rewardInput(body: Record<string, unknown> | null) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() : "";
  const pointCost = Number(body?.pointCost);
  const stock = Number(body?.stock);
  const isActive = body?.isActive === true;
  const rewardPeriod = body?.rewardPeriod;
  if (
    name.length < 2 ||
    name.length > 200 ||
    description.length < 2 ||
    description.length > 2000
  )
    throw new HttpError("Reward details are invalid.");
  if (!Number.isInteger(pointCost) || pointCost < 1 || pointCost > 1_000_000)
    throw new HttpError("Reward point cost is invalid.");
  if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000)
    throw new HttpError("Reward stock is invalid.");
  if (rewardPeriod !== "standard" && rewardPeriod !== "annual")
    throw new HttpError("Reward period is invalid.");
  return {
    name,
    description,
    pointCost,
    stock,
    isActive,
    rewardPeriod,
  } as const;
}

function campaignInput(body: Record<string, unknown> | null): CampaignInput {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const prizeDescription =
    typeof body?.prizeDescription === "string"
      ? body.prizeDescription.trim()
      : "";
  const periodType = body?.periodType;
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const endDate = typeof body?.endDate === "string" ? body.endDate : "";
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (
    name.length < 2 ||
    name.length > 200 ||
    prizeDescription.length < 2 ||
    prizeDescription.length > 2000
  )
    throw new HttpError("Campaign details are invalid.");
  if (
    periodType !== "monthly" &&
    periodType !== "yearly" &&
    periodType !== "custom"
  )
    throw new HttpError("Campaign period type is invalid.");
  if (!isDate(startDate) || !isDate(endDate) || endDate < startDate)
    throw new HttpError("Campaign dates are invalid.");
  return { name, periodType, startDate, endDate, prizeDescription };
}

const categoryByCode: Record<string, string> = {
  electrical: "ไฟฟ้า",
  plumbing: "ประปา",
  air_conditioning: "เครื่องปรับอากาศ",
  elevator: "ลิฟต์",
  building: "โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  try {
    const { pathname, url } = parsePath(req);
    const { db, profile, profiles } = await requireSession(req);
    const locations = new LocationRepository(db);
    const incidents = new IncidentRepository(db);
    const files = new FileRepository(db);
    const notifications = new NotificationRepository(db);
    const workOrders = new WorkOrderRepository(db);
    const dashboard = new DashboardRepository(db);
    const sla = new SlaRepository(db);
    const pmSchedules = new PmScheduleRepository(db);
    const pmScheduleService = new PmScheduleService(pmSchedules, locations);
    const rewards = new RewardRepository(db);
    const campaigns = new CampaignRepository(db);

    const withRewardImage = async (reward: Record<string, unknown>) => {
      const file = reward.files as Record<string, unknown> | null;
      return {
        ...reward,
        image_url: file
          ? await files.createSignedReadUrl(
              String(file.bucket),
              String(file.object_path),
            )
          : null,
      };
    };

    const historyWithActors = async (incidentId: string) => {
      const history = await workOrders.historyForIncident(incidentId);
      const names = await profiles.namesByIds(
        history.events.flatMap((event) =>
          event.changed_by ? [event.changed_by] : [],
        ),
      );
      const eventIds = history.events.map((event) => event.id);
      const { data: linkedFiles, error: linkedFilesError } = eventIds.length
        ? await db
            .from("work_order_history_files")
            .select(
              "work_order_history_id, files(id, bucket, object_path, file_name, mime_type, size_bytes)",
            )
            .in("work_order_history_id", eventIds)
        : { data: [], error: null };
      if (linkedFilesError) throw linkedFilesError;
      const filesByEvent = new Map<string, Array<Record<string, unknown>>>();
      for (const link of linkedFiles ?? []) {
        const related = link.files as unknown as Record<string, unknown> | null;
        if (!related) continue;
        const current = filesByEvent.get(link.work_order_history_id) ?? [];
        current.push(related);
        filesByEvent.set(link.work_order_history_id, current);
      }
      return {
        workOrder: history.workOrder,
        events: await Promise.all(
          history.events.map(async (event) => ({
            ...event,
            changed_by_name: event.changed_by
              ? (names.get(event.changed_by) ?? "ผู้ใช้งานระบบ")
              : "ระบบ",
            attachments: await Promise.all(
              (filesByEvent.get(event.id) ?? []).map(async (file) => ({
                fileName: String(file.file_name),
                mimeType: String(file.mime_type),
                sizeBytes: Number(file.size_bytes),
                url: await files.createSignedReadUrl(
                  String(file.bucket),
                  String(file.object_path),
                ),
              })),
            ),
          })),
        ),
      };
    };

    if (req.method === "GET" && pathname === "/me")
      return json({ data: profile });

    if (req.method === "GET" && pathname === "/dashboard/summary") {
      requireAdmin(profile);
      const requestedDays = Number(url.searchParams.get("days") ?? "30");
      const days = [30, 90, 180, 365].includes(requestedDays)
        ? requestedDays
        : 30;
      return json({ data: await dashboard.summary(days) });
    }

    if (req.method === "GET" && pathname === "/sla/rules") {
      requireAdmin(profile);
      return json({ data: await sla.listRules() });
    }
    if (req.method === "GET" && pathname === "/sla/summary") {
      requireAdmin(profile);
      return json({ data: await sla.summary() });
    }
    const slaRuleMatch = pathname.match(/^\/sla\/rules\/([0-9a-f-]{36})$/i);
    if (req.method === "PATCH" && slaRuleMatch) {
      requireAdmin(profile);
      const rule = await sla.updateRule(
        slaRuleMatch[1],
        slaInput(await parseJson(req)),
      );
      if (!rule) throw new HttpError("SLA rule was not found.", 404);
      return json({ data: rule });
    }

    if (req.method === "GET" && pathname === "/pm/schedules") {
      requirePmViewer(profile);
      return json({ data: await pmSchedules.listSchedules() });
    }
    if (req.method === "POST" && pathname === "/pm/schedules") {
      requireAdmin(profile);
      return json(
        {
          data: await pmScheduleService.create(
            parsePmScheduleInput(await parseJson(req)),
          ),
        },
        201,
      );
    }
    const pmScheduleMatch = pathname.match(
      /^\/pm\/schedules\/([0-9a-f-]{36})$/i,
    );
    if (req.method === "GET" && pmScheduleMatch) {
      requirePmViewer(profile);
      const schedule = await pmSchedules.findSchedule(pmScheduleMatch[1]);
      if (!schedule) throw new HttpError("PM schedule was not found.", 404);
      return json({
        data: {
          schedule,
          logs: await pmSchedules.listLogs(schedule.id),
        },
      });
    }
    if (req.method === "PATCH" && pmScheduleMatch) {
      requireAdmin(profile);
      const schedule = await pmScheduleService.update(
        pmScheduleMatch[1],
        parsePmScheduleInput(await parseJson(req)),
      );
      if (!schedule) throw new HttpError("PM schedule was not found.", 404);
      return json({ data: schedule });
    }
    const pmCompletionMatch = pathname.match(
      /^\/pm\/schedules\/([0-9a-f-]{36})\/complete$/i,
    );
    if (req.method === "POST" && pmCompletionMatch) {
      requireTechnician(profile);
      const body = await parseJson(req);
      const notes = typeof body?.notes === "string" ? body.notes : "";
      return json({
        data: await pmScheduleService.complete(
          pmCompletionMatch[1],
          profile.id,
          notes,
        ),
      });
    }

    if (req.method === "GET" && pathname === "/rewards/catalog") {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError("Reporter access is required.", 403);
      return json({
        data: await Promise.all(
          (await rewards.listCatalog()).map(withRewardImage),
        ),
      });
    }
    if (req.method === "GET" && pathname === "/rewards/wallet") {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError("Reporter access is required.", 403);
      return json({ data: await rewards.listWallet(profile.id) });
    }
    if (req.method === "POST" && pathname === "/rewards/redemptions") {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError("Reporter access is required.", 403);
      const body = await parseJson(req);
      const rewardItemId =
        typeof body?.rewardItemId === "string" ? body.rewardItemId : "";
      if (!/^[0-9a-f-]{36}$/i.test(rewardItemId))
        throw new HttpError("Reward item is invalid.");
      return json(
        { data: await rewards.redeem(profile.id, rewardItemId) },
        201,
      );
    }
    if (req.method === "GET" && pathname === "/admin/rewards") {
      requireAdmin(profile);
      return json({
        data: await Promise.all(
          (await rewards.listCatalog(true)).map(withRewardImage),
        ),
      });
    }
    if (req.method === "POST" && pathname === "/uploads/reward-images") {
      requireAdmin(profile);
      const body = await parseJson(req);
      try {
        return json({
          data: await files.createRewardImageUpload({
            userId: profile.id,
            fileName: typeof body?.fileName === "string" ? body.fileName : "",
            mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
            sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : 0,
          }),
        });
      } catch (cause) {
        throw new HttpError(
          cause instanceof Error ? cause.message : "Reward image is invalid.",
        );
      }
    }
    if (req.method === "POST" && pathname === "/admin/rewards") {
      requireAdmin(profile);
      const body = await parseJson(req);
      const image = body?.image;
      if (!FileRepository.validateRewardImage(image, profile.id))
        throw new HttpError("Reward image is required.");
      const file = await files.createRewardImageRecord({
        ...image,
        userId: profile.id,
      });
      return json(
        {
          data: await withRewardImage(
            await rewards.create({
              ...rewardInput(body),
              imageFileId: file.id,
            }),
          ),
        },
        201,
      );
    }
    const rewardMatch = pathname.match(/^\/admin\/rewards\/([0-9a-f-]{36})$/i);
    if (req.method === "PATCH" && rewardMatch) {
      requireAdmin(profile);
      const body = await parseJson(req);
      const image = body?.image;
      const imageFileId = FileRepository.validateRewardImage(image, profile.id)
        ? (
            await files.createRewardImageRecord({
              ...image,
              userId: profile.id,
            })
          ).id
        : undefined;
      const reward = await rewards.update(rewardMatch[1], {
        ...rewardInput(body),
        imageFileId,
      });
      if (!reward) throw new HttpError("Reward item was not found.", 404);
      return json({ data: await withRewardImage(reward) });
    }
    if (req.method === "DELETE" && rewardMatch) {
      requireAdmin(profile);
      await rewards.delete(rewardMatch[1]);
      return json({ data: { id: rewardMatch[1] } });
    }

    if (req.method === "GET" && pathname === "/campaigns") {
      requireAdmin(profile);
      return json({ data: await campaigns.list() });
    }
    if (req.method === "POST" && pathname === "/admin/campaigns") {
      requireAdmin(profile);
      return json(
        { data: await campaigns.create(campaignInput(await parseJson(req))) },
        201,
      );
    }
    const campaignLeaderboardMatch = pathname.match(
      /^\/campaigns\/([0-9a-f-]{36})\/leaderboard$/i,
    );
    if (req.method === "GET" && campaignLeaderboardMatch) {
      requireAdmin(profile);
      const campaign = await campaigns.findById(campaignLeaderboardMatch[1]);
      if (!campaign) throw new HttpError("Campaign was not found.", 404);
      const scores = await campaigns.listScores(campaign.id);
      const names = await profiles.namesByIds(
        scores.map((score) => score.user_id),
      );
      return json({
        data: {
          campaign,
          scores: scores.map((score) => ({
            ...score,
            full_name: names.get(score.user_id) ?? "ผู้ใช้งานระบบ",
          })),
        },
      });
    }
    const campaignMatch = pathname.match(
      /^\/admin\/campaigns\/([0-9a-f-]{36})$/i,
    );
    const campaignCloseMatch = pathname.match(
      /^\/admin\/campaigns\/([0-9a-f-]{36})\/close$/i,
    );
    if (req.method === "POST" && campaignCloseMatch) {
      requireAdmin(profile);
      const campaign = await campaigns.close(campaignCloseMatch[1]);
      if (!campaign)
        throw new HttpError(
          "Campaign is already locked or was not found.",
          409,
        );
      return json({ data: campaign });
    }
    if (req.method === "PATCH" && campaignMatch) {
      requireAdmin(profile);
      const campaign = await campaigns.update(
        campaignMatch[1],
        campaignInput(await parseJson(req)),
      );
      if (!campaign)
        throw new HttpError("Only an active campaign can be edited.", 409);
      return json({ data: campaign });
    }

    if (req.method === "GET" && pathname === "/notifications") {
      requireApproved(profile);
      return json({ data: await notifications.listForUser(profile.id) });
    }
    const notificationMatch = pathname.match(
      /^\/notifications\/([0-9a-f-]{36})\/read$/i,
    );
    if (req.method === "PATCH" && notificationMatch) {
      requireApproved(profile);
      const notification = await notifications.markRead(
        notificationMatch[1],
        profile.id,
      );
      if (!notification)
        throw new HttpError("Notification was not found.", 404);
      return json({ data: notification });
    }

    if (req.method === "PATCH" && pathname === "/me/onboarding") {
      const body = await parseJson(req);
      const requestedPosition =
        typeof body?.requestedPosition === "string"
          ? body.requestedPosition.trim()
          : "";
      const specialties = Array.isArray(body?.technicianSpecialties)
        ? body.technicianSpecialties
        : [];
      if (requestedPosition.length < 2 || requestedPosition.length > 120)
        throw new HttpError(
          "Requested position must contain 2–120 characters.",
        );
      if (
        !specialties.every((value: unknown) =>
          allowedSpecialties.has(value as Specialty),
        )
      )
        throw new HttpError("One or more technician specialties are invalid.");
      return json({
        data: await profiles.updateOnboarding(
          profile.id,
          requestedPosition,
          specialties,
        ),
      });
    }

    if (req.method === "GET" && pathname === "/locations") {
      requireApproved(profile);
      return json({ data: await locations.list() });
    }
    if (req.method === "GET" && pathname.startsWith("/locations/code/")) {
      requireApproved(profile);
      const location = await locations.findByCode(
        decodeURIComponent(pathname.slice("/locations/code/".length)),
      );
      if (!location) throw new HttpError("Location was not found.", 404);
      return json({ data: location });
    }

    if (req.method === "POST" && pathname === "/admin/locations") {
      requireAdmin(profile);
      return json(
        { data: await locations.create(locationInput(await parseJson(req))) },
        201,
      );
    }
    const locationMatch = pathname.match(
      /^\/admin\/locations\/([0-9a-f-]{36})$/i,
    );
    if (req.method === "PATCH" && locationMatch) {
      requireAdmin(profile);
      const location = await locations.update(
        locationMatch[1],
        locationInput(await parseJson(req)),
      );
      if (!location) throw new HttpError("Location was not found.", 404);
      return json({ data: location });
    }
    if (req.method === "DELETE" && locationMatch) {
      requireAdmin(profile);
      await locations.delete(locationMatch[1]);
      return json({ data: { id: locationMatch[1] } });
    }

    if (req.method === "POST" && pathname === "/uploads/incident-attachments") {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError(
          "Only approved reporters can upload incident attachments.",
          403,
        );
      const body = await parseJson(req);
      try {
        return json({
          data: await files.createIncidentUpload({
            userId: profile.id,
            fileName: typeof body?.fileName === "string" ? body.fileName : "",
            mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
            sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : 0,
          }),
        });
      } catch (cause) {
        if (cause instanceof Error) throw new HttpError(cause.message);
        throw cause;
      }
    }

    if (
      req.method === "POST" &&
      pathname === "/uploads/work-order-attachments"
    ) {
      if (!isApproved(profile) || profile.role !== "technician")
        throw new HttpError(
          "Only approved technicians can upload work order attachments.",
          403,
        );
      const body = await parseJson(req);
      try {
        return json({
          data: await files.createWorkOrderUpload({
            userId: profile.id,
            fileName: typeof body?.fileName === "string" ? body.fileName : "",
            mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
            sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : 0,
          }),
        });
      } catch (cause) {
        if (cause instanceof Error) throw new HttpError(cause.message);
        throw cause;
      }
    }

    if (req.method === "GET" && pathname === "/incidents/mine") {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError("Reporter access is required.", 403);
      return json({ data: await incidents.listForReporter(profile.id) });
    }
    if (req.method === "GET" && pathname === "/dispatch/incidents") {
      requireDispatcher(profile);
      return json({ data: await incidents.listPendingAssignment() });
    }
    if (req.method === "GET" && pathname === "/dispatch/technicians") {
      requireDispatcher(profile);
      return json({ data: await profiles.listApprovedByRole("technician") });
    }
    if (req.method === "GET" && pathname === "/dispatch/reviews") {
      requireDispatcher(profile);
      return json({
        data: await workOrders.listReviewForActor(
          profile.id,
          profile.role === "admin" ? "admin" : "dispatcher",
        ),
      });
    }
    if (req.method === "POST" && pathname === "/dispatch/work-orders") {
      requireDispatcher(profile);
      const body = await parseJson(req);
      const incidentId =
        typeof body?.incidentId === "string" ? body.incidentId : "";
      const technicianId =
        typeof body?.technicianId === "string" ? body.technicianId : "";
      const incident = await incidents.findForDispatch(incidentId);
      if (!incident)
        throw new HttpError("Incident is not available for assignment.", 404);
      const technician = await profiles.findById(technicianId);
      if (
        !technician ||
        !isApproved(technician) ||
        technician.role !== "technician"
      )
        throw new HttpError("Technician was not found.", 404);
      const sla = await workOrders.getSlaRule(incident.urgency_reported);
      if (!sla) throw new HttpError("SLA rule was not configured.", 409);
      return json(
        {
          data: await workOrders.create({
            incidentId,
            technicianId,
            assignedBy: profile.id,
            incidentCreatedAt: incident.created_at,
            responseMinutes: sla.response_minutes,
            resolveMinutes: sla.resolve_minutes,
          }),
        },
        201,
      );
    }
    if (req.method === "GET" && pathname === "/work-orders/mine") {
      if (!isApproved(profile) || profile.role !== "technician")
        throw new HttpError("Technician access is required.", 403);
      return json({ data: await workOrders.listForTechnician(profile.id) });
    }
    const workOrderDetailMatch = pathname.match(
      /^\/work-orders\/([0-9a-f-]{36})$/i,
    );
    if (req.method === "GET" && workOrderDetailMatch) {
      if (
        !isApproved(profile) ||
        !["technician", "dispatcher", "admin"].includes(profile.role ?? "")
      )
        throw new HttpError("Work order access is required.", 403);
      const actorRole = profile.role as "technician" | "dispatcher" | "admin";
      const workOrder = await workOrders.getByIdForActor(
        workOrderDetailMatch[1],
        profile.id,
        actorRole,
      );
      if (!workOrder) throw new HttpError("Work order was not found.", 404);
      return json({
        data: {
          ...(await historyWithActors(workOrder.incident_id)),
          workOrder,
        },
      });
    }
    const workOrderActionMatch = pathname.match(
      /^\/work-orders\/([0-9a-f-]{36})\/actions$/i,
    );
    if (req.method === "POST" && workOrderActionMatch) {
      const body = await parseJson(req);
      const actorRole =
        profile.role === "technician" ||
        profile.role === "dispatcher" ||
        profile.role === "admin"
          ? profile.role
          : null;
      if (!isApproved(profile) || !actorRole)
        throw new HttpError("Work order access is required.", 403);
      const workOrder = await workOrders.getForAction(
        workOrderActionMatch[1],
        profile.id,
        actorRole,
      );
      if (!workOrder) throw new HttpError("Work order was not found.", 404);
      const action = validateWorkOrderAction({
        action: body?.action,
        actorRole: actorRole === "technician" ? "technician" : "dispatcher",
        currentStatus: workOrder.status,
        note: body?.note,
      });
      const attachments = Array.isArray(body?.attachments)
        ? body.attachments
        : [];
      if (
        attachments.length > 3 ||
        !attachments.every((file: unknown) =>
          FileRepository.validateWorkOrderAttachment(file, profile.id),
        )
      )
        throw new HttpError("Work order attachments are invalid.");
      if (
        attachments.length &&
        !["request_parts", "submit_repair"].includes(action.action)
      )
        throw new HttpError(
          "Attachments are only accepted with a parts request or repair submission.",
        );
      const result = await workOrders.applyAction(workOrder.id, {
        status: action.transition.to,
        actorId: profile.id,
        note: action.note,
        eventType: action.transition.eventType,
        incidentStatus: action.transition.incidentStatus,
        attachments: attachments as WorkOrderAttachment[],
      });
      return json({ data: result });
    }
    const incidentMatch = pathname.match(/^\/incidents\/([0-9a-f-]{36})$/i);
    const incidentHistoryMatch = pathname.match(
      /^\/incidents\/([0-9a-f-]{36})\/history$/i,
    );
    if (req.method === "GET" && incidentHistoryMatch) {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError("Reporter access is required.", 403);
      const incident = await incidents.findForReporter(
        incidentHistoryMatch[1],
        profile.id,
      );
      if (!incident) throw new HttpError("Incident was not found.", 404);
      return json({ data: await historyWithActors(incidentHistoryMatch[1]) });
    }
    if (req.method === "GET" && incidentMatch) {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError("Reporter access is required.", 403);
      const detail = await incidents.findForReporter(
        incidentMatch[1],
        profile.id,
      );
      if (!detail) throw new HttpError("Incident was not found.", 404);
      const linkedFiles = (
        detail.fileLinks as unknown as Array<{
          files:
            | {
                bucket: string;
                object_path: string;
                file_name: string;
                mime_type: string;
                size_bytes: number;
              }
            | Array<{
                bucket: string;
                object_path: string;
                file_name: string;
                mime_type: string;
                size_bytes: number;
              }>
            | null;
        }>
      ).flatMap((link) =>
        !link.files
          ? []
          : Array.isArray(link.files)
            ? link.files
            : [link.files],
      );
      const attachments = await Promise.all(
        linkedFiles.map(async (file) => ({
          fileName: file.file_name,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
          url: await files.createSignedReadUrl(file.bucket, file.object_path),
        })),
      );
      return json({ data: { ...detail.incident, attachments } });
    }
    if (req.method === "POST" && pathname === "/incidents") {
      if (!isApproved(profile) || profile.role !== "reporter")
        throw new HttpError(
          "Only approved reporters can create an incident.",
          403,
        );
      const body = await parseJson(req);
      const locationId =
        typeof body?.locationId === "string" ? body.locationId : "";
      const categoryInput =
        typeof body?.category === "string" ? body.category.trim() : "";
      const category =
        categoryByCode[categoryInput] ??
        (allowedCategories.has(categoryInput) ? categoryInput : "");
      const urgencyReported =
        typeof body?.urgencyReported === "string" ? body.urgencyReported : "";
      const description =
        typeof body?.description === "string" ? body.description.trim() : "";
      const assetName =
        typeof body?.assetName === "string"
          ? body.assetName.trim() || null
          : null;
      const attachments: unknown[] = Array.isArray(body?.attachments)
        ? body.attachments
        : [];
      const invalidFields: string[] = [];
      if (!/^[0-9a-f-]{36}$/i.test(locationId))
        invalidFields.push("ตำแหน่งจาก QR Code");
      if (!allowedCategories.has(category)) invalidFields.push("ประเภทปัญหา");
      if (!["critical", "urgent", "normal"].includes(urgencyReported))
        invalidFields.push("ระดับความเร่งด่วน");
      if (description.length < 5 || description.length > 4000)
        invalidFields.push("รายละเอียดปัญหา");
      if (invalidFields.length) {
        console.warn("Incident validation failed", {
          invalidFields,
          hasLocationId: Boolean(locationId),
          category: categoryInput,
          urgencyReported,
          descriptionLength: description.length,
        });
        throw new HttpError(
          `ข้อมูลแจ้งปัญหาไม่ถูกต้อง: ${invalidFields.join(", ")}`,
        );
      }
      if (
        attachments.length > 3 ||
        !attachments.every((file: unknown) =>
          FileRepository.validateIncidentAttachment(file, profile.id),
        )
      )
        throw new HttpError("Incident attachments are invalid.");
      const location = await locations.findById(locationId);
      if (!location) throw new HttpError("Location was not found.", 404);
      return json(
        {
          data: await incidents.create({
            locationId,
            locationLabel: `${location.building} · ${location.floor} · ${location.zone}`,
            assetName,
            category,
            urgencyReported,
            description,
            reporterId: profile.id,
            attachments: attachments as IncidentAttachment[],
          }),
        },
        201,
      );
    }

    if (req.method === "GET" && pathname === "/admin/users") {
      requireAdmin(profile);
      const requestedStatus = url.searchParams.get("approvalStatus");
      const approvalStatus = ["pending", "approved", "rejected"].includes(
        requestedStatus ?? "",
      )
        ? (requestedStatus as ApprovalStatus)
        : null;
      return json({ data: await profiles.list(approvalStatus) });
    }
    const approvalMatch = pathname.match(
      /^\/admin\/users\/([0-9a-f-]{36})\/approval$/i,
    );
    if (req.method === "PATCH" && approvalMatch) {
      requireAdmin(profile);
      const body = await parseJson(req);
      const approvalStatus = body?.approvalStatus;
      const role = body?.role;
      const specialties = Array.isArray(body?.technicianSpecialties)
        ? body.technicianSpecialties
        : [];
      const note =
        typeof body?.note === "string" ? body.note.trim() || null : null;
      if (
        !(["pending", "approved", "rejected"] as string[]).includes(
          approvalStatus,
        )
      )
        throw new HttpError("Approval status is invalid.");
      if (approvalMatch[1] === profile.id)
        throw new HttpError("You cannot change your own access.", 409);
      if (approvalStatus === "approved" && !allowedRoles.has(role as AppRole))
        throw new HttpError("A valid role is required for approval.");
      if (
        !specialties.every((value: unknown) =>
          allowedSpecialties.has(value as Specialty),
        )
      )
        throw new HttpError("One or more technician specialties are invalid.");
      const actualRole =
        approvalStatus === "approved" ? (role as AppRole) : null;
      return json({
        data: await profiles.setApproval({
          id: approvalMatch[1],
          approvalStatus,
          role: actualRole,
          specialties,
          actedBy: profile.id,
          note,
        }),
      });
    }

    return error("Endpoint was not found.", 404);
  } catch (cause) {
    if (cause instanceof HttpError) return error(cause.message, cause.status);
    console.error(cause);
    return error("The request could not be completed.", 500);
  }
});

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
import { FileRepository, type IncidentAttachment } from "./repositories/fileRepository.ts";

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

function locationInput(body: Record<string, unknown> | null) {
  const text = (key: string, required = true) => {
    const value = typeof body?.[key] === "string" ? body[key].trim() : "";
    if ((required && !value) || value.length > 120)
      throw new HttpError("Location data is invalid.");
    return value;
  };
  const code = text("code").toUpperCase();
  if (!/^BLD-[A-Z0-9]+-F[A-Z0-9]+-Z[A-Z0-9]+$/.test(code))
    throw new HttpError("Location code format is invalid.");
  return {
    code,
    building: text("building"),
    floor: text("floor"),
    zone: text("zone"),
    assetName: text("assetName", false) || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  try {
    const { pathname, url } = parsePath(req);
    const { db, profile, profiles } = await requireSession(req);
    const locations = new LocationRepository(db);
    const incidents = new IncidentRepository(db);
    const files = new FileRepository(db);

    if (req.method === "GET" && pathname === "/me")
      return json({ data: profile });

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
      return json({ data: await locations.create(locationInput(await parseJson(req))) }, 201);
    }
    const locationMatch = pathname.match(/^\/admin\/locations\/([0-9a-f-]{36})$/i);
    if (req.method === "PATCH" && locationMatch) {
      requireAdmin(profile);
      const location = await locations.update(locationMatch[1], locationInput(await parseJson(req)));
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
        throw new HttpError("Only approved reporters can upload incident attachments.", 403);
      const body = await parseJson(req);
      try {
        return json({ data: await files.createIncidentUpload({
          userId: profile.id,
          fileName: typeof body?.fileName === "string" ? body.fileName : "",
          mimeType: typeof body?.mimeType === "string" ? body.mimeType : "",
          sizeBytes: typeof body?.sizeBytes === "number" ? body.sizeBytes : 0,
        }) });
      } catch (cause) {
        if (cause instanceof Error) throw new HttpError(cause.message);
        throw cause;
      }
    }

    if (req.method === "GET" && pathname === "/incidents/mine") {
      requireApproved(profile);
      return json({ data: await incidents.listForReporter(profile.id) });
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
      const category = typeof body?.category === "string" ? body.category : "";
      const urgencyReported =
        typeof body?.urgencyReported === "string" ? body.urgencyReported : "";
      const description =
        typeof body?.description === "string" ? body.description.trim() : "";
      const assetName =
        typeof body?.assetName === "string"
          ? body.assetName.trim() || null
          : null;
      const attachments: unknown[] = Array.isArray(body?.attachments) ? body.attachments : [];
      if (
        !locationId ||
        !allowedCategories.has(category) ||
        !["critical", "urgent", "normal"].includes(urgencyReported) ||
        description.length < 5 ||
        description.length > 4000
      )
        throw new HttpError("Incident data is invalid.");
      if (attachments.length > 3 || !attachments.every((file: unknown) => FileRepository.validateIncidentAttachment(file, profile.id)))
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
      if (!(["approved", "rejected"] as string[]).includes(approvalStatus))
        throw new HttpError("Approval status is invalid.");
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

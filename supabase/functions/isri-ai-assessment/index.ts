import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AiAssessmentUnavailableError,
  analyzeIncidentWithGemini,
} from "./service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const assessmentColumns =
  "id, incident_id, requested_by, provider, model, model_response_id, prompt_version, summary, category_suggested, suggested_urgency, confidence, detected_hazards, evidence, missing_information, rule_reasons, needs_human_review, input_attachment_count, latency_ms, usage, created_at";

function incidentIdFrom(req: Request) {
  const value = new URL(req.url).searchParams.get("incidentId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError("Incident ID is invalid.");
  }
  return value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      throw new HttpError("Method is not allowed.", 405);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new HttpError("Server configuration is incomplete.", 500);
    }
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new HttpError("Authentication is required.", 401);
    }
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await db.auth.getUser(
      authorization.slice("Bearer ".length),
    );
    if (authError || !authData.user) {
      throw new HttpError("Your session is invalid or has expired.", 401);
    }
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, role, approval_status")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (
      !profile ||
      profile.approval_status !== "approved" ||
      profile.role !== "dispatcher"
    ) {
      throw new HttpError("Dispatcher access is required.", 403);
    }

    const incidentId = incidentIdFrom(req);
    const { data: incident, error: incidentError } = await db
      .from("incidents")
      .select(
        "id, ticket_number, location_label, asset_name, category, description, status",
      )
      .eq("id", incidentId)
      .eq("status", "pending_assignment")
      .maybeSingle();
    if (incidentError) throw incidentError;
    if (!incident) throw new HttpError("Incident was not found.", 404);

    if (req.method === "GET") {
      const { data, error } = await db
        .from("ai_incident_assessments")
        .select(assessmentColumns)
        .eq("incident_id", incidentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return json({
        data,
        meta: { configured: Boolean(Deno.env.get("GEMINI_API_KEY")) },
      });
    }

    const { data: fileLinks, error: fileLinksError } = await db
      .from("incident_files")
      .select("files(bucket, object_path)")
      .eq("incident_id", incidentId);
    if (fileLinksError) throw fileLinksError;
    const linkedFiles = (
      (fileLinks ?? []) as unknown as Array<{
        files:
          | { bucket: string; object_path: string }
          | Array<{ bucket: string; object_path: string }>
          | null;
      }>
    ).flatMap((link) =>
      !link.files ? [] : Array.isArray(link.files) ? link.files : [link.files]
    );
    const imageUrls = await Promise.all(
      linkedFiles.slice(0, 3).map(async (file) => {
        const { data, error } = await db.storage
          .from(file.bucket)
          .createSignedUrl(file.object_path, 300);
        if (error) throw error;
        return data.signedUrl;
      }),
    );
    const result = await analyzeIncidentWithGemini({
      ticketNumber: incident.ticket_number,
      locationLabel: incident.location_label,
      assetName: incident.asset_name,
      categoryReported: incident.category,
      description: incident.description,
      imageUrls,
    });
    const { data, error } = await db
      .from("ai_incident_assessments")
      .insert({
        incident_id: incidentId,
        requested_by: profile.id,
        provider: result.provider,
        model: result.model,
        model_response_id: result.modelResponseId,
        prompt_version: result.promptVersion,
        summary: result.summary,
        category_suggested: result.categorySuggested,
        suggested_urgency: result.suggestedUrgency,
        confidence: result.confidence,
        detected_hazards: result.detectedHazards,
        evidence: result.evidence,
        missing_information: result.missingInformation,
        rule_reasons: result.ruleReasons,
        needs_human_review: result.needsHumanReview,
        input_attachment_count: result.inputAttachmentCount,
        latency_ms: result.latencyMs,
        usage: result.usage,
      })
      .select(assessmentColumns)
      .single();
    if (error) throw error;
    return json({ data }, 201);
  } catch (cause) {
    if (cause instanceof AiAssessmentUnavailableError) {
      return json({ error: cause.message }, cause.status);
    }
    if (cause instanceof HttpError) {
      return json({ error: cause.message }, cause.status);
    }
    console.error(cause);
    return json({ error: "The request could not be completed." }, 500);
  }
});

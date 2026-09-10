// @ts-ignore - Supabase Edge runtime provides this module.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { EmailOutboxRepository } from "../isri-api/repositories/emailOutboxRepository.ts";
import { PmReminderService } from "../isri-api/services/pmReminderService.ts";
import { WorkflowEmailService } from "../isri-api/services/workflowEmailService.ts";

serve(async (req: Request) => {
  try {
    const authorization = req.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    let callerRole = "";
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
      callerRole = JSON.parse(atob(padded)).role ?? "";
    } catch {
      callerRole = "";
    }
    // The Edge gateway verifies the JWT before the handler runs. Only the
    // server-side service role may run this privileged scheduled task.
    if (callerRole !== "service_role") {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response("Supabase configuration is incomplete", {
        status: 500,
      });
    }

    const db = createClient(supabaseUrl, serviceRoleKey);
    const outbox = new EmailOutboxRepository(db);
    const workflowEmails = new WorkflowEmailService(outbox);
    const reminders = new PmReminderService(outbox, db, workflowEmails);
    const [dueSoonRecipients, overdueRecipients] = await Promise.all([
      reminders.checkPmDueSoon(7),
      reminders.checkPmOverdue(),
    ]);
    const retryDelivery = await workflowEmails.deliverPending(25);

    return Response.json({
      success: true,
      dueSoonRecipients,
      overdueRecipients,
      retryDelivery,
    });
  } catch (error) {
    console.error("PM reminder cron error", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
});

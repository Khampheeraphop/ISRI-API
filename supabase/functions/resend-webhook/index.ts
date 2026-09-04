// @ts-ignore - Deno types not available in this environment
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Supabase types not available in this environment
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// @ts-ignore
const Deno = globalThis.Deno || {
  env: {
    get: (key: string) => (globalThis as any)[key] || null,
  },
};

serve(async (req: Request) => {
  try {
    // Verify webhook authorization
    const authHeader = req.headers.get("authorization");
    const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");

    if (!webhookSecret) {
      console.error("RESEND_WEBHOOK_SECRET not configured");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    if (authHeader !== `Bearer ${webhookSecret}`) {
      console.error("Unauthorized webhook request");
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse webhook payload
    const payload = await req.json();
    console.log("Received Resend webhook:", JSON.stringify(payload));

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let processedCount = 0;
    let errorCount = 0;

    // Process webhook events
    const events = Array.isArray(payload) ? payload : payload.data || [];

    for (const event of events) {
      try {
        const { type, created_at, email, id: providerMessageId } = event;

        // Find the corresponding email outbox entry
        const { data: outboxEntry, error: findError } = await supabase
          .from("email_outbox")
          .select("*")
          .eq("provider_message_id", providerMessageId)
          .maybeSingle();

        if (findError) {
          console.error("Error finding outbox entry:", findError);
          errorCount++;
          continue;
        }

        if (!outboxEntry) {
          console.log(
            "No outbox entry found for provider message:",
            providerMessageId,
          );
          continue;
        }

        // Update email status based on webhook event
        let updateData: any = {};

        if (type === "email.delivered") {
          updateData = {
            status: "delivered",
            delivered_at: created_at,
          };
        } else if (type === "email.bounced") {
          updateData = {
            status: "bounced",
            bounced_at: created_at,
            bounce_reason: event.reason || "Unknown bounce reason",
            last_error: `Bounced: ${event.reason || "Unknown"}`,
          };
        } else if (type === "email.complained") {
          updateData = {
            status: "complained",
            complaint_type: event.type || "spam",
            last_error: `Complaint: ${event.type || "spam"}`,
          };
        } else {
          console.log("Unhandled event type:", type);
          continue;
        }

        const { error: updateError } = await supabase
          .from("email_outbox")
          .update(updateData)
          .eq("id", outboxEntry.id);

        if (updateError) {
          console.error("Error updating outbox entry:", updateError);
          errorCount++;
        } else {
          processedCount++;
          console.log(`Updated email ${outboxEntry.id} to status: ${type}`);
        }
      } catch (eventError) {
        console.error("Error processing webhook event:", eventError);
        errorCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        errors: errorCount,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Webhook handler error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});

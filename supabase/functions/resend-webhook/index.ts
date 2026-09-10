// @ts-ignore - Supabase Edge runtime provides this module.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const textEncoder = new TextEncoder();

function decodeBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

async function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  webhookSecret: string,
) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60
  ) {
    return false;
  }

  try {
    const secret = webhookSecret.startsWith("whsec_")
      ? webhookSecret.slice("whsec_".length)
      : webhookSecret;
    const key = await crypto.subtle.importKey(
      "raw",
      decodeBase64(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        textEncoder.encode(`${id}.${timestamp}.${rawBody}`),
      ),
    );
    return signatureHeader.split(" ").some((candidate) => {
      const [version, encoded] = candidate.split(",", 2);
      if (version !== "v1" || !encoded) return false;
      try {
        return sameBytes(expected, decodeBase64(encoded));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET")?.trim();
    if (!webhookSecret) {
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const rawBody = await req.text();
    if (!(await verifySvixSignature(rawBody, req.headers, webhookSecret))) {
      return new Response("Invalid webhook signature", { status: 401 });
    }

    const event = JSON.parse(rawBody) as {
      type?: string;
      created_at?: string;
      data?: { email_id?: string; bounce?: { message?: string } };
    };
    const providerMessageId = event.data?.email_id;
    if (!providerMessageId) {
      return Response.json({ success: true, processed: 0 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response("Supabase configuration is incomplete", {
        status: 500,
      });
    }
    const db = createClient(supabaseUrl, serviceRoleKey);
    const eventAt = event.created_at ?? new Date().toISOString();
    const update =
      event.type === "email.delivered"
        ? { status: "delivered", delivered_at: eventAt, last_error: null }
        : event.type === "email.bounced"
          ? {
              status: "bounced",
              bounced_at: eventAt,
              bounce_reason: event.data?.bounce?.message ?? "Email bounced",
              last_error: event.data?.bounce?.message ?? "Email bounced",
            }
          : event.type === "email.complained"
            ? {
                status: "complained",
                complaint_type: "spam",
                last_error: "Recipient marked the email as spam",
              }
            : null;

    if (!update) return Response.json({ success: true, processed: 0 });
    const { error } = await db
      .from("email_outbox")
      .update(update)
      .eq("provider_message_id", providerMessageId);
    if (error) throw error;
    return Response.json({ success: true, processed: 1 });
  } catch (error) {
    console.error("Resend webhook processing failed", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
});

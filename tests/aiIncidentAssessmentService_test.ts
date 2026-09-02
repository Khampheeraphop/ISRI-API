import { assertEquals } from "jsr:@std/assert";
import { deriveSuggestedUrgency } from "../supabase/functions/isri-ai-assessment/service.ts";

Deno.test("critical hazard rules take precedence", () => {
  assertEquals(
    deriveSuggestedUrgency(
      ["active_major_leak", "water_near_electrical"],
      false,
    ).suggestedUrgency,
    "critical",
  );
});

Deno.test("urgent facility hazards suggest urgent", () => {
  assertEquals(
    deriveSuggestedUrgency(["blocked_egress"], false).suggestedUrgency,
    "urgent",
  );
});

Deno.test("unclear observations are routed to human review", () => {
  assertEquals(
    deriveSuggestedUrgency(["unclear"], true).suggestedUrgency,
    null,
  );
});

Deno.test("no safety red flags suggest normal", () => {
  assertEquals(
    deriveSuggestedUrgency(["visible_damage"], false).suggestedUrgency,
    "normal",
  );
});

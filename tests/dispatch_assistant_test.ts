import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { HttpError } from "../supabase/functions/isri-api/_shared/http.ts";
import {
  assessDispatchIncident,
  parseDispatchAdviceRequest,
} from "../supabase/functions/isri-chat/dispatchAssistant.ts";

const incidentId = "10000000-0000-4000-8000-000000000001";
const technicianId = "20000000-0000-4000-8000-000000000002";
const evidence = {
  incident: {
    id: incidentId,
    ticket_number: "ISRI-TEST-1",
    location_id: "30000000-0000-4000-8000-000000000003",
    location_label: "อาคาร 1 ห้องฉุกเฉิน",
    asset_name: "ตู้ไฟ",
    category: "ไฟฟ้า",
    other_category: null,
    urgency_reported: "normal",
    description: "ไฟดับทั้งห้อง",
    created_at: "2026-10-01T01:00:00.000Z",
  },
  related: [],
  candidates: [{
    id: technicianId,
    full_name: "ช่างทดสอบ",
    technician_specialties: ["electrical" as const],
    candidateKey: "candidate-1",
    activeWorkOrders: 1,
  }],
  requiredSpecialty: "electrical" as const,
};

Deno.test("dispatch advice request accepts only action and incident id", () => {
  assertEquals(
    parseDispatchAdviceRequest({
      action: "dispatch_assessment",
      incidentId,
    }),
    incidentId,
  );
  for (
    const invalid of [
      { action: "dispatch_assessment", incidentId: "bad" },
      { action: "dispatch_assessment", incidentId, role: "admin" },
    ]
  ) {
    assertThrows(() => parseDispatchAdviceRequest(invalid), HttpError);
  }
});

Deno.test("dispatch advice maps opaque candidate keys back to authorized technicians", async () => {
  let modelInput: Record<string, unknown> | undefined;
  const result = await assessDispatchIncident({
    evidence,
    now: new Date("2026-10-01T02:00:00.000Z"),
    generate: async (_system, input) => {
      modelInput = input as Record<string, unknown>;
      return {
        summary: "ระบบไฟฟ้าห้องฉุกเฉินหยุดทำงาน",
        recommendedUrgency: "critical",
        confidence: "high",
        urgencyReasons: ["กระทบบริการสำคัญ"],
        missingInformation: ["ขอบเขตไฟดับ"],
        repeatInsight: "ไม่พบเหตุซ้ำ",
        technicianRecommendations: [{
          candidateKey: "candidate-1",
          reason: "ตรงความเชี่ยวชาญและมีงานค้างน้อย",
        }],
      };
    },
  });
  assertEquals(result.recommendedUrgency, "critical");
  assertEquals(result.technicianRecommendations[0].technicianId, technicianId);
  assertEquals(result.technicianRecommendations[0].fullName, "ช่างทดสอบ");
  const serializedInput = JSON.stringify(modelInput);
  assertEquals(serializedInput.includes(technicianId), false);
  assertEquals(serializedInput.includes("ช่างทดสอบ"), false);
});

Deno.test("dispatch advice drops invented technician keys and rejects malformed output", async () => {
  const result = await assessDispatchIncident({
    evidence,
    generate: async () => ({
      summary: "สรุปเหตุ",
      recommendedUrgency: "urgent",
      confidence: "medium",
      urgencyReasons: [],
      missingInformation: [],
      repeatInsight: "",
      technicianRecommendations: [{
        candidateKey: "invented",
        reason: "ไม่ควรถูกใช้",
      }],
    }),
  });
  assertEquals(result.technicianRecommendations, []);
  await assertRejects(
    () =>
      assessDispatchIncident({
        evidence,
        generate: async () => ({
          summary: "สรุปเหตุ",
          recommendedUrgency: "extreme",
          confidence: "high",
          urgencyReasons: [],
          missingInformation: [],
          repeatInsight: "",
          technicianRecommendations: [],
        }),
      }),
    HttpError,
  );
});

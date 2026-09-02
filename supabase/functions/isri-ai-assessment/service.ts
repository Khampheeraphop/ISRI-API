export const aiAssessmentPromptVersion = "isri-hazard-v1";

export const aiHazardCodes = [
  "smoke_or_fire",
  "electrical_sparking",
  "water_near_electrical",
  "structural_fall_or_collapse",
  "trapped_person_elevator",
  "active_major_leak",
  "blocked_egress",
  "critical_area_service_disruption",
  "visible_damage",
  "unclear",
  "none",
] as const;

export type AiHazardCode = (typeof aiHazardCodes)[number];
export type SuggestedUrgency = "critical" | "urgent" | "normal" | null;

const categories = [
  "ไฟฟ้า",
  "ประปา",
  "เครื่องปรับอากาศ",
  "ลิฟต์",
  "โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)",
  "อื่น ๆ",
] as const;

type AiObservation = {
  summary: string;
  categorySuggested: (typeof categories)[number];
  detectedHazards: AiHazardCode[];
  evidence: string[];
  missingInformation: string[];
  confidence: number;
  needsHumanReview: boolean;
};

export type AiIncidentAssessmentResult = AiObservation & {
  provider: "openai";
  model: string;
  modelResponseId: string | null;
  promptVersion: string;
  suggestedUrgency: SuggestedUrgency;
  ruleReasons: string[];
  inputAttachmentCount: number;
  latencyMs: number;
  usage: Record<string, unknown>;
};

export class AiAssessmentUnavailableError extends Error {
  readonly status = 503;
}

const criticalHazards = new Set<AiHazardCode>([
  "smoke_or_fire",
  "electrical_sparking",
  "water_near_electrical",
  "structural_fall_or_collapse",
  "trapped_person_elevator",
]);

const urgentHazards = new Set<AiHazardCode>([
  "active_major_leak",
  "blocked_egress",
  "critical_area_service_disruption",
]);

const hazardLabels: Record<AiHazardCode, string> = {
  smoke_or_fire: "พบสัญญาณควันหรือไฟไหม้",
  electrical_sparking: "พบสัญญาณประกายไฟหรือไฟฟ้าลัดวงจร",
  water_near_electrical: "พบน้ำอยู่ใกล้อุปกรณ์ไฟฟ้า",
  structural_fall_or_collapse: "พบความเสี่ยงชิ้นส่วนอาคารหล่นหรือพังถล่ม",
  trapped_person_elevator: "อาจมีบุคคลติดอยู่ในลิฟต์",
  active_major_leak: "พบการรั่วไหลปริมาณมากหรือยังดำเนินต่อเนื่อง",
  blocked_egress: "เส้นทางสัญจรหรือทางออกถูกกีดขวาง",
  critical_area_service_disruption: "ระบบอาคารขัดข้องในพื้นที่สำคัญ",
  visible_damage: "พบความเสียหายที่มองเห็นได้",
  unclear: "ข้อมูลไม่ชัดเจนเพียงพอ",
  none: "ไม่พบสัญญาณอันตรายตามเกณฑ์",
};

export function deriveSuggestedUrgency(
  hazards: readonly AiHazardCode[],
  needsHumanReview: boolean,
): { suggestedUrgency: SuggestedUrgency; ruleReasons: string[] } {
  const uniqueHazards = [...new Set(hazards)];
  const criticalMatches = uniqueHazards.filter((hazard) =>
    criticalHazards.has(hazard)
  );
  if (criticalMatches.length) {
    return {
      suggestedUrgency: "critical",
      ruleReasons: criticalMatches.map((hazard) => hazardLabels[hazard]),
    };
  }

  const urgentMatches = uniqueHazards.filter((hazard) =>
    urgentHazards.has(hazard)
  );
  if (urgentMatches.length) {
    return {
      suggestedUrgency: "urgent",
      ruleReasons: urgentMatches.map((hazard) => hazardLabels[hazard]),
    };
  }

  if (needsHumanReview || uniqueHazards.includes("unclear")) {
    return {
      suggestedUrgency: null,
      ruleReasons: ["ข้อมูลยังไม่เพียงพอ ให้ผู้จัดสรรงานตรวจสอบก่อนกำหนด SLA"],
    };
  }

  return {
    suggestedUrgency: "normal",
    ruleReasons: ["ไม่พบสัญญาณอันตรายที่เข้าเกณฑ์วิกฤตหรือเร่งด่วน"],
  };
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "categorySuggested",
    "detectedHazards",
    "evidence",
    "missingInformation",
    "confidence",
    "needsHumanReview",
  ],
  properties: {
    summary: { type: "string" },
    categorySuggested: { type: "string", enum: categories },
    detectedHazards: {
      type: "array",
      items: { type: "string", enum: aiHazardCodes },
    },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
    missingInformation: {
      type: "array",
      items: { type: "string" },
    },
    confidence: { type: "number" },
    needsHumanReview: { type: "boolean" },
  },
} as const;

function assertObservation(value: unknown): AiObservation {
  if (!value || typeof value !== "object") {
    throw new AiAssessmentUnavailableError("AI ส่งผลวิเคราะห์ที่ไม่สมบูรณ์");
  }
  const observation = value as Record<string, unknown>;
  const detectedHazards = Array.isArray(observation.detectedHazards)
    ? observation.detectedHazards
    : [];
  const evidence = Array.isArray(observation.evidence)
    ? observation.evidence
    : [];
  const missingInformation = Array.isArray(observation.missingInformation)
    ? observation.missingInformation
    : [];
  const summary = typeof observation.summary === "string"
    ? observation.summary.trim()
    : "";
  if (
    !summary ||
    !categories.includes(
      observation.categorySuggested as (typeof categories)[number],
    ) ||
    !detectedHazards.every((hazard) =>
      aiHazardCodes.includes(hazard as AiHazardCode)
    ) ||
    !evidence.every((item) => typeof item === "string") ||
    !missingInformation.every((item) => typeof item === "string") ||
    typeof observation.confidence !== "number" ||
    observation.confidence < 0 ||
    observation.confidence > 1 ||
    typeof observation.needsHumanReview !== "boolean"
  ) {
    throw new AiAssessmentUnavailableError("AI ส่งผลวิเคราะห์ที่ไม่สมบูรณ์");
  }
  return {
    summary: summary.slice(0, 1000),
    categorySuggested: observation
      .categorySuggested as AiObservation["categorySuggested"],
    detectedHazards: [...new Set(detectedHazards as AiHazardCode[])].slice(
      0,
      12,
    ),
    evidence: (evidence as string[])
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
    missingInformation: (missingInformation as string[])
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6),
    confidence: Math.round(observation.confidence * 1000) / 1000,
    needsHumanReview: observation.needsHumanReview,
  };
}

function responseOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

export async function analyzeIncidentWithOpenAI(input: {
  ticketNumber: string;
  locationLabel: string;
  assetName: string | null;
  categoryReported: string;
  description: string;
  imageUrls: string[];
}): Promise<AiIncidentAssessmentResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    throw new AiAssessmentUnavailableError(
      "ยังไม่ได้ตั้งค่า OPENAI_API_KEY สำหรับฟีเจอร์ AI",
    );
  }
  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-5.6-luna";
  const startedAt = performance.now();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: [
        "คุณคือผู้ช่วยคัดกรองเหตุแจ้งซ่อมระบบวิศวกรรมอาคารในสถานพยาบาล",
        "แยกเฉพาะข้อเท็จจริงที่เห็นจากภาพหรือข้อความ ห้ามแต่งข้อมูลที่ไม่มีหลักฐาน",
        "ห้ามตัดสิน SLA ขั้นสุดท้ายและห้ามให้คำวินิจฉัยทางการแพทย์",
        "ถ้าภาพไม่ชัด ข้อมูลขัดแย้ง หรือข้อมูลไม่พอ ให้ใช้ hazard unclear และ needsHumanReview=true",
        "ไม่ต้องระบุชื่อหรือคุณลักษณะของบุคคลที่อาจปรากฏในภาพ",
        "ตอบภาษาไทยแบบกระชับตาม JSON schema เท่านั้น",
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                ticketNumber: input.ticketNumber,
                location: input.locationLabel,
                assetName: input.assetName,
                categoryReported: input.categoryReported,
                description: input.description,
              }),
            },
            ...input.imageUrls.slice(0, 3).map((imageUrl) => ({
              type: "input_image",
              image_url: imageUrl,
              detail: "low",
            })),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "isri_incident_observation",
          strict: true,
          schema: responseSchema,
        },
      },
      max_output_tokens: 1200,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    console.error("OpenAI assessment request failed", {
      status: response.status,
      error: payload.error,
    });
    throw new AiAssessmentUnavailableError(
      "บริการ AI ยังไม่พร้อม กรุณาลองใหม่ภายหลัง",
    );
  }
  const outputText = responseOutputText(payload);
  if (!outputText) {
    throw new AiAssessmentUnavailableError("AI ไม่ได้ส่งผลวิเคราะห์กลับมา");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new AiAssessmentUnavailableError("AI ส่งผลวิเคราะห์ที่อ่านไม่ได้");
  }
  const observation = assertObservation(parsed);
  const decision = deriveSuggestedUrgency(
    observation.detectedHazards,
    observation.needsHumanReview,
  );
  return {
    ...observation,
    ...decision,
    provider: "openai",
    model,
    modelResponseId: typeof payload.id === "string" ? payload.id : null,
    promptVersion: aiAssessmentPromptVersion,
    inputAttachmentCount: input.imageUrls.slice(0, 3).length,
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    usage: payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : {},
  };
}

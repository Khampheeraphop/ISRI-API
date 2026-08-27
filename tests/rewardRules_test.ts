import {
  requireVerifiedUrgency,
  validateFulfillment,
} from "../supabase/functions/isri-api/_shared/rewardRules.ts";

Deno.test("ระดับความเร่งด่วนต้องเป็นค่าที่ผู้จัดสรรยืนยัน", () => {
  if (requireVerifiedUrgency("critical") !== "critical") throw new Error("critical");
  if (requireVerifiedUrgency("urgent") !== "urgent") throw new Error("urgent");
  if (requireVerifiedUrgency("normal") !== "normal") throw new Error("normal");
  let rejected = false;
  try {
    requireVerifiedUrgency("reported-critical");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unverified urgency must be rejected");
});

Deno.test("รับด้วยตนเองไม่เก็บที่อยู่จัดส่ง", () => {
  const result = validateFulfillment({
    method: "pickup",
    recipientName: " ผู้รับสาธิต ",
    phone: " 0812345678 ",
    deliveryAddress: "ข้อความที่ไม่ควรถูกเก็บ",
    requesterNote: "",
  });
  if (result.deliveryAddress !== null) throw new Error("Address must be null");
  if (result.recipientName !== "ผู้รับสาธิต") throw new Error("Must trim name");
});

Deno.test("การจัดส่งต้องมีที่อยู่ที่ใช้งานได้", () => {
  let rejected = false;
  try {
    validateFulfillment({
      method: "delivery",
      recipientName: "ผู้รับสาธิต",
      phone: "0812345678",
      deliveryAddress: "สั้น",
      requesterNote: null,
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Short delivery address must be rejected");
});

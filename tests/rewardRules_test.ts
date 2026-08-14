import {
  pointsForVerifiedUrgency,
  validateFulfillment,
} from "../supabase/functions/isri-api/_shared/rewardRules.ts";

Deno.test("คะแนนใช้ระดับที่ผู้จัดสรรยืนยันเท่านั้น", () => {
  if (pointsForVerifiedUrgency("critical") !== 30) throw new Error("critical");
  if (pointsForVerifiedUrgency("urgent") !== 20) throw new Error("urgent");
  if (pointsForVerifiedUrgency("normal") !== 10) throw new Error("normal");
  let rejected = false;
  try {
    pointsForVerifiedUrgency("reported-critical");
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

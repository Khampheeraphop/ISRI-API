import { HttpError } from "./http.ts";

export function throwRewardError(error: { message: string }): never {
  const messages: Record<string, string> = {
    "Insufficient point balance.": "คะแนนไม่เพียงพอ กรุณาสะสมคะแนนเพิ่มก่อนแลกรางวัล",
    "Reward is out of stock.": "รางวัลหมดแล้ว คะแนนของคุณยังคงอยู่เพื่อสะสมต่อ",
    "Reward is not available.": "รางวัลนี้ยังไม่เปิดให้แลก",
    "This action is not available for the current redemption.":
      "สถานะคำขอเปลี่ยนไปแล้ว กรุณาโหลดรายการใหม่",
    "A cancellation reason is required.": "กรุณาระบุเหตุผลที่ยกเลิก",
  };
  if (messages[error.message]) {
    throw new HttpError(messages[error.message], 409);
  }
  throw error;
}

export type Urgency = "critical" | "urgent" | "normal";
export type FulfillmentMethod = "pickup" | "delivery";

export function requireVerifiedUrgency(value: unknown): Urgency {
  if (value !== "critical" && value !== "urgent" && value !== "normal") {
    throw new Error("Verified urgency is required.");
  }
  return value;
}

export function validateFulfillment(input: {
  method: unknown;
  recipientName: unknown;
  phone: unknown;
  deliveryAddress: unknown;
  requesterNote: unknown;
}) {
  if (input.method !== "pickup" && input.method !== "delivery") {
    throw new Error("Fulfillment method is invalid.");
  }
  const recipientName = typeof input.recipientName === "string"
    ? input.recipientName.trim()
    : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const deliveryAddress = typeof input.deliveryAddress === "string"
    ? input.deliveryAddress.trim() || null
    : null;
  const requesterNote = typeof input.requesterNote === "string"
    ? input.requesterNote.trim() || null
    : null;
  if (recipientName.length < 2 || recipientName.length > 160) {
    throw new Error("Recipient name is invalid.");
  }
  if (phone.length < 1 || phone.length > 30) {
    throw new Error("Phone number is invalid.");
  }
  if (
    input.method === "delivery" &&
    (!deliveryAddress ||
      deliveryAddress.length < 10 ||
      deliveryAddress.length > 1000)
  ) {
    throw new Error("A delivery address is required.");
  }
  if (requesterNote && requesterNote.length > 500) {
    throw new Error("Requester note is too long.");
  }
  return {
    fulfillmentMethod: input.method as FulfillmentMethod,
    recipientName,
    phone,
    deliveryAddress: input.method === "delivery" ? deliveryAddress : null,
    requesterNote,
  };
}

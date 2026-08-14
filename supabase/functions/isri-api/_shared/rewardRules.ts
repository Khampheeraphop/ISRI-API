export type Urgency = "critical" | "urgent" | "normal";
export type FulfillmentMethod = "pickup" | "delivery";

export const verifiedUrgencyPoints: Record<Urgency, number> = {
  critical: 30,
  urgent: 20,
  normal: 10,
};

export function pointsForVerifiedUrgency(value: unknown): number {
  if (value !== "critical" && value !== "urgent" && value !== "normal")
    throw new Error("Verified urgency is required.");
  return verifiedUrgencyPoints[value];
}

export function validateFulfillment(input: {
  method: unknown;
  recipientName: unknown;
  phone: unknown;
  deliveryAddress: unknown;
  requesterNote: unknown;
}) {
  if (input.method !== "pickup" && input.method !== "delivery")
    throw new Error("Fulfillment method is invalid.");
  const recipientName =
    typeof input.recipientName === "string" ? input.recipientName.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const deliveryAddress =
    typeof input.deliveryAddress === "string"
      ? input.deliveryAddress.trim() || null
      : null;
  const requesterNote =
    typeof input.requesterNote === "string"
      ? input.requesterNote.trim() || null
      : null;
  if (recipientName.length < 2 || recipientName.length > 160)
    throw new Error("Recipient name is invalid.");
  if (phone.length < 1 || phone.length > 30)
    throw new Error("Phone number is invalid.");
  if (
    input.method === "delivery" &&
    (!deliveryAddress ||
      deliveryAddress.length < 10 ||
      deliveryAddress.length > 1000)
  )
    throw new Error("A delivery address is required.");
  if (requesterNote && requesterNote.length > 500)
    throw new Error("Requester note is too long.");
  return {
    fulfillmentMethod: input.method as FulfillmentMethod,
    recipientName,
    phone,
    deliveryAddress: input.method === "delivery" ? deliveryAddress : null,
    requesterNote,
  };
}

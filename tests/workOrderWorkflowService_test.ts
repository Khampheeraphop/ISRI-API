import { HttpError } from "../supabase/functions/isri-api/_shared/http.ts";
import { validateWorkOrderAction } from "../supabase/functions/isri-api/services/workOrderWorkflowService.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected)
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
}

function assertThrows(
  callback: () => void,
  expectedType: new (...args: never[]) => Error,
) {
  try {
    callback();
  } catch (error) {
    if (error instanceof expectedType) return;
    throw error;
  }
  throw new Error("Expected callback to throw.");
}

Deno.test("technician actions follow the intended repair path", () => {
  const accepted = validateWorkOrderAction({
    action: "accept_work",
    actorRole: "technician",
    currentStatus: "pending",
    note: "",
  });
  assertEquals(accepted.transition.to, "in_progress");

  const requestedParts = validateWorkOrderAction({
    action: "request_parts",
    actorRole: "technician",
    currentStatus: "in_progress",
    note: "ต้องเปลี่ยนเบรกเกอร์ชำรุด",
  });
  assertEquals(requestedParts.transition.to, "pending_parts_approval");

  const receivedParts = validateWorkOrderAction({
    action: "confirm_parts_received",
    actorRole: "technician",
    currentStatus: "waiting_parts",
    note: "",
  });
  assertEquals(receivedParts.transition.to, "in_progress");

  const submitted = validateWorkOrderAction({
    action: "submit_repair",
    actorRole: "technician",
    currentStatus: "in_progress",
    note: "เปลี่ยนเบรกเกอร์และทดสอบการใช้งานเรียบร้อย",
  });
  assertEquals(submitted.transition.to, "pending_repair_approval");
});

Deno.test(
  "dispatcher can approve or return only work waiting for review",
  () => {
    const approvedParts = validateWorkOrderAction({
      action: "approve_parts",
      actorRole: "dispatcher",
      currentStatus: "pending_parts_approval",
      note: "",
    });
    assertEquals(approvedParts.transition.to, "waiting_parts");

    const returned = validateWorkOrderAction({
      action: "return_for_rework",
      actorRole: "dispatcher",
      currentStatus: "pending_repair_approval",
      note: "ขอภาพผลทดสอบหลังเปลี่ยนอุปกรณ์เพิ่ม",
    });
    assertEquals(returned.transition.to, "in_progress");

    const approvedRepair = validateWorkOrderAction({
      action: "approve_repair",
      actorRole: "dispatcher",
      currentStatus: "pending_repair_approval",
      note: "",
    });
    assertEquals(approvedRepair.transition.to, "done");
  },
);

Deno.test(
  "workflow rejects invalid role, state, and missing mandatory note",
  () => {
    const invalid = (input: Parameters<typeof validateWorkOrderAction>[0]) =>
      assertThrows(() => validateWorkOrderAction(input), HttpError);

    invalid({
      action: "approve_repair",
      actorRole: "technician",
      currentStatus: "pending_repair_approval",
      note: "",
    });
    invalid({
      action: "accept_work",
      actorRole: "technician",
      currentStatus: "waiting_parts",
      note: "",
    });
    invalid({
      action: "request_parts",
      actorRole: "technician",
      currentStatus: "in_progress",
      note: "   ",
    });
  },
);

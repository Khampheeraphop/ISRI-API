import { HttpError } from "../supabase/functions/isri-api/_shared/http.ts";
import { workflowTransitions } from "../supabase/functions/isri-api/_shared/workOrderWorkflow.ts";
import { validateWorkOrderAction } from "../supabase/functions/isri-api/services/workOrderWorkflowService.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
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

    const rejectedParts = validateWorkOrderAction({
      action: "reject_parts",
      actorRole: "dispatcher",
      currentStatus: "pending_parts_approval",
      note: "รายการอะไหล่ยังไม่เพียงพอสำหรับอนุมัติ",
    });
    assertEquals(rejectedParts.transition.to, "in_progress");

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
    invalid({
      action: "reject_parts",
      actorRole: "dispatcher",
      currentStatus: "pending_parts_approval",
      note: "   ",
    });
  },
);

Deno.test("workflow mapping keeps the incident and work-order status aligned", () => {
  const expected = {
    accept_work: ["technician", "pending", "in_progress", "in_progress"],
    request_parts: [
      "technician",
      "in_progress",
      "pending_parts_approval",
      "pending_parts_approval",
    ],
    approve_parts: [
      "dispatcher",
      "pending_parts_approval",
      "waiting_parts",
      "waiting_parts",
    ],
    reject_parts: [
      "dispatcher",
      "pending_parts_approval",
      "in_progress",
      "in_progress",
    ],
    confirm_parts_received: [
      "technician",
      "waiting_parts",
      "in_progress",
      "in_progress",
    ],
    submit_repair: [
      "technician",
      "in_progress",
      "pending_repair_approval",
      "pending_repair_approval",
    ],
    approve_repair: ["dispatcher", "pending_repair_approval", "done", "done"],
    return_for_rework: [
      "dispatcher",
      "pending_repair_approval",
      "in_progress",
      "in_progress",
    ],
  } as const;

  for (
    const [action, [actor, from, to, incidentStatus]] of Object.entries(
      expected,
    )
  ) {
    const transition =
      workflowTransitions[action as keyof typeof workflowTransitions];
    assertEquals(transition.actor, actor);
    assertEquals(transition.from[0], from);
    assertEquals(transition.to, to);
    assertEquals(transition.incidentStatus, incidentStatus);
  }
});

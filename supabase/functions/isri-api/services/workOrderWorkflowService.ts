import { HttpError } from "../_shared/http.ts";
import {
  workflowTransitions,
  type WorkOrderAction,
} from "../_shared/workOrderWorkflow.ts";

export function validateWorkOrderAction(input: {
  action: unknown;
  actorRole: "technician" | "dispatcher";
  currentStatus: string;
  note: unknown;
}) {
  if (
    typeof input.action !== "string" ||
    !(input.action in workflowTransitions)
  ) {
    throw new HttpError("Work order action is invalid.");
  }
  const action = input.action as WorkOrderAction;
  const transition = workflowTransitions[action];
  if (
    transition.actor !== input.actorRole ||
    !transition.from.includes(input.currentStatus)
  ) {
    throw new HttpError(
      "This action is not available for the current work order.",
      409,
    );
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (
    (action === "request_parts" ||
      action === "submit_repair" ||
      action === "reject_parts" ||
      action === "return_for_rework") &&
    !note
  ) {
    throw new HttpError("A work note is required for this action.");
  }
  if (note.length > 2000) throw new HttpError("Work note is too long.");
  return { action, transition, note: note || null };
}

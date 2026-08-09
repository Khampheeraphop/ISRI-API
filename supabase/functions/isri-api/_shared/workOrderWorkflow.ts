export type WorkOrderAction =
  | "accept_work"
  | "request_parts"
  | "approve_parts"
  | "confirm_parts_received"
  | "submit_repair"
  | "approve_repair"
  | "return_for_rework";

export const workflowTransitions: Record<
  WorkOrderAction,
  {
    actor: "technician" | "dispatcher";
    from: string[];
    to: string;
    incidentStatus: string;
    eventType:
      | "status_change"
      | "parts_requested"
      | "repair_note"
      | "completion";
  }
> = {
  accept_work: {
    actor: "technician",
    from: ["pending"],
    to: "in_progress",
    incidentStatus: "in_progress",
    eventType: "status_change",
  },
  request_parts: {
    actor: "technician",
    from: ["in_progress"],
    to: "pending_parts_approval",
    incidentStatus: "pending_parts_approval",
    eventType: "parts_requested",
  },
  approve_parts: {
    actor: "dispatcher",
    from: ["pending_parts_approval"],
    to: "waiting_parts",
    incidentStatus: "waiting_parts",
    eventType: "status_change",
  },
  confirm_parts_received: {
    actor: "technician",
    from: ["waiting_parts"],
    to: "in_progress",
    incidentStatus: "in_progress",
    eventType: "status_change",
  },
  submit_repair: {
    actor: "technician",
    from: ["in_progress"],
    to: "pending_repair_approval",
    incidentStatus: "pending_repair_approval",
    eventType: "completion",
  },
  approve_repair: {
    actor: "dispatcher",
    from: ["pending_repair_approval"],
    to: "done",
    incidentStatus: "done",
    eventType: "completion",
  },
  return_for_rework: {
    actor: "dispatcher",
    from: ["pending_repair_approval"],
    to: "in_progress",
    incidentStatus: "in_progress",
    eventType: "repair_note",
  },
};

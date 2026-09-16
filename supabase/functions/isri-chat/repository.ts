import type { AppRole, DatabaseClient } from "../isri-api/_shared/types.ts";
import { HttpError } from "../isri-api/_shared/http.ts";
import {
  assertTopic,
  type ChatQuery,
  dateBounds,
  pageSize,
  redact,
} from "./policy.ts";

type Row = Record<string, unknown>;
export type Source = { label: string; path: string };
export type Evidence = { topic: string; facts: unknown; sources: Source[] };
const incidentStatuses = [
  "submitted",
  "pending_assignment",
  "assigned",
  "in_progress",
  "pending_parts_approval",
  "waiting_parts",
  "pending_repair_approval",
  "done",
  "rejected",
];
const orderStatuses = [
  "pending",
  "in_progress",
  "pending_parts_approval",
  "waiting_parts",
  "pending_repair_approval",
  "done",
];
const incidentFields =
  "id,ticket_number,location_label,asset_name,description,status,urgency_verified,created_at,updated_at";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, clean(v)]),
    );
  }
  return value;
}

export function rewardProgress(reward: Row, balance: number) {
  return {
    ...reward,
    points_short: Math.max(0, Number(reward.point_cost) - balance),
    can_redeem_now:
      reward.reward_period === "standard" &&
      reward.is_active === true &&
      Number(reward.stock) > 0 &&
      balance >= Number(reward.point_cost),
  };
}

function publicChatRow(topic: string, row: Row): Row {
  if (topic !== "rewards" && topic !== "redemptions") return row;
  const safe = { ...row };
  delete safe.id;
  if (
    topic === "redemptions" &&
    safe.reward_items &&
    typeof safe.reward_items === "object" &&
    !Array.isArray(safe.reward_items)
  ) {
    const reward = { ...(safe.reward_items as Row) };
    delete reward.id;
    safe.reward_items = reward;
  }
  return safe;
}

export class ChatRepository {
  constructor(
    private db: DatabaseClient,
    private actorId: string,
    private role: AppRole,
  ) {}

  async read(q: ChatQuery): Promise<Evidence> {
    assertTopic(this.role, q.topic); // Rechecked at execution, regardless of the model's plan.
    const bounds = dateBounds(q);
    const pattern = `%${q.search.replace(/_/g, "\\_")}%`;
    let table: string,
      columns: string,
      statuses: string[] = [],
      dateColumn: string,
      searchColumn: string,
      path: string;
    switch (q.topic) {
      case "incidents":
      case "dispatch_queue":
      case "overview":
        table = "incidents";
        columns = incidentFields;
        statuses = incidentStatuses;
        dateColumn = "created_at";
        searchColumn = "ticket_number";
        path =
          q.topic === "incidents"
            ? "/incidents/mine"
            : q.topic === "dispatch_queue"
              ? "/dispatch"
              : "/";
        break;
      case "work_orders":
        table = "work_orders";
        columns = `id,incident_id,status,assigned_at,updated_at,respond_due_at,resolve_due_at,incidents!inner(ticket_number,location_label,asset_name,description,urgency_verified)${
          this.role === "technician"
            ? ",work_order_assignees!inner(technician_id)"
            : ""
        }`;
        statuses = orderStatuses;
        dateColumn = "assigned_at";
        searchColumn = "incidents.ticket_number";
        path =
          this.role === "technician" ? "/work-orders" : "/dispatch/reviews";
        break;
      case "pm":
        table = "pm_schedules";
        columns =
          "id,asset_name,location_label,plan_details,status,next_due_at,last_done_at,end_at";
        dateColumn = "next_due_at";
        searchColumn = "asset_name";
        path = "/pm";
        break;
      case "rewards":
        table = "reward_items";
        columns =
          "id,name,description,point_cost,stock,is_active,reward_period";
        dateColumn = "created_at";
        searchColumn = "name";
        path = this.role === "reporter" ? "/rewards" : "/rewards/manage";
        break;
      case "redemptions":
        table = "reward_redemptions";
        columns =
          "id,status,point_cost,redeemed_at,approved_at,fulfilled_at,cancelled_at,reward_items!inner(name)";
        statuses = ["pending", "approved", "fulfilled", "cancelled"];
        dateColumn = "redeemed_at";
        searchColumn = "reward_items.name";
        path = this.role === "reporter" ? "/rewards" : "/rewards/redemptions";
        break;
      case "users":
        table = "profiles";
        columns = "id,approval_status,role";
        statuses = ["pending", "approved", "rejected"];
        dateColumn = "created_at";
        searchColumn = "id";
        path = "/users";
        break;
      case "campaigns":
        table = "reward_campaigns";
        columns =
          "id,name,start_date,end_date,status,winner_count,reserved_reward_count";
        dateColumn = "start_date";
        searchColumn = "name";
        path = "/campaigns/manage";
        break;
    }
    const statusColumn = q.topic === "users" ? "approval_status" : "status";
    if (q.status && !statuses.includes(q.status)) {
      throw new HttpError(
        "ยังไม่รองรับตัวกรองสถานะนี้ กรุณาถามโดยไม่ระบุสถานะ",
      );
    }
    if (q.topic === "users" && q.search) {
      throw new HttpError(
        "แชทรองรับเฉพาะจำนวนผู้ใช้ตามสถานะ กรุณาดูรายละเอียดที่หน้าจัดการผู้ใช้",
      );
    }
    const build = (head = false, status = q.status) => {
      let query = this.db.from(table).select(columns, { count: "exact", head });
      if (q.topic === "incidents") {
        query = query.eq("reporter_id", this.actorId);
      }
      if (q.topic === "dispatch_queue") {
        query = query.eq("status", "pending_assignment");
      }
      if (q.topic === "work_orders") {
        query =
          this.role === "technician"
            ? query.eq("work_order_assignees.technician_id", this.actorId)
            : query.eq("assigned_by", this.actorId);
      }
      if (q.topic === "pm" && this.role === "technician") {
        query = query.eq("assigned_technician_id", this.actorId);
      }
      if (q.topic === "rewards" && this.role === "reporter") {
        query = query.eq("is_active", true);
      }
      if (q.topic === "redemptions" && this.role === "reporter") {
        query = query.eq("user_id", this.actorId);
      }
      if (status) query = query.eq(statusColumn, status);
      if (q.search) {
        query = uuid.test(q.search)
          ? query.eq("id", q.search)
          : query.ilike(searchColumn, pattern);
      }
      if (bounds.from) {
        query = query.gte(
          dateColumn,
          q.topic === "campaigns" ? q.from : bounds.from,
        );
      }
      if (bounds.until) {
        query =
          q.topic === "campaigns"
            ? query.lte(dateColumn, q.until)
            : query.lt(dateColumn, bounds.until);
      }
      return query;
    };
    const start = (q.page - 1) * pageSize;
    const result = await build()
      .order(dateColumn, { ascending: q.topic === "pm" })
      .order("id")
      .range(start, start + pageSize - 1);
    if (result.error || result.count === null) {
      throw new HttpError(
        "อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่ ขณะนี้ยังสรุปจำนวนไม่ได้",
        503,
      );
    }
    let rows = (result.data ?? []) as unknown as Row[];
    const countsByStatus: Record<string, number> = {};
    for (const status of statuses) {
      if (q.status && q.status !== status) continue;
      if (q.topic === "dispatch_queue" && status !== "pending_assignment") {
        continue;
      }
      const count = await build(true, status);
      if (count.error || count.count === null) {
        throw new HttpError("อ่านยอดรวมไม่สำเร็จ กรุณาลองใหม่", 503);
      }
      countsByStatus[status] = count.count;
    }
    let balance: number | undefined;
    if (q.topic === "rewards" && this.role === "reporter") {
      const wallet = await this.db
        .from("point_wallets")
        .select("balance")
        .eq("user_id", this.actorId)
        .maybeSingle();
      if (wallet.error) {
        throw new HttpError("อ่านแต้มไม่สำเร็จ กรุณาลองใหม่", 503);
      }
      balance = Number(wallet.data?.balance ?? 0);
      rows = rows.map((row) => rewardProgress(row, balance!));
    }
    const sources: Source[] = [{ label: "เปิดหน้าข้อมูลในระบบ", path }];
    for (const row of rows) {
      if (!uuid.test(String(row.id))) continue;
      if (q.topic === "incidents") {
        sources.push({
          label: String(row.ticket_number),
          path: `/incidents/${row.id}`,
        });
      }
      if (q.topic === "dispatch_queue") {
        sources.push({
          label: String(row.ticket_number),
          path: `/dispatch/incidents/${row.id}`,
        });
      }
      if (q.topic === "overview") {
        sources.push({
          label: String(row.ticket_number),
          path: `/activity-history/${row.id}`,
        });
      }
      if (q.topic === "work_orders") {
        const incident = row.incidents as Row;
        sources.push({
          label: String(incident.ticket_number),
          path: `/work-orders/${row.id}`,
        });
        delete row.work_order_assignees;
      }
    }
    let history: unknown;
    // Load notes only after the requested incident/order has passed the same scope filters.
    if (
      q.search &&
      rows.length === 1 &&
      ["incidents", "work_orders"].includes(q.topic)
    ) {
      let orderId = q.topic === "work_orders" ? String(rows[0].id) : "";
      if (!orderId) {
        const order = await this.db
          .from("work_orders")
          .select("id,status,resolve_due_at")
          .eq("incident_id", rows[0].id)
          .maybeSingle();
        if (order.error) throw new HttpError("อ่านสถานะงานไม่สำเร็จ", 503);
        orderId = order.data?.id ?? "";
        rows[0].work_order = order.data;
      }
      if (orderId) {
        const events = await this.db
          .from("work_order_history")
          .select("status,note,changed_at", { count: "exact" })
          .eq("work_order_id", orderId)
          .order("changed_at", { ascending: false })
          .limit(10);
        if (events.error) throw new HttpError("อ่านประวัติงานไม่สำเร็จ", 503);
        history = { recent: events.data, total: events.count, limit: 10 };
      }
    }
    return {
      topic: q.topic,
      facts: clean({
        filters: q,
        dateField: dateColumn,
        total: result.count,
        countsByStatus,
        page: q.page,
        pageSize,
        hasMore: start + rows.length < result.count,
        balance,
        history,
        rows:
          q.topic === "users"
            ? []
            : rows.map((row) => publicChatRow(q.topic, row)),
        scope:
          q.topic === "work_orders"
            ? this.role === "technician"
              ? "งานที่ยังมีชื่ออยู่ในทีมของคุณ"
              : "งานที่คุณเป็นผู้จัดสรร"
            : q.topic === "dispatch_queue"
              ? "คิวรอจัดสรร"
              : undefined,
      }),
      sources,
    };
  }
}

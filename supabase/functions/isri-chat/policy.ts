import { HttpError } from "../isri-api/_shared/http.ts";
import type { AppRole } from "../isri-api/_shared/types.ts";

export const topicsByRole = {
  reporter: ["incidents", "rewards", "redemptions"],
  dispatcher: ["dispatch_queue", "work_orders"],
  technician: ["work_orders", "pm"],
  admin: ["overview", "pm", "rewards", "redemptions", "users", "campaigns"],
} as const;
export type Topic = (typeof topicsByRole)[AppRole][number];
export type Message = { role: "user" | "assistant"; text: string };
export type ChatQuery = {
  topic: Topic;
  search: string;
  page: number;
  status: string;
  from: string;
  until: string;
};
export type Plan = {
  mode: "query" | "help" | "out_of_scope";
  queries: ChatQuery[];
};
export const pageSize = 15;
export const refusal =
  "ผมช่วยเรื่องการแจ้งเหตุ งานซ่อม แต้ม รางวัล และการใช้งาน ISRI ตามสิทธิ์ของคุณได้ครับ กรุณาถามเรื่องในระบบ ISRI";
export const knowledge = `ISRI เป็นระบบแจ้งปัญหาโครงสร้างพื้นฐานในสถานพยาบาล
ผู้แจ้ง: สแกน QR ของตำแหน่งเพื่อแจ้งเหตุ ติดตามงานของตน สะสมแต้มและแลกรางวัล ไม่มีสิทธิ์ดูอันดับแคมเปญ
ผู้จัดสรร: ตรวจความเร่งด่วน มอบหมายช่าง และตรวจรับเฉพาะงานที่ตนจัดสรร
ช่าง: รับงานในทีมของตน บันทึกการซ่อม ขออะไหล่ ส่งผลซ่อม และทำ PM ที่ได้รับมอบหมาย
ผู้ดูแล: ดูภาพรวม จัดการผู้ใช้ SLA PM รางวัล การส่งมอบ แคมเปญ และตำแหน่ง QR ไม่ทำหน้าที่ผู้จัดสรร
สถานะ: submitted/pending_assignment=รอจัดสรร, assigned=มอบหมายแล้ว, pending=รอช่างรับงาน,
in_progress=กำลังดำเนินการ, pending_parts_approval=รออนุมัติอะไหล่, waiting_parts=รออะไหล่,
pending_repair_approval=รอตรวจรับผลซ่อม, done=ปิดงานแล้ว, rejected=ปฏิเสธรายการ
SLA คือกรอบเวลารับและแก้ไขงาน ไม่ใช่การรับประกันวันซ่อมเสร็จ
แต้มได้เมื่อปิดงาน ยึดความเร่งด่วนที่ผู้จัดสรรยืนยันและกติกา ณ เวลามอบหมาย ไม่ทำนายแต้มจากจำนวนการแจ้ง
รางวัล standard แลกด้วยแต้มได้เมื่อเปิดใช้งาน มีสต็อก และแต้มพอ; annual เป็นรางวัลแคมเปญ ไม่ใช่ของแลกด้วยแต้มปกติ
การแลกรางวัลเลือกรับเองหรือจัดส่ง ผู้ดูแลอนุมัติและบันทึกส่งมอบ การยกเลิกคืนแต้มและสต็อกตาม workflow
การแนะนำงานก่อนหลังต้องอ้างความเร่งด่วนและกำหนดเวลาที่มีจริง ไม่ให้คำแนะนำซ่อมเชิงช่างหรือทางการแพทย์นอกคู่มือ
แชทนี้อ่านและอธิบายข้อมูลเท่านั้น หากขอเปลี่ยนข้อมูลให้แนะนำไปหน้ารายการเพื่อทำด้วยตนเอง
ไม่มีข้อมูลคู่มือเพิ่มเติมนอกข้อความนี้ ต้องบอกเมื่อยังตอบไม่ได้ ห้ามแต่งกฎ นโยบาย หรือข้อเท็จจริง`;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError("รูปแบบข้อมูลไม่ถูกต้อง");
  return value as Record<string, unknown>;
}

export function parseMessages(value: unknown): Message[] {
  const body = record(value);
  if (Object.keys(body).some((key) => key !== "messages"))
    throw new HttpError("รูปแบบคำขอไม่ถูกต้อง");
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 13
  )
    throw new HttpError("กรุณาเริ่มบทสนทนาใหม่");
  let length = 0;
  const messages = body.messages.map((item, index) => {
    const message = record(item);
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (
      message.role !== expected ||
      typeof message.text !== "string" ||
      !message.text.trim() ||
      message.text.length > (expected === "user" ? 1500 : 6000)
    )
      throw new HttpError("ข้อความยาวเกินไปหรือรูปแบบบทสนทนาไม่ถูกต้อง");
    length += message.text.length;
    return { role: expected, text: message.text.trim() } as Message;
  });
  if (length > 24000 || messages.at(-1)?.role !== "user")
    throw new HttpError("กรุณาย่อข้อความหรือเริ่มบทสนทนาใหม่");
  return messages;
}

export function assertTopic(
  role: AppRole,
  topic: string,
): asserts topic is Topic {
  if (!(topicsByRole[role] as readonly string[]).includes(topic))
    throw new HttpError("คุณไม่มีสิทธิ์ดูข้อมูลประเภทนี้", 403);
}

function date(value: unknown) {
  if (value === "" || value === undefined) return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new HttpError("ช่วงวันที่ไม่ถูกต้อง");
  return value;
}

export function parsePlan(value: unknown, role: AppRole): Plan {
  const plan = record(value);
  if (
    !["query", "help", "out_of_scope"].includes(String(plan.mode)) ||
    !Array.isArray(plan.queries) ||
    plan.queries.length > 2
  )
    throw new HttpError(
      "AI ไม่สามารถตีความคำถามได้ กรุณาลองระบุให้ชัดขึ้น",
      502,
    );
  const queries = plan.queries.map((item) => {
    const q = record(item);
    if (
      Object.keys(q).some(
        (key) =>
          !["topic", "search", "page", "status", "from", "until"].includes(key),
      )
    )
      throw new HttpError("คำขอข้อมูลไม่ถูกต้อง");
    assertTopic(role, String(q.topic));
    const search = q.search ?? "";
    if (
      typeof search !== "string" ||
      search.length > 100 ||
      !/^[\p{L}\p{N}\p{M}\s\-_.]*$/u.test(search)
    )
      throw new HttpError("กรุณาระบุรหัสรายการหรือคำค้นสั้น ๆ");
    const page = q.page ?? 1;
    if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 10000)
      throw new HttpError("เลขหน้าไม่ถูกต้อง");
    const status = q.status ?? "";
    if (typeof status !== "string" || !/^[a-z_]{0,40}$/.test(status))
      throw new HttpError("สถานะไม่ถูกต้อง");
    const from = date(q.from),
      until = date(q.until);
    if (from && until && from > until)
      throw new HttpError("ช่วงวันที่ไม่ถูกต้อง");
    return {
      topic: q.topic as Topic,
      search: search.trim(),
      page: Number(page),
      status,
      from,
      until,
    };
  });
  if ((plan.mode === "query") !== queries.length > 0)
    throw new HttpError("AI ไม่สามารถเลือกข้อมูลได้ กรุณาลองใหม่", 502);
  return { mode: plan.mode as Plan["mode"], queries };
}

// Dates entered by Thai users are inclusive Bangkok calendar dates.
export function dateBounds(q: Pick<ChatQuery, "from" | "until">) {
  return {
    from: q.from ? new Date(`${q.from}T00:00:00+07:00`).toISOString() : "",
    until: q.until
      ? new Date(
          Date.parse(`${q.until}T00:00:00+07:00`) + 86400000,
        ).toISOString()
      : "",
  };
}

export function redact(text: string, limit = 900) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[อีเมล]")
    .replace(
      /(?<![\p{L}\p{N}-])(?:\+66\d(?:[ -]?\d){8}|0\d(?:[ -]?\d){8})(?![\p{L}\p{N}-])/gu,
      "[เบอร์โทร]",
    )
    .slice(0, limit);
}

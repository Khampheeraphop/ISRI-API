export type EmailEventKey =
  | "incident_submitted"
  | "incident_rejected"
  | "assignment_reporter"
  | "assignment_technician_primary"
  | "assignment_technician_support"
  | "work_accepted"
  | "parts_requested"
  | "parts_approved"
  | "parts_rejected"
  | "repair_submitted"
  | "rework_requested"
  | "repair_completed"
  | "pm_schedule_assigned"
  | "pm_schedule_updated"
  | "reward_redemption_submitted"
  | "reward_redemption_approved"
  | "reward_redemption_fulfilled"
  | "reward_redemption_cancelled"
  | "pm_due_soon"
  | "pm_overdue"
  | "pm_completion_log"
  | "user_account_approved"
  | "user_account_rejected"
  | "campaign_started"
  | "campaign_ending_soon"
  | "campaign_ended";

export interface WorkflowEmailPayload {
  recipientName: string;
  ticketNumber?: string;
  reporterName?: string | null;
  locationLabel?: string | null; // Made optional for reward/campaign events
  assetName?: string | null;
  category?: string | null;
  urgencyLabel?: string | null;
  actionByName?: string | null;
  note?: string | null;
  actionUrl: string;
  intervalMonths?: number | null;
  nextDueAt?: string | null;
  googleCalendarUrl?: string | null;
  // Reward redemption specific fields
  rewardName?: string | null;
  pointCost?: number | null;
  fulfillmentMethod?: string | null;
  recipientContactName?: string | null; // For reward recipient contact
  pointsEarned?: number | null;
  balanceRemaining?: number | null;
  // User account specific fields
  userRole?: string | null;
  rejectionReason?: string | null;
  // Campaign specific fields
  campaignName?: string | null;
  campaignEndDate?: string | null;
}

export interface RenderedWorkflowEmail {
  subject: string;
  html: string;
  text: string;
}

type TemplateConfig = {
  badge: string;
  badgeColor: string;
  title: string;
  intro: (payload: WorkflowEmailPayload) => string;
  cta: string;
};

const configByEvent: Record<EmailEventKey, TemplateConfig> = {
  incident_submitted: {
    badge: "รอตรวจสอบ",
    badgeColor: "#365f91",
    title: "มีคำขอแจ้งซ่อมใหม่",
    intro: (p) =>
      `มีรายการใหม่จาก ${p.reporterName || "ผู้แจ้งเหตุ"} รอให้คุณตรวจสอบและมอบหมายงาน`,
    cta: "เปิดรายการแจ้งซ่อม",
  },
  incident_rejected: {
    badge: "ไม่รับรายการ",
    badgeColor: "#ba3d3d",
    title: "ผลการพิจารณาคำขอแจ้งซ่อม",
    intro: () => "คำขอแจ้งซ่อมของคุณไม่สามารถดำเนินการต่อได้ในขณะนี้",
    cta: "ดูผลการพิจารณา",
  },
  assignment_reporter: {
    badge: "มอบหมายงานแล้ว",
    badgeColor: "#5b3ea4",
    title: "คำขอของคุณได้รับการมอบหมายแล้ว",
    intro: () => "ผู้จัดสรรงานได้มอบหมายทีมช่างเพื่อดำเนินการตามคำขอของคุณแล้ว",
    cta: "ดูสถานะคำขอ",
  },
  assignment_technician_primary: {
    badge: "งานใหม่",
    badgeColor: "#5b3ea4",
    title: "คุณได้รับมอบหมายเป็นช่างหลัก",
    intro: () => "มีใบงานใหม่รอให้คุณรับงานและเริ่มดำเนินการ",
    cta: "เปิดใบงาน",
  },
  assignment_technician_support: {
    badge: "งานใหม่",
    badgeColor: "#5b3ea4",
    title: "คุณได้รับมอบหมายเป็นช่างสนับสนุน",
    intro: () => "คุณถูกเพิ่มเข้าทีมช่างของใบงานนี้เพื่อร่วมดำเนินการ",
    cta: "เปิดใบงาน",
  },
  work_accepted: {
    badge: "กำลังดำเนินการ",
    badgeColor: "#365f91",
    title: "ทีมช่างรับงานแล้ว",
    intro: () => "ช่างหลักรับงานเรียบร้อยแล้วและกำลังเริ่มดำเนินการซ่อม",
    cta: "ดูสถานะงาน",
  },
  parts_requested: {
    badge: "รออนุมัติอะไหล่",
    badgeColor: "#a76810",
    title: "มีคำขอเบิกอะไหล่รออนุมัติ",
    intro: () =>
      "ช่างหลักส่งคำขอเบิกอะไหล่สำหรับใบงานนี้ โปรดพิจารณารายละเอียด",
    cta: "พิจารณาคำขอ",
  },
  parts_approved: {
    badge: "อนุมัติอะไหล่แล้ว",
    badgeColor: "#257a57",
    title: "คำขอเบิกอะไหล่ได้รับอนุมัติแล้ว",
    intro: () => "คุณสามารถดำเนินการรอรับอะไหล่และซ่อมงานต่อได้",
    cta: "เปิดใบงาน",
  },
  parts_rejected: {
    badge: "ไม่อนุมัติอะไหล่",
    badgeColor: "#ba3d3d",
    title: "คำขอเบิกอะไหล่ไม่ได้รับอนุมัติ",
    intro: () => "โปรดตรวจสอบเหตุผลและดำเนินการซ่อมตามแนวทางที่เหมาะสมต่อไป",
    cta: "เปิดใบงาน",
  },
  repair_submitted: {
    badge: "รอตรวจรับงานซ่อม",
    badgeColor: "#a76810",
    title: "มีรายงานผลการซ่อมรอตรวจรับ",
    intro: () =>
      "ช่างหลักส่งผลการซ่อมและหลักฐานแล้ว โปรดตรวจรับเพื่อปิดงานหรือส่งกลับแก้ไข",
    cta: "ตรวจรับงานซ่อม",
  },
  rework_requested: {
    badge: "ส่งกลับแก้ไข",
    badgeColor: "#ba3d3d",
    title: "รายการถูกส่งกลับให้แก้ไข",
    intro: () =>
      "ผู้จัดสรรงานขอให้ปรับแก้ผลการซ่อม โปรดตรวจสอบรายละเอียดและดำเนินการอีกครั้ง",
    cta: "เปิดใบงาน",
  },
  repair_completed: {
    badge: "ปิดงานแล้ว",
    badgeColor: "#257a57",
    title: "งานซ่อมของคุณเสร็จสิ้นแล้ว",
    intro: () =>
      "ผู้จัดสรรงานตรวจรับผลการซ่อมเรียบร้อยแล้ว ขอบคุณที่ร่วมแจ้งปัญหาเพื่อความปลอดภัย",
    cta: "ดูรายละเอียดงาน",
  },
  pm_schedule_assigned: {
    badge: "แผนงาน PM",
    badgeColor: "#1e7a5c",
    title: "คุณได้รับมอบหมายรอบตรวจเช็ค PM ใหม่",
    intro: (p) =>
      `มีแผนบำรุงรักษาเชิงป้องกัน (PM) สำหรับ ${p.assetName || "ครุภัณฑ์"} มอบหมายให้คุณดำเนินการทุก ${p.intervalMonths ?? 1} เดือน`,
    cta: "เปิดดูและบันทึกผล PM",
  },
  pm_schedule_updated: {
    badge: "อัปเดตรอบ PM",
    badgeColor: "#365f91",
    title: "มีการแก้ไขรอบตรวจเช็ค PM",
    intro: (p) =>
      `แผนบำรุงรักษาเชิงป้องกัน (PM) สำหรับ ${p.assetName || "ครุภัณฑ์"} มีการปรับปรุงข้อมูลรอบตรวจเช็ค`,
    cta: "เปิดดูและบันทึกผล PM",
  },
  reward_redemption_submitted: {
    badge: "ขอแลกรางวัล",
    badgeColor: "#5b3ea4",
    title: "มีคำขอแลกรางวัลใหม่",
    intro: (p) =>
      `มีคำขอแลกรางวัล "${p.rewardName || "รางวัล"}" (${p.pointCost ?? 0} คะแนน) รออนุมัติ`,
    cta: "พิจารณาคำขอแลกรางวัล",
  },
  reward_redemption_approved: {
    badge: "อนุมัติแลกรางวัล",
    badgeColor: "#257a57",
    title: "คำขอแลกรางวัลได้รับอนุมัติแล้ว",
    intro: (p) =>
      `คำขอแลกรางวัล "${p.rewardName || "รางวัล"}" ได้รับอนุมัติแล้ว ${p.fulfillmentMethod === "delivery" ? "เราจะจัดส่งถึงที่อยู่ที่ระบุ" : "กรุณามารับรางวัลตามจุดรับที่กำหนด"}`,
    cta: "ดูสถานะการแลกรางวัล",
  },
  reward_redemption_fulfilled: {
    badge: "ส่งมอบรางวัลแล้ว",
    badgeColor: "#257a57",
    title: "รางวัลของคุณถูกส่งมอบแล้ว",
    intro: (p) =>
      `รางวัล "${p.rewardName || "รางวัล"}" ถูกส่งมอบเรียบร้อยแล้ว ${p.note ? `หมายเหตุ: ${p.note}` : ""}`,
    cta: "ดูประวัติการแลกรางวัล",
  },
  reward_redemption_cancelled: {
    badge: "ยกเลิกแลกรางวัล",
    badgeColor: "#ba3d3d",
    title: "คำขอแลกรางวัลถูกยกเลิก",
    intro: (p) =>
      `คำขอแลกรางวัล "${p.rewardName || "รางวัล"}" ถูกยกเลิก คะแนน ${p.pointCost ?? 0} คะแนนถูกคืนเข้าบัญชีของคุณแล้ว ${p.rejectionReason ? `เหตุผล: ${p.rejectionReason}` : ""}`,
    cta: "ดูประวัติการแลกรางวัล",
  },
  pm_due_soon: {
    badge: "PM ใกล้ครบกำหนด",
    badgeColor: "#a76810",
    title: "รอบตรวจเช็ค PM ใกล้ครบกำหนด",
    intro: (p) =>
      `รอบตรวจเช็ค PM สำหรับ ${p.assetName || "ครุภัณฑ์"} ที่ ${p.locationLabel} จะครบกำหนดในวันที่ ${p.nextDueAt ? p.nextDueAt.slice(0, 10) : "เร็วๆ นี้"}`,
    cta: "เปิดดูและบันทึกผล PM",
  },
  pm_overdue: {
    badge: "PM เกินกำหนด",
    badgeColor: "#ba3d3d",
    title: "รอบตรวจเช็ค PM เกินกำหนดแล้ว",
    intro: (p) =>
      `รอบตรวจเช็ค PM สำหรับ ${p.assetName || "ครุภัณฑ์"} ที่ ${p.locationLabel} ครบกำหนดวันที่ ${p.nextDueAt ? p.nextDueAt.slice(0, 10) : ""} แล้ว โปรดดำเนินการให้เร็วที่สุด`,
    cta: "เปิดดูและบันทึกผล PM",
  },
  pm_completion_log: {
    badge: "บันทึกผล PM",
    badgeColor: "#257a57",
    title: "มีการบันทึกผลการตรวจเช็ค PM",
    intro: (p) =>
      `ผู้ปฏิบัติงาน ${p.actionByName || "ช่าง"} ได้บันทึกผลการตรวจเช็ค PM สำหรับ ${p.assetName || "ครุภัณฑ์"} ที่ ${p.locationLabel} เรียบร้อยแล้ว`,
    cta: "ดูรายละเอียดการบันทึกผล",
  },
  user_account_approved: {
    badge: "บัญชีอนุมัติแล้ว",
    badgeColor: "#257a57",
    title: "บัญชีผู้ใช้ของคุณได้รับอนุมัติแล้ว",
    intro: (p) =>
      `บัญชีผู้ใช้ของคุณได้รับอนุมัติในบทบาท ${p.userRole || "ผู้ใช้"} แล้ว คุณสามารถเข้าใช้งานระบบได้ทันที`,
    cta: "เข้าสู่ระบบ ISRI",
  },
  user_account_rejected: {
    badge: "บัญชีไม่อนุมัติ",
    badgeColor: "#ba3d3d",
    title: "บัญชีผู้ใช้ของคุณไม่ได้รับอนุมัติ",
    intro: (p) =>
      `บัญชีผู้ใช้ของคุณไม่ได้รับอนุมัติ ${p.rejectionReason ? `เหตุผล: ${p.rejectionReason}` : ""}`,
    cta: "ติดต่อผู้ดูแลระบบ",
  },
  campaign_started: {
    badge: "แคมเปญเริ่มต้น",
    badgeColor: "#5b3ea4",
    title: "แคมเปญใหม่เริ่มต้นแล้ว",
    intro: (p) =>
      `แคมเปญ "${p.campaignName || "แคมเปญ"}" เริ่มต้นแล้ว! สะสมคะแนนเพื่อรับรางวัลพิเศษ`,
    cta: "ดูรายละเอียดแคมเปญ",
  },
  campaign_ending_soon: {
    badge: "แคมเปญใกล้สิ้นสุด",
    badgeColor: "#a76810",
    title: "แคมเปญใกล้สิ้นสุดแล้ว",
    intro: (p) =>
      `แคมเปญ "${p.campaignName || "แคมเปญ"}" จะสิ้นสุดในวันที่ ${p.campaignEndDate ? p.campaignEndDate.slice(0, 10) : "เร็วๆ นี้"} สะสมคะแนนให้ครบก่อนจะสายเกินไป!`,
    cta: "ดูอันดับและคะแนน",
  },
  campaign_ended: {
    badge: "แคมเปญสิ้นสุด",
    badgeColor: "#365f91",
    title: "แคมเปญสิ้นสุดแล้ว",
    intro: (p) =>
      `แคมเปญ "${p.campaignName || "แคมเปญ"}" สิ้นสุดแล้ว ขอบคุณที่ร่วมสนุก! ตรวจสอบผู้ชนะและรางวัลได้ที่หน้าแคมเปญ`,
    cta: "ดูผลสรุปแคมเปญ",
  },
};

export function renderWorkflowEmail(
  eventKey: EmailEventKey,
  payload: WorkflowEmailPayload,
): RenderedWorkflowEmail {
  const config = configByEvent[eventKey];
  const isPm =
    eventKey === "pm_schedule_assigned" ||
    eventKey === "pm_schedule_updated" ||
    eventKey === "pm_due_soon" ||
    eventKey === "pm_overdue" ||
    eventKey === "pm_completion_log";
  const isReward = eventKey.startsWith("reward_redemption");
  const isUserAccount = eventKey.startsWith("user_account");
  const isCampaign = eventKey.startsWith("campaign");

  let subject: string;
  if (payload.ticketNumber) {
    subject = `[ISRI] ${config.title} · ${payload.ticketNumber}`;
  } else if (isReward) {
    subject = `[ISRI] ${config.title} · ${payload.rewardName || "รางวัล"}`;
  } else if (isCampaign) {
    subject = `[ISRI] ${config.title} · ${payload.campaignName || "แคมเปญ"}`;
  } else if (isPm) {
    subject = `[ISRI] ${config.title} · ${payload.assetName || "PM"} (${payload.locationLabel})`;
  } else {
    subject = `[ISRI] ${config.title}`;
  }

  let detailRows: Array<[string, string | null | undefined]>;

  if (isReward) {
    detailRows = [
      ["รางวัล", payload.rewardName],
      ["คะแนนที่ใช้", payload.pointCost ? `${payload.pointCost} คะแนน` : null],
      [
        "วิธีรับ",
        payload.fulfillmentMethod === "delivery" ? "จัดส่ง" : "รับเอง",
      ],
      ["ชื่อผู้รับ", payload.recipientContactName],
      [
        "สถานะปัจจุบัน",
        eventKey === "reward_redemption_approved"
          ? "อนุมัติแล้ว"
          : eventKey === "reward_redemption_fulfilled"
            ? "ส่งมอบแล้ว"
            : eventKey === "reward_redemption_cancelled"
              ? "ยกเลิกแล้ว"
              : "รออนุมัติ",
      ],
      [
        "คะแนนคงเหลือ",
        payload.balanceRemaining ? `${payload.balanceRemaining} คะแนน` : null,
      ],
      ["หมายเหตุ", payload.note],
      ["เหตุผลการยกเลิก", payload.rejectionReason],
    ].filter(([, value]) => Boolean(value && String(value).trim()));
  } else if (isUserAccount) {
    detailRows = [
      ["บทบาท", payload.userRole],
      ["ชื่อผู้ใช้", payload.recipientName],
      ["เหตุผลการปฏิเสธ", payload.rejectionReason],
    ].filter(([, value]) => Boolean(value && String(value).trim()));
  } else if (isCampaign) {
    detailRows = [
      ["ชื่อแคมเปญ", payload.campaignName],
      [
        "วันสิ้นสุด",
        payload.campaignEndDate ? payload.campaignEndDate.slice(0, 10) : null,
      ],
    ].filter(([, value]) => Boolean(value && String(value).trim()));
  } else if (isPm) {
    detailRows = [
      ["ครุภัณฑ์/อุปกรณ์", payload.assetName],
      ["สถานที่", payload.locationLabel],
      [
        "รอบการตรวจเช็ค",
        payload.intervalMonths ? `ทุก ${payload.intervalMonths} เดือน` : null,
      ],
      [
        "ครบกำหนดรอบถัดไป",
        payload.nextDueAt ? payload.nextDueAt.slice(0, 10) : null,
      ],
      ["รายละเอียดแผนงาน", payload.note],
      ["ผู้ปฏิบัติงาน", payload.actionByName],
      [
        "คะแนนที่ได้รับ",
        payload.pointsEarned ? `${payload.pointsEarned} คะแนน` : null,
      ],
      [
        "ยอดคงเหลือ",
        payload.balanceRemaining ? `${payload.balanceRemaining} คะแนน` : null,
      ],
    ].filter(([, value]) => Boolean(value && String(value).trim()));
  } else {
    detailRows = [
      ["เลขที่แจ้ง", payload.ticketNumber],
      ["ผู้แจ้งเหตุ", payload.reporterName],
      ["สถานที่", payload.locationLabel],
      ["อุปกรณ์/จุดแจ้ง", payload.assetName],
      ["ประเภทปัญหา", payload.category],
      ["ระดับความเร่งด่วน", payload.urgencyLabel],
      ["ผู้ดำเนินการ", payload.actionByName],
      ["รายละเอียดเพิ่มเติม", payload.note],
    ].filter(([, value]) => Boolean(value && String(value).trim()));
  }

  const intro = config.intro(payload);
  const htmlRows = detailRows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #e8ebf2">
            <div style="color:#6b7280;font-size:11px;font-weight:700;letter-spacing:.35px;line-height:16px;text-transform:uppercase">${escapeHtml(String(label))}</div>
            <div style="margin-top:3px;color:#17203d;font-size:14px;font-weight:600;line-height:21px">${escapeHtml(String(value))}</div>
          </td>
        </tr>`,
    )
    .join("");
  const plainDetails = detailRows
    .map(([label, value]) => `${label}: ${String(value)}`)
    .join("\n");
  const safeUrl = escapeAttribute(payload.actionUrl);

  let cardHeaderTitle: string;
  if (payload.ticketNumber) {
    cardHeaderTitle = `รายละเอียดรายการ · ${escapeHtml(payload.ticketNumber)}`;
  } else if (isReward) {
    cardHeaderTitle = `รายละเอียดการแลกรางวัล · ${escapeHtml(payload.rewardName || "")}`;
  } else if (isCampaign) {
    cardHeaderTitle = `รายละเอียดแคมเปญ · ${escapeHtml(payload.campaignName || "")}`;
  } else if (isPm) {
    cardHeaderTitle = `รายละเอียดรอบตรวจเช็ค PM · ${escapeHtml(payload.assetName || "")}`;
  } else {
    cardHeaderTitle = `รายละเอียด`;
  }

  const gcalHtml = payload.googleCalendarUrl
    ? `
            <div style="margin-bottom:12px">
              <a href="${escapeAttribute(payload.googleCalendarUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;background:#ffffff;border:1.5px solid #1a73e8;border-radius:8px;color:#1a73e8;font-size:14px;font-weight:700;line-height:20px;padding:12px 18px;text-align:center;text-decoration:none">
                📅 เพิ่มลง Google Calendar
              </a>
            </div>`
    : "";

  return {
    subject,
    text: [
      "ISRI | ระบบแจ้งปัญหาโครงสร้างพื้นฐาน",
      config.badge,
      config.title,
      `สวัสดี ${payload.recipientName}`,
      intro,
      plainDetails,
      payload.googleCalendarUrl
        ? `เพิ่มลง Google Calendar: ${payload.googleCalendarUrl}`
        : null,
      `เปิดรายการ: ${payload.actionUrl}`,
      "อีเมลนี้ส่งจากระบบ ISRI โดยอัตโนมัติ โปรดอย่าตอบกลับอีเมลนี้",
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `<!doctype html>
<html lang="th">
  <body style="margin:0;padding:0;background:#f3f5f9;color:#17203d;font-family:Arial,'Tahoma','Noto Sans Thai',sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5f9">
      <tr><td align="center" style="padding:28px 16px">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dfe4ee;border-radius:12px;overflow:hidden">
          <tr><td style="padding:22px 30px;background:#17203d">
            <div style="color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;letter-spacing:.3px;line-height:28px">ISRI</div>
            <div style="margin-top:4px;color:#cbd3e4;font-size:11px;line-height:16px">Infrastructure Safety Reporting &amp; Incentive System</div>
          </td></tr>
          <tr><td style="height:4px;background:#5b3ea4;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td style="padding:28px 30px 10px">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="padding:5px 10px;border-radius:999px;background:${config.badgeColor}18;color:${config.badgeColor};font-size:12px;font-weight:700;line-height:16px">${escapeHtml(config.badge)}</td>
            </tr></table>
            <h1 style="margin:16px 0 8px;color:#17203d;font-size:24px;line-height:32px;font-weight:700">${escapeHtml(config.title)}</h1>
            <p style="margin:0;color:#525d70;font-size:14px;line-height:23px">สวัสดี ${escapeHtml(payload.recipientName)}<br>${escapeHtml(intro)}</p>
          </td></tr>
          <tr><td style="padding:18px 30px 12px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e0e5ee;border-radius:9px;overflow:hidden">
              <tr><td style="padding:13px 16px;background:#f7f8fb;border-bottom:1px solid #e0e5ee;color:#17203d;font-size:12px;font-weight:700;line-height:18px">${cardHeaderTitle}</td></tr>
              <tr><td style="padding:0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${htmlRows}</table></td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 30px 30px">
            ${gcalHtml}
            <a href="${safeUrl}" style="display:block;background:#5b3ea4;border-radius:8px;color:#ffffff;font-size:14px;font-weight:700;line-height:20px;padding:13px 18px;text-align:center;text-decoration:none">${escapeHtml(config.cta)}</a>
          </td></tr>
          <tr><td style="padding:16px 30px;background:#fafbfc;border-top:1px solid #e8ebf2;color:#7a8494;font-size:11px;line-height:17px;text-align:center">
            แจ้งเตือนอัตโนมัติจากระบบ ISRI · โปรดอย่าตอบกลับอีเมลฉบับนี้
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

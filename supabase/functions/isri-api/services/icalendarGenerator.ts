export interface PmCalendarInput {
  scheduleId: string;
  assetName: string;
  locationLabel: string;
  planDetails: string;
  intervalMonths: number;
  nextDueAt: string;
  appUrl: string;
  technicianName: string;
  technicianEmail: string;
  organizerEmail: string;
  sequence?: number;
}

export interface GeneratedPmCalendar {
  icsContent: string;
  base64Ics: string;
  googleCalendarUrl: string;
}

function formatIcsDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function toBase64(content: string): string {
  return btoa(unescape(encodeURIComponent(content)));
}

export function generatePmCalendarInvite(
  input: PmCalendarInput,
): GeneratedPmCalendar {
  const targetDate = new Date(input.nextDueAt);
  const now = new Date();

  // Set default schedule time: 09:00 - 10:00 Bangkok time (02:00 - 03:00 UTC)
  const startTime = new Date(targetDate);
  startTime.setUTCHours(2, 0, 0, 0);

  const endTime = new Date(startTime);
  endTime.setUTCHours(3, 0, 0, 0);

  const dtstamp = formatIcsDateTime(now);
  const dtstart = formatIcsDateTime(startTime);
  const dtend = formatIcsDateTime(endTime);

  const summary = `[ISRI-PM] ${input.assetName} · ${input.locationLabel}`;
  const actionUrl = `${input.appUrl.replace(/\/$/, "")}/pm/${input.scheduleId}/complete`;
  const descriptionText =
    `แผนบำรุงรักษาเชิงป้องกัน (PM)\n` +
    `ครุภัณฑ์: ${input.assetName}\n` +
    `สถานที่: ${input.locationLabel}\n` +
    `รอบการตรวจเช็ค: ทุก ${input.intervalMonths} เดือน\n` +
    `รายละเอียดงาน: ${input.planDetails}\n\n` +
    `บันทึกผลการตรวจเช็คได้ที่: ${actionUrl}`;

  const cleanTechnicianName = input.technicianName.replace(/[;,\r\n]/g, " ").trim();
  const cleanTechnicianEmail = input.technicianEmail.trim();
  const cleanOrganizerEmail = input.organizerEmail.trim() || "noreply@isri.local";
  const sequence = input.sequence ?? 0;

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ISRI//Preventive Maintenance Calendar//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:pm-${input.scheduleId}@isri.local`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `RRULE:FREQ=MONTHLY;INTERVAL=${Math.max(1, input.intervalMonths)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(descriptionText)}`,
    `LOCATION:${escapeIcsText(input.locationLabel)}`,
    "STATUS:CONFIRMED",
    `SEQUENCE:${sequence}`,
    `ORGANIZER;CN=ISRI System:mailto:${cleanOrganizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${escapeIcsText(cleanTechnicianName)}:mailto:${cleanTechnicianEmail}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:เตือนความจำรอบตรวจเช็ค PM ${escapeIcsText(input.assetName)} ในวันพรุ่งนี้`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  const icsContent = icsLines.join("\r\n");
  const base64Ics = toBase64(icsContent);

  // Generate Google Calendar Web Quick Link
  const gcalParams = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${dtstart}/${dtend}`,
    details: descriptionText,
    location: input.locationLabel,
    recur: `RRULE:FREQ=MONTHLY;INTERVAL=${Math.max(1, input.intervalMonths)}`,
  });
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;

  return {
    icsContent,
    base64Ics,
    googleCalendarUrl,
  };
}

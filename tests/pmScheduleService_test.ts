import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { HttpError } from "../supabase/functions/isri-api/_shared/http.ts";
import { parsePmScheduleInput } from "../supabase/functions/isri-api/services/pmScheduleService.ts";
import { generatePmCalendarInvite } from "../supabase/functions/isri-api/services/icalendarGenerator.ts";
import { renderWorkflowEmail } from "../supabase/functions/isri-api/services/workflowEmailTemplate.ts";

const validInput = {
  locationId: "11111111-1111-4111-8111-111111111111",
  assetName: "เครื่องปรับอากาศห้องตรวจ",
  planDetails: "ตรวจสอบสภาพ ทำความสะอาด และทดสอบการทำงานตามรอบ",
  intervalMonths: 3,
  lastDoneAt: "2026-08-01T02:00:00.000Z",
  assignedTechnicianId: "22222222-2222-4222-8222-222222222222",
};

Deno.test("parsePmScheduleInput returns validated PM plan data", () => {
  const result = parsePmScheduleInput(validInput);

  assertEquals(result.assetName, validInput.assetName);
  assertEquals(result.planDetails, validInput.planDetails);
  assertEquals(result.intervalMonths, 3);
  assertEquals(result.assignedTechnicianId, validInput.assignedTechnicianId);
});

Deno.test("parsePmScheduleInput rejects an invalid technician ID format", () => {
  assertThrows(
    () =>
      parsePmScheduleInput({
        ...validInput,
        assignedTechnicianId: "invalid-uuid",
      }),
    HttpError,
    "PM assigned technician",
  );
});

Deno.test("parsePmScheduleInput rejects an incomplete PM plan", () => {
  assertThrows(
    () => parsePmScheduleInput({ ...validInput, planDetails: "สั้น" }),
    HttpError,
    "PM plan details",
  );
});

Deno.test("parsePmScheduleInput rejects a future execution date", () => {
  assertThrows(
    () =>
      parsePmScheduleInput({
        ...validInput,
        lastDoneAt: "2099-08-01T02:00:00.000Z",
      }),
    HttpError,
    "PM completion date",
  );
});

Deno.test("generatePmCalendarInvite creates valid iCalendar with monthly RRULE and Google link", () => {
  const calendar = generatePmCalendarInvite({
    scheduleId: "80000000-0000-0000-0000-000000000001",
    assetName: "เครื่องปรับอากาศ Daikin",
    locationLabel: "อาคารอำนวยการ · ชั้น 2",
    planDetails: "ล้างแผงคอยล์เย็น ตรวจเช็คน้ำยาแอร์",
    intervalMonths: 1,
    nextDueAt: "2026-10-01T00:00:00.000Z",
    appUrl: "https://isri.example",
    technicianName: "สมชาย พรหมรักษา",
    technicianEmail: "somchai.electric@isri.local",
    organizerEmail: "noreply@isri.example",
  });

  assertStringIncludes(calendar.icsContent, "BEGIN:VCALENDAR");
  assertStringIncludes(calendar.icsContent, "METHOD:REQUEST");
  assertStringIncludes(calendar.icsContent, "RRULE:FREQ=MONTHLY;INTERVAL=1");
  assertStringIncludes(calendar.icsContent, "SUMMARY:[ISRI-PM] เครื่องปรับอากาศ Daikin · อาคารอำนวยการ · ชั้น 2");
  assertStringIncludes(calendar.icsContent, "ATTENDEE;CUTYPE=INDIVIDUAL");
  assertStringIncludes(calendar.icsContent, "somchai.electric@isri.local");
  assertStringIncludes(calendar.googleCalendarUrl, "calendar.google.com/calendar/render");
  assertStringIncludes(calendar.googleCalendarUrl, "RRULE%3AFREQ%3DMONTHLY%3BINTERVAL%3D1");
});

Deno.test("renderWorkflowEmail formats PM schedule assignment with Google Calendar link", () => {
  const email = renderWorkflowEmail("pm_schedule_assigned", {
    recipientName: "สมชาย พรหมรักษา",
    locationLabel: "อาคารอำนวยการ · ชั้น 2",
    assetName: "เครื่องปรับอากาศ Daikin",
    intervalMonths: 1,
    nextDueAt: "2026-10-01T00:00:00.000Z",
    note: "ตรวจเช็คน้ำยาและล้างแผง",
    actionUrl: "https://isri.example/pm/test-id/complete",
    googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=test",
  });

  assertStringIncludes(email.subject, "รอบตรวจเช็ค PM");
  assertStringIncludes(email.subject, "เครื่องปรับอากาศ Daikin");
  assertStringIncludes(email.html, "แผนงาน PM");
  assertStringIncludes(email.html, "เพิ่มลง Google Calendar (1-Click)");
  assertStringIncludes(email.text, "เพิ่มลง Google Calendar: https://calendar.google.com");
});

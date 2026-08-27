import { assertEquals, assertThrows } from "jsr:@std/assert";
import { HttpError } from "../supabase/functions/isri-api/_shared/http.ts";
import { parsePmScheduleInput } from "../supabase/functions/isri-api/services/pmScheduleService.ts";

const validInput = {
  locationId: "11111111-1111-4111-8111-111111111111",
  assetName: "เครื่องปรับอากาศห้องตรวจ",
  planDetails: "ตรวจสอบสภาพ ทำความสะอาด และทดสอบการทำงานตามรอบ",
  intervalMonths: 3,
  lastDoneAt: "2026-08-01T02:00:00.000Z",
};

Deno.test("parsePmScheduleInput returns validated PM plan data", () => {
  const result = parsePmScheduleInput(validInput);

  assertEquals(result.assetName, validInput.assetName);
  assertEquals(result.planDetails, validInput.planDetails);
  assertEquals(result.intervalMonths, 3);
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

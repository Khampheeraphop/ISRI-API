import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { renderWorkflowEmail } from "../supabase/functions/isri-api/services/workflowEmailTemplate.ts";

Deno.test(
  "workflow email uses the ISRI shared layout with escaped incident details",
  () => {
    const email = renderWorkflowEmail("parts_requested", {
      recipientName: "ผู้จัดสรรงาน",
      reporterName: "ผู้แจ้ง <ทดสอบ>",
      ticketNumber: "ISRI-202608-000001",
      locationLabel: "อาคารผู้ป่วยนอก · ชั้น 2 · โถงหน้าห้องตรวจ",
      assetName: "เครื่องปรับอากาศ",
      category: "เครื่องปรับอากาศ",
      urgencyLabel: "เร่งด่วน",
      note: "ขอเบิกอะไหล่ <filter>",
      actionUrl: "https://isri.example/dispatch/reviews?workOrderId=test",
    });

    assertStringIncludes(email.subject, "มีคำขอเบิกอะไหล่รออนุมัติ");
    assertStringIncludes(email.html, ">ISRI<");
    assertStringIncludes(email.html, "ผู้แจ้ง &lt;ทดสอบ&gt;");
    assertStringIncludes(email.html, "ขอเบิกอะไหล่ &lt;filter&gt;");
    assertStringIncludes(email.text, "โปรดอย่าตอบกลับอีเมลนี้");
    assert(!email.html.includes("ผู้แจ้ง <ทดสอบ>"));
    assertEquals(email.subject.includes("ISRI-202608-000001"), true);
  },
);

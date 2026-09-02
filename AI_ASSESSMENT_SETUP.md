# ISRI AI Safety Assistant

ฟีเจอร์นี้เป็นผู้ช่วยสำหรับ Dispatcher เท่านั้น และแยกออกจาก workflow หลักโดยตั้งใจ

- AI อ่านรายละเอียด ตำแหน่ง และภาพประกอบสูงสุด 3 ภาพ โดยภาพไม่ใช่ข้อมูลบังคับ
- AI ส่งคืนข้อสังเกตแบบมีโครงสร้าง เช่น ประเภท สัญญาณอันตราย หลักฐาน และข้อมูลที่ยังขาด
- กฎใน `aiIncidentAssessmentService.ts` แปลง hazard เป็นระดับแนะนำ
- Dispatcher ยังคงเป็นผู้ยืนยันระดับจริงก่อนสร้าง Work Order
- ผลวิเคราะห์ถูกเก็บใน `ai_incident_assessments` และไม่แก้ `incidents`, SLA, แต้ม หรือสถานะงาน

ถ้าปิด UI ด้วย `VITE_AI_ASSESSMENT_ENABLED=false` ระบบแจ้งเหตุและมอบหมายงานยังทำงานเหมือนเดิม ตารางและ endpoint ของ AI สามารถคงอยู่ได้โดยไม่กระทบระบบหลัก

## Secrets

ห้ามใส่ OpenAI API key ใน `web` หรือ commit ลง Git

สำหรับ local development สร้างไฟล์ `supabase/functions/.env` ซึ่งถูก ignore แล้ว:

```env
OPENAI_API_KEY=<your-openai-api-key>
OPENAI_MODEL=gpt-5.6-luna
```

เมื่อรัน `supabase start` ไฟล์นี้จะถูกโหลดให้ Edge Functions อัตโนมัติ หรือระบุไฟล์เองเมื่อใช้ `supabase functions serve --env-file <path>`

สำหรับ Supabase Cloud:

```powershell
npx supabase secrets set OPENAI_API_KEY=<your-openai-api-key> --project-ref nzwtybjijnreeylbmjlp
npx supabase secrets set OPENAI_MODEL=gpt-5.6-luna --project-ref nzwtybjijnreeylbmjlp
```

จากนั้น deploy migration และ Edge Function โดยคง JWT verification:

```powershell
npx supabase functions deploy isri-ai-assessment --project-ref nzwtybjijnreeylbmjlp
```

ฟังก์ชันนี้แยกจาก `isri-api` จึงไม่ต้อง deploy หรือแทนที่ API หลักเมื่อแก้เฉพาะฟีเจอร์ AI

## API

เฉพาะบัญชี Dispatcher ที่อนุมัติแล้วเท่านั้น:

- `GET /functions/v1/isri-ai-assessment?incidentId=:id` อ่านผลล่าสุด หรือได้ `null`
- `POST /functions/v1/isri-ai-assessment?incidentId=:id` วิเคราะห์ใหม่และบันทึกเป็นประวัติใหม่

API key อยู่ใน Edge Function เท่านั้น Browser เรียก `isri-ai-assessment` ด้วย Supabase user JWT และ function ตรวจ role Dispatcher ซ้ำอีกชั้น

## Privacy และข้อจำกัด

- ไม่ส่งชื่อ อีเมล หรือข้อมูลบัญชีผู้แจ้งไปยังโมเดล
- รูปและข้อความอาจมีข้อมูลที่ผู้ใช้ถ่ายหรือนำมาใส่เอง จึงควรหลีกเลี่ยงใบหน้า ป้ายผู้ป่วย และข้อมูลสุขภาพ
- คำขอใช้ `store: false`
- ค่า confidence เป็นค่าที่โมเดลประเมินเอง ไม่ใช่ความน่าจะเป็นที่สอบเทียบแล้ว
- เมื่อข้อมูลไม่ชัด ระบบคืน `suggestedUrgency = null` เพื่อให้คนตรวจ

อ้างอิง: [OpenAI Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)

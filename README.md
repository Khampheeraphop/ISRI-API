# ISRI API

Supabase เป็น backend ของระบบ ISRI โดย browser ใช้เฉพาะ publishable key และเรียกข้อมูลผ่าน Edge Function `isri-api` ส่วน `service_role` อยู่ฝั่ง server เท่านั้น

## ขอบเขตสิทธิ์

- Reporter แจ้งและติดตามรายการของตนเอง สะสมแต้ม และแลกรางวัล แต่ไม่เห็น Leaderboard
- Dispatcher ตรวจสอบระดับความเร่งด่วน มอบหมายช่าง และตรวจรับงาน
- Technician ทำงานที่ได้รับมอบหมายและบันทึก PM
- Admin จัดการผู้ใช้ SLA PM ตำแหน่ง QR ของรางวัล การส่งมอบรางวัล แคมเปญ และ Dashboard แต่ไม่ทำหน้าที่ Dispatcher

ผู้ใช้ Google ใหม่ยังเข้าใช้ฟังก์ชันงานไม่ได้จนกว่าจะได้รับอนุมัติ ไม่จำกัดโดเมนอีเมล Admin สามารถเลือกหลายบัญชีที่รออนุมัติและอนุมัติเป็น Reporter พร้อมกันได้ ส่วนสิทธิ์ Technician, Dispatcher และ Admin ต้องตรวจรายบุคคล

## Local Supabase แบบสร้างใหม่ได้ทั้งหมด

ต้องติดตั้ง Docker Desktop และ Node.js 22 ขึ้นไป จากนั้นรันในโฟลเดอร์ `api`:

```powershell
npx supabase start
npx supabase db reset
```

`supabase start` เปิด Edge Function Local ให้ด้วย ส่วน `db reset` จะล้างฐานข้อมูล local ใช้ migration ทั้งหมดสร้าง schema ใหม่ แล้วรัน `supabase/seed.sql` หลัง migration ตามลำดับ ข้อมูลสาธิตครอบคลุมผู้ใช้ทุกบทบาท ผู้ใช้รออนุมัติ/ถูกปฏิเสธ ตำแหน่ง QR เหตุแจ้ง งานช่างทุกสถานะ SLA PM แต้ม รางวัล การส่งมอบ แคมเปญ และการแจ้งเตือน

บัญชี local สำหรับสาธิตใช้รหัสผ่านเดียวกัน `IsriDemo123!`:

| บทบาท | อีเมล |
|---|---|
| Admin | `admin@isri.local` |
| Dispatcher | `siriporn.dispatcher@isri.local` |
| Technician | `somchai.electric@isri.local` |
| Technician | `anucha.maintenance@isri.local` |
| Reporter | `nattaya.nurse@isri.local` |
| Reporter | `kanokwan.records@isri.local` |
| Reporter | `pimchanok.pharmacy@isri.local` |
| รออนุมัติ | `thitiporn.pending@isri.local` |
| ถูกปฏิเสธ | `wittaya.external@isri.local` |

บัญชีเหล่านี้มีไว้สำหรับ local development เท่านั้น ระบบ production ใช้ Google OAuth และไม่ใช้รหัสผ่าน seed

หลัง `npx supabase start` ให้ใช้ URL และ publishable/anon key จาก `npx supabase status -o env` ใน `web/.env.local`

## Google OAuth บน Cloud

1. เปิด Google provider ใน Supabase Dashboard
2. เพิ่ม callback URL ของ Supabase ใน Google Cloud OAuth client
3. เพิ่ม URL เว็บและ `/auth/callback` ใน Auth URL Configuration
4. Deploy migrations และ function
5. `poplowplay1@gmail.com` เข้าด้วย Google ครั้งแรกและได้รับสิทธิ์ Admin อัตโนมัติ
6. ผู้ใช้รายอื่นเข้าสู่ระบบครั้งแรก กรอกตำแหน่ง แล้วรอ Admin อนุมัติ

การ seed ไม่สร้างรหัสผ่านให้ Gmail จริง เพราะ token และตัวตน OAuth ต้องมาจาก Google ตาราง `bootstrap_admins` เก็บอีเมลผู้ดูแลเริ่มต้นและไม่เปิดให้ browser อ่าน

คู่มือ Local, Production, Google OAuth, Vercel/Nginx และเช็กลิสต์หลัง Deploy อยู่ที่ [DEPLOYMENT_GUIDE.md](../web/DEPLOYMENT_GUIDE.md)

## Realtime

Migration เปิด Realtime เฉพาะตาราง `notifications` และมี RLS ให้ผู้ใช้รับเฉพาะรายการของตนเอง หน้าเว็บจะ refetch notification เมื่อมี INSERT/UPDATE/DELETE โดยไม่ได้เปิดทุกตาราง ลดจำนวนข้อความและการตรวจสิทธิ์ที่ไม่จำเป็น

## ตรวจคุณภาพ

```powershell
.\.tools\deno.exe task check
.\.tools\deno.exe task test
npx supabase db reset
npx supabase migration list --local
```

หาก Docker Desktop ไม่ทำงาน จะรัน `db reset` ไม่ได้ แต่ยังตรวจ TypeScript และ unit tests ได้

## Workflow หลัก

1. Reporter สแกน QR และแจ้งปัญหา โดยระดับความเร่งด่วนเป็นเพียงการประเมินเบื้องต้น
2. Dispatcher ตรวจรายละเอียด เลือกระดับที่ยืนยัน และมอบหมาย Technician ในธุรกรรมเดียว
3. SLA และแต้มยึดระดับที่ Dispatcher ยืนยัน ป้องกันการเลือกระดับวิกฤตเพื่อปั่นแต้ม
4. Technician ดำเนินงานและส่งผลให้ Dispatcher ตรวจรับ
5. เมื่อปิดงาน ระบบให้แต้มครั้งเดียว
6. Reporter เลือกรับรางวัลด้วยตนเองหรือจัดส่ง พร้อมข้อมูลผู้รับ
7. Admin บันทึกส่งมอบ หรือยกเลิกเพื่อคืนแต้มและสต็อกในธุรกรรมเดียว

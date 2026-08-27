-- ISRI deterministic demonstration data
-- Run automatically by `supabase db reset` after every migration.
-- This dataset is fictional but uses realistic hospital operations. Images are
-- intentionally omitted so they can be uploaded through the application.

-- Keep manual SQL Editor runs atomic: any error rolls back the entire dataset.
begin;

-- ---------------------------------------------------------------------------
-- 1. System configuration
-- ---------------------------------------------------------------------------
-- Production Google role map (created from Google on first sign-in; never
-- insert Google users into auth.users here):
--   khampheeraphop.thon@gmail.com            = administrator
--   khampheeraphop.thon@northbkk.ac.th       = dispatcher
--   poplowplay5@gmail.com                    = technician
--   poplowplay1@gmail.com                    = reporter
-- Only the administrator is bootstrapped automatically. The other three
-- accounts must be approved by an administrator after their first sign-in.
insert into public.bootstrap_admins (email, display_name)
values ('khampheeraphop.thon@gmail.com', 'ผู้ดูแลระบบหลัก')
on conflict (email) do update set display_name = excluded.display_name;

insert into public.sla_rules (urgency_level, response_minutes, resolve_minutes, point_value)
values
  ('critical', 30, 240, 30),
  ('urgent', 120, 1440, 20),
  ('normal', 1440, 4320, 10)
on conflict (urgency_level) do update
set response_minutes = excluded.response_minutes,
    resolve_minutes = excluded.resolve_minutes,
    point_value = excluded.point_value,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Development and disposable demo accounts
-- ---------------------------------------------------------------------------
-- All local accounts use IsriDemo123! and the reserved .local domain. They are
-- for development/demo testing only and must never replace Google OAuth in production.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"ผู้ดูแลระบบท้องถิ่น"}', now() - interval '180 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'siriporn.dispatcher@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"ศิริพร วัฒนกิจ"}', now() - interval '170 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'somchai.electric@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"สมชาย พรหมรักษา"}', now() - interval '160 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'anucha.maintenance@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"อนุชา เกียรติช่าง"}', now() - interval '155 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'nattaya.nurse@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"ณัฐยา ศรีสุข"}', now() - interval '140 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'kanokwan.records@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"กนกวรรณ มีสุข"}', now() - interval '130 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'pimchanok.pharmacy@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"พิมพ์ชนก รัตนวงศ์"}', now() - interval '120 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'thitiporn.pending@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"ฐิติพร แสงทอง"}', now() - interval '2 days', now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'wittaya.external@isri.local', crypt('IsriDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"วิทยา มั่นคง"}', now() - interval '10 days', now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select id, id::text, id,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), created_at, now()
from auth.users
where id::text like '10000000-0000-0000-0000-00000000000%'
on conflict (provider_id, provider) do nothing;

update public.profiles set approval_status = 'approved', role = 'admin',
  requested_position = 'ผู้ดูแลระบบ', approved_by = id, approved_at = now() - interval '180 days'
where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set approval_status = 'approved', role = 'dispatcher',
  requested_position = 'หัวหน้าหน่วยซ่อมบำรุง', approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now() - interval '169 days'
where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set approval_status = 'approved', role = 'technician',
  requested_position = 'นายช่างไฟฟ้า', technician_specialties = array['electrical','elevator']::public.technician_specialty[], approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now() - interval '159 days'
where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set approval_status = 'approved', role = 'technician',
  requested_position = 'นายช่างซ่อมบำรุง', technician_specialties = array['plumbing','air_conditioning','building']::public.technician_specialty[], approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now() - interval '154 days'
where id = '10000000-0000-0000-0000-000000000004';
update public.profiles set approval_status = 'approved', role = 'reporter',
  requested_position = 'พยาบาลวิชาชีพ', approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now() - interval '139 days'
where id = '10000000-0000-0000-0000-000000000005';
update public.profiles set approval_status = 'approved', role = 'reporter',
  requested_position = 'เจ้าพนักงานเวชสถิติ', approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now() - interval '129 days'
where id = '10000000-0000-0000-0000-000000000006';
update public.profiles set approval_status = 'approved', role = 'reporter',
  requested_position = 'เภสัชกรปฏิบัติการ', approved_by = '10000000-0000-0000-0000-000000000001', approved_at = now() - interval '119 days'
where id = '10000000-0000-0000-0000-000000000007';
update public.profiles set requested_position = 'เจ้าหน้าที่ธุรการ'
where id = '10000000-0000-0000-0000-000000000008';
update public.profiles set approval_status = 'rejected', role = null,
  requested_position = 'ผู้รับเหมาภายนอก', rejection_reason = 'ระบบเปิดให้ใช้งานเฉพาะบุคลากรภายในสถานพยาบาล'
where id = '10000000-0000-0000-0000-000000000009';

insert into public.user_approval_history (id, user_id, action, role, specialties, note, acted_by, created_at)
values
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'approved', 'dispatcher', '{}', 'อนุมัติให้รับผิดชอบการตรวจสอบและจัดสรรงาน', '10000000-0000-0000-0000-000000000001', now() - interval '169 days'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'approved', 'technician', array['electrical','elevator']::public.technician_specialty[], 'อนุมัติตามขอบเขตงานช่างไฟฟ้า', '10000000-0000-0000-0000-000000000001', now() - interval '159 days'),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'approved', 'technician', array['plumbing','air_conditioning','building']::public.technician_specialty[], 'อนุมัติตามขอบเขตงานซ่อมบำรุงอาคาร', '10000000-0000-0000-0000-000000000001', now() - interval '154 days'),
  ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'approved', 'reporter', '{}', 'ตรวจสอบสถานะบุคลากรแล้ว', '10000000-0000-0000-0000-000000000001', now() - interval '139 days'),
  ('11000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'approved', 'reporter', '{}', 'ตรวจสอบสถานะบุคลากรแล้ว', '10000000-0000-0000-0000-000000000001', now() - interval '129 days'),
  ('11000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'approved', 'reporter', '{}', 'ตรวจสอบสถานะบุคลากรแล้ว', '10000000-0000-0000-0000-000000000001', now() - interval '119 days'),
  ('11000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009', 'rejected', null, '{}', 'ระบบเปิดให้ใช้งานเฉพาะบุคลากรภายในสถานพยาบาล', '10000000-0000-0000-0000-000000000001', now() - interval '9 days');

-- ---------------------------------------------------------------------------
-- 3. QR locations and maintained assets
-- ---------------------------------------------------------------------------
insert into public.managed_locations (id, code, building, floor, zone, asset_name)
values
  ('20000000-0000-0000-0000-000000000001', 'OPD-F1-REG', 'อาคารผู้ป่วยนอก', 'ชั้น 1', 'จุดลงทะเบียน', 'ระบบไฟฟ้าจุดบริการ'),
  ('20000000-0000-0000-0000-000000000002', 'OPD-F2-EXAM', 'อาคารผู้ป่วยนอก', 'ชั้น 2', 'โถงหน้าห้องตรวจ', 'เครื่องปรับอากาศแบบแยกส่วน'),
  ('20000000-0000-0000-0000-000000000003', 'IPD-F3-WARD', 'อาคารผู้ป่วยใน', 'ชั้น 3', 'หอผู้ป่วยอายุรกรรม', 'ระบบน้ำประปาหอผู้ป่วย'),
  ('20000000-0000-0000-0000-000000000004', 'ER-F1-RESUS', 'อาคารอุบัติเหตุและฉุกเฉิน', 'ชั้น 1', 'หน้าห้องกู้ชีพ', 'ตู้จ่ายไฟฟ้าฉุกเฉิน'),
  ('20000000-0000-0000-0000-000000000005', 'PHARM-F1-STORE', 'อาคารเภสัชกรรม', 'ชั้น 1', 'ห้องเก็บเวชภัณฑ์', 'เครื่องปรับอากาศควบคุมอุณหภูมิ'),
  ('20000000-0000-0000-0000-000000000006', 'SUP-F1-MAINT', 'อาคารสนับสนุนบริการ', 'ชั้น 1', 'หน่วยซ่อมบำรุง', 'ตู้ควบคุมระบบอาคาร'),
  ('20000000-0000-0000-0000-000000000007', 'OPD-LIFT-A', 'อาคารผู้ป่วยนอก', 'ทุกชั้น', 'โถงลิฟต์ A', 'ลิฟต์โดยสาร A'),
  ('20000000-0000-0000-0000-000000000008', 'IPD-F2-CORR', 'อาคารผู้ป่วยใน', 'ชั้น 2', 'ทางเดินกลาง', 'ฝ้าเพดานและระบบแสงสว่าง'),
  ('20000000-0000-0000-0000-000000000009', 'LAB-F1-SPEC', 'อาคารห้องปฏิบัติการ', 'ชั้น 1', 'จุดรับสิ่งส่งตรวจ', 'อ่างล้างและระบบระบายน้ำ'),
  ('20000000-0000-0000-0000-000000000010', 'ADMIN-F2-MEET', 'อาคารอำนวยการ', 'ชั้น 2', 'ห้องประชุมใหญ่', 'ระบบปรับอากาศส่วนกลาง'),
  ('20000000-0000-0000-0000-000000000011', 'ER-F1-GEN', 'อาคารอุบัติเหตุและฉุกเฉิน', 'ชั้น 1', 'ห้องเครื่องกำเนิดไฟฟ้า', 'ตู้ควบคุมไฟฟ้าสำรอง'),
  ('20000000-0000-0000-0000-000000000012', 'OPD-F2-WEST', 'อาคารผู้ป่วยนอก', 'ชั้น 2', 'พื้นที่รอตรวจฝั่งตะวันตก', 'เครื่องปรับอากาศแบบแยกส่วน'),
  ('20000000-0000-0000-0000-000000000013', 'ADMIN-F1-RECORD', 'อาคารอำนวยการ', 'ชั้น 1', 'ทางเดินหน้าห้องสารบรรณ', 'ระบบแสงสว่างทางเดิน'),
  ('20000000-0000-0000-0000-000000000014', 'LAB-F1-UTILITY', 'อาคารห้องปฏิบัติการ', 'ชั้น 1', 'ห้องเตรียมน้ำยา', 'ก๊อกน้ำและระบบระบายน้ำ'),
  ('20000000-0000-0000-0000-000000000015', 'IPD-F2-FIRE', 'อาคารผู้ป่วยใน', 'ชั้น 2', 'ประตูหนีไฟฝั่งทิศเหนือ', 'ชุดมือจับประตูหนีไฟ');

-- ---------------------------------------------------------------------------
-- 4. Rewards and campaigns (images intentionally left NULL)
-- ---------------------------------------------------------------------------
insert into public.reward_items (id, name, description, point_cost, stock, is_active, reward_period)
values
  ('50000000-0000-0000-0000-000000000001', 'กระบอกน้ำสเตนเลส ขนาด 500 มล.', 'กระบอกน้ำเก็บอุณหภูมิสำหรับบุคลากร', 40, 24, true, 'standard'),
  ('50000000-0000-0000-0000-000000000002', 'ร่มพับอัตโนมัติ', 'ร่มพับพร้อมสัญลักษณ์โครงการส่งเสริมความปลอดภัย', 30, 18, true, 'standard'),
  ('50000000-0000-0000-0000-000000000003', 'สมุดบันทึกปกแข็ง', 'สมุดบันทึกขนาด A5 สำหรับใช้ในการปฏิบัติงาน', 15, 39, true, 'standard'),
  ('50000000-0000-0000-0000-000000000004', 'ถุงผ้าพับได้', 'ถุงผ้าสำหรับลดการใช้ถุงพลาสติกภายในหน่วยงาน', 20, 30, true, 'standard'),
  ('50000000-0000-0000-0000-000000000005', 'ประกาศนียบัตรบุคลากรต้นแบบด้านความปลอดภัย', 'รางวัลประจำปีสำหรับผู้มีส่วนร่วมสูงสุดตามเกณฑ์โครงการ', 100, 3, true, 'annual');

insert into public.reward_campaigns (id, name, period_type, start_date, end_date, prize_description, status)
values
  ('60000000-0000-0000-0000-000000000001', 'บุคลากรมีส่วนร่วมด้านความปลอดภัยประจำเดือน', 'monthly', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'ผู้มีคะแนนสะสมสูงสุดประจำเดือนได้รับเกียรติบัตรและของรางวัลตามระเบียบโครงการ', 'active'),
  ('60000000-0000-0000-0000-000000000002', 'บุคลากรมีส่วนร่วมด้านความปลอดภัยเดือนที่ผ่านมา', 'monthly', (date_trunc('month', current_date) - interval '1 month')::date, (date_trunc('month', current_date) - interval '1 day')::date, 'สรุปผลการมีส่วนร่วมของบุคลากรประจำเดือน', 'ended');

-- ---------------------------------------------------------------------------
-- 5. Incidents and complete work-order workflow coverage
-- ---------------------------------------------------------------------------
insert into public.incidents (
  id, ticket_number, location_id, location_label, asset_name, category,
  urgency_reported, urgency_verified, urgency_verified_by, urgency_verified_at,
  description, reporter_id, status, created_at, updated_at
) values
  ('30000000-0000-0000-0000-000000000001', 'ISRI-202608-000001', '20000000-0000-0000-0000-000000000004', 'อาคารอุบัติเหตุและฉุกเฉิน · ชั้น 1 · หน้าห้องกู้ชีพ', 'ตู้จ่ายไฟฟ้าฉุกเฉิน', 'ไฟฟ้า', 'critical', null, null, null, 'ไฟส่องสว่างหน้าห้องกู้ชีพกะพริบเป็นระยะและมีเสียงผิดปกติจากตู้ควบคุม', '10000000-0000-0000-0000-000000000005', 'pending_assignment', now() - interval '25 minutes', now() - interval '25 minutes'),
  ('30000000-0000-0000-0000-000000000002', 'ISRI-202608-000002', '20000000-0000-0000-0000-000000000001', 'อาคารผู้ป่วยนอก · ชั้น 1 · จุดลงทะเบียน', 'ระบบไฟฟ้าจุดบริการ', 'ไฟฟ้า', 'normal', null, null, null, 'เต้ารับไฟฟ้าบริเวณเคาน์เตอร์หมายเลข 4 หลวมและไม่สามารถใช้งานได้', '10000000-0000-0000-0000-000000000006', 'pending_assignment', now() - interval '3 hours', now() - interval '3 hours'),
  ('30000000-0000-0000-0000-000000000003', 'ISRI-202608-000003', '20000000-0000-0000-0000-000000000007', 'อาคารผู้ป่วยนอก · ทุกชั้น · โถงลิฟต์ A', 'ลิฟต์โดยสาร A', 'ลิฟต์', 'urgent', 'urgent', '10000000-0000-0000-0000-000000000002', now() - interval '45 minutes', 'ประตูลิฟต์ชั้น 2 ปิดช้ากว่าปกติและมีเสียงเสียดสีระหว่างการเปิดปิด', '10000000-0000-0000-0000-000000000005', 'pending_assignment', now() - interval '1 hour', now() - interval '45 minutes'),
  ('30000000-0000-0000-0000-000000000004', 'ISRI-202608-000004', '20000000-0000-0000-0000-000000000005', 'อาคารเภสัชกรรม · ชั้น 1 · ห้องเก็บเวชภัณฑ์', 'เครื่องปรับอากาศควบคุมอุณหภูมิ', 'เครื่องปรับอากาศ', 'critical', 'urgent', '10000000-0000-0000-0000-000000000002', now() - interval '4 hours', 'อุณหภูมิห้องเก็บเวชภัณฑ์สูงกว่าค่าควบคุมและเครื่องปรับอากาศไม่ตัดการทำงาน', '10000000-0000-0000-0000-000000000007', 'pending_assignment', now() - interval '5 hours', now() - interval '4 hours'),
  ('30000000-0000-0000-0000-000000000005', 'ISRI-202608-000005', '20000000-0000-0000-0000-000000000009', 'อาคารห้องปฏิบัติการ · ชั้น 1 · จุดรับสิ่งส่งตรวจ', 'อ่างล้างและระบบระบายน้ำ', 'ประปา', 'urgent', 'urgent', '10000000-0000-0000-0000-000000000002', now() - interval '8 hours', 'ท่อระบายน้ำใต้อ่างล้างรั่วซึม ต้องเปลี่ยนข้อต่อและชุดดักกลิ่นใหม่', '10000000-0000-0000-0000-000000000006', 'pending_assignment', now() - interval '9 hours', now() - interval '8 hours'),
  ('30000000-0000-0000-0000-000000000006', 'ISRI-202608-000006', '20000000-0000-0000-0000-000000000003', 'อาคารผู้ป่วยใน · ชั้น 3 · หอผู้ป่วยอายุรกรรม', 'ระบบน้ำประปาหอผู้ป่วย', 'ประปา', 'urgent', 'urgent', '10000000-0000-0000-0000-000000000002', now() - interval '1 day', 'วาล์วน้ำบริเวณห้องล้างอุปกรณ์ปิดไม่สนิท อยู่ระหว่างรออะไหล่รุ่นที่ตรงกับระบบเดิม', '10000000-0000-0000-0000-000000000005', 'pending_assignment', now() - interval '1 day 2 hours', now() - interval '1 day'),
  ('30000000-0000-0000-0000-000000000007', 'ISRI-202608-000007', '20000000-0000-0000-0000-000000000008', 'อาคารผู้ป่วยใน · ชั้น 2 · ทางเดินกลาง', 'ฝ้าเพดานและระบบแสงสว่าง', 'โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)', 'normal', 'normal', '10000000-0000-0000-0000-000000000002', now() - interval '2 days', 'ฝ้าเพดานบริเวณทางเดินมีคราบความชื้น ได้ซ่อมแหล่งรั่วและเปลี่ยนแผ่นฝ้าแล้ว รอตรวจรับ', '10000000-0000-0000-0000-000000000006', 'pending_assignment', now() - interval '3 days', now() - interval '2 days'),
  ('30000000-0000-0000-0000-000000000008', 'ISRI-202608-000008', '20000000-0000-0000-0000-000000000011', 'อาคารอุบัติเหตุและฉุกเฉิน · ชั้น 1 · ห้องเครื่องกำเนิดไฟฟ้า', 'ตู้ควบคุมไฟฟ้าสำรอง', 'ไฟฟ้า', 'critical', 'critical', '10000000-0000-0000-0000-000000000002', now() - interval '6 days', 'เบรกเกอร์วงจรไฟฟ้าสำรองตัดบ่อย ตรวจพบจุดต่อสายหลวมและแก้ไขเรียบร้อย', '10000000-0000-0000-0000-000000000005', 'pending_assignment', now() - interval '6 days 5 hours', now() - interval '6 days'),
  ('30000000-0000-0000-0000-000000000009', 'ISRI-202608-000009', '20000000-0000-0000-0000-000000000012', 'อาคารผู้ป่วยนอก · ชั้น 2 · พื้นที่รอตรวจฝั่งตะวันตก', 'เครื่องปรับอากาศแบบแยกส่วน', 'เครื่องปรับอากาศ', 'urgent', 'urgent', '10000000-0000-0000-0000-000000000002', now() - interval '10 days', 'เครื่องปรับอากาศมีน้ำหยดบริเวณทางเดิน ล้างท่อน้ำทิ้งและทดสอบระบบเรียบร้อย', '10000000-0000-0000-0000-000000000005', 'pending_assignment', now() - interval '10 days 4 hours', now() - interval '10 days'),
  ('30000000-0000-0000-0000-000000000010', 'ISRI-202608-000010', '20000000-0000-0000-0000-000000000013', 'อาคารอำนวยการ · ชั้น 1 · ทางเดินหน้าห้องสารบรรณ', 'ระบบแสงสว่างทางเดิน', 'ไฟฟ้า', 'normal', 'normal', '10000000-0000-0000-0000-000000000002', now() - interval '14 days', 'หลอดไฟบริเวณทางเดินดับ เปลี่ยนหลอดและตรวจวัดระบบไฟฟ้าเรียบร้อย', '10000000-0000-0000-0000-000000000005', 'pending_assignment', now() - interval '15 days', now() - interval '14 days'),
  ('30000000-0000-0000-0000-000000000011', 'ISRI-202608-000011', '20000000-0000-0000-0000-000000000014', 'อาคารห้องปฏิบัติการ · ชั้น 1 · ห้องเตรียมน้ำยา', 'ก๊อกน้ำและระบบระบายน้ำ', 'ประปา', 'urgent', 'urgent', '10000000-0000-0000-0000-000000000002', now() - interval '18 days', 'ก๊อกน้ำปิดไม่สนิทและมีน้ำไหลต่อเนื่อง เปลี่ยนชุดวาล์วภายในเรียบร้อย', '10000000-0000-0000-0000-000000000006', 'pending_assignment', now() - interval '19 days', now() - interval '18 days'),
  ('30000000-0000-0000-0000-000000000012', 'ISRI-202608-000012', '20000000-0000-0000-0000-000000000015', 'อาคารผู้ป่วยใน · ชั้น 2 · ประตูหนีไฟฝั่งทิศเหนือ', 'ชุดมือจับประตูหนีไฟ', 'โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)', 'normal', 'normal', '10000000-0000-0000-0000-000000000002', now() - interval '24 days', 'มือจับประตูทางหนีไฟหลวม ขันยึดและทดสอบการเปิดปิดเรียบร้อย', '10000000-0000-0000-0000-000000000006', 'pending_assignment', now() - interval '25 days', now() - interval '24 days');

insert into public.work_orders (
  id, incident_id, technician_id, assigned_by, assigned_at, status,
  respond_due_at, resolve_due_at, sla_point_value, created_at, updated_at
)
select values_.id::uuid, values_.incident_id::uuid, values_.technician_id::uuid,
       '10000000-0000-0000-0000-000000000002'::uuid, values_.assigned_at,
       'pending'::public.work_order_status, values_.respond_due_at,
       values_.resolve_due_at, sla_rule.point_value,
       values_.assigned_at, values_.assigned_at
from (values
  ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',now()-interval '45 minutes',now()+interval '75 minutes',now()+interval '23 hours'),
  ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004',now()-interval '4 hours',now()-interval '2 hours',now()+interval '20 hours'),
  ('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000004',now()-interval '8 hours',now()-interval '6 hours',now()+interval '16 hours'),
  ('40000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000004',now()-interval '1 day',now()-interval '22 hours',now()-interval '1 hour'),
  ('40000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000004',now()-interval '2 days',now()-interval '1 day',now()+interval '1 day'),
  ('40000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000003',now()-interval '6 days',now()-interval '5 days 23 hours 30 minutes',now()-interval '5 days 20 hours'),
  ('40000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000004',now()-interval '10 days',now()-interval '9 days 22 hours',now()-interval '9 days'),
  ('40000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000003',now()-interval '14 days',now()-interval '13 days',now()-interval '11 days'),
  ('40000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000004',now()-interval '18 days',now()-interval '17 days 22 hours',now()-interval '17 days'),
  ('40000000-0000-0000-0000-000000000012','30000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000004',now()-interval '24 days',now()-interval '23 days',now()-interval '21 days')
) as values_(id,incident_id,technician_id,assigned_at,respond_due_at,resolve_due_at)
join public.incidents as incident on incident.id = values_.incident_id::uuid
join public.sla_rules as sla_rule on sla_rule.urgency_level = incident.urgency_verified;

update public.work_orders set status = 'in_progress', updated_at = now() - interval '2 hours' where id = '40000000-0000-0000-0000-000000000004';
update public.work_orders set status = 'pending_parts_approval', updated_at = now() - interval '5 hours' where id = '40000000-0000-0000-0000-000000000005';
update public.work_orders set status = 'waiting_parts', updated_at = now() - interval '20 hours' where id = '40000000-0000-0000-0000-000000000006';
update public.work_orders set status = 'pending_repair_approval', updated_at = now() - interval '1 day' where id = '40000000-0000-0000-0000-000000000007';
update public.work_orders set status = 'done', updated_at = now() - interval '6 days' where id in ('40000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000012');

update public.incidents incident
set status = values_.status::public.incident_status, updated_at = values_.updated_at
from (values
  ('30000000-0000-0000-0000-000000000003','assigned',now()-interval '45 minutes'),
  ('30000000-0000-0000-0000-000000000004','in_progress',now()-interval '2 hours'),
  ('30000000-0000-0000-0000-000000000005','pending_parts_approval',now()-interval '5 hours'),
  ('30000000-0000-0000-0000-000000000006','waiting_parts',now()-interval '20 hours'),
  ('30000000-0000-0000-0000-000000000007','pending_repair_approval',now()-interval '1 day'),
  ('30000000-0000-0000-0000-000000000008','done',now()-interval '6 days'),
  ('30000000-0000-0000-0000-000000000009','done',now()-interval '10 days'),
  ('30000000-0000-0000-0000-000000000010','done',now()-interval '14 days'),
  ('30000000-0000-0000-0000-000000000011','done',now()-interval '18 days'),
  ('30000000-0000-0000-0000-000000000012','done',now()-interval '24 days')
) as values_(id,status,updated_at)
where incident.id = values_.id::uuid;

insert into public.work_order_history (id, work_order_id, status, changed_by, changed_at, note, event_type, metadata)
values
  ('41000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','pending','10000000-0000-0000-0000-000000000002',now()-interval '45 minutes','ยืนยันระดับเร่งด่วนและมอบหมายงานให้ช่างไฟฟ้า','status_change','{"urgency_verified":"urgent"}'),
  ('41000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000004','in_progress','10000000-0000-0000-0000-000000000004',now()-interval '2 hours','ตรวจสอบเครื่องและเริ่มล้างชุดระบายความร้อน','status_change','{}'),
  ('41000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000005','pending_parts_approval','10000000-0000-0000-0000-000000000004',now()-interval '5 hours','ขออนุมัติข้อต่อพีวีซีและชุดดักกลิ่นทดแทน','status_change','{"parts":["ข้อต่อพีวีซี","ชุดดักกลิ่น"]}'),
  ('41000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000006','waiting_parts','10000000-0000-0000-0000-000000000004',now()-interval '20 hours','อนุมัติอะไหล่แล้ว อยู่ระหว่างรอรับวาล์วจากผู้จำหน่าย','status_change','{}'),
  ('41000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000007','pending_repair_approval','10000000-0000-0000-0000-000000000004',now()-interval '1 day','ซ่อมแหล่งรั่วและเปลี่ยนแผ่นฝ้าแล้ว ขอให้ผู้จัดสรรตรวจรับ','status_change','{}'),
  ('41000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000008','done','10000000-0000-0000-0000-000000000002',now()-interval '6 days','ตรวจรับระบบไฟฟ้าสำรองและปิดงาน','status_change','{}'),
  ('41000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000009','done','10000000-0000-0000-0000-000000000002',now()-interval '10 days','ตรวจสอบการระบายน้ำและปิดงาน','status_change','{}'),
  ('41000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000010','done','10000000-0000-0000-0000-000000000002',now()-interval '14 days','ตรวจวัดระบบไฟฟ้าหลังเปลี่ยนหลอดและปิดงาน','status_change','{}'),
  ('41000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000011','done','10000000-0000-0000-0000-000000000002',now()-interval '18 days','ทดสอบก๊อกน้ำแล้วไม่พบการรั่วซึม','status_change','{}'),
  ('41000000-0000-0000-0000-000000000012','40000000-0000-0000-0000-000000000012','done','10000000-0000-0000-0000-000000000002',now()-interval '24 days','ตรวจสอบประตูหนีไฟและปิดงาน','status_change','{}');

-- ---------------------------------------------------------------------------
-- 6. Reward redemption lifecycle and matching point balances
-- ---------------------------------------------------------------------------
insert into public.reward_redemptions (
  id, user_id, reward_item_id, redeemed_at, status, fulfillment_method,
  recipient_name, phone, delivery_address, requester_note, admin_note,
  fulfilled_at, fulfilled_by, cancelled_at, cancelled_by, updated_at
) values
  ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000001',now()-interval '5 days','fulfilled','pickup','ณัฐยา ศรีสุข','0812345678',null,'รับที่หน่วยซ่อมบำรุงช่วงพักกลางวัน','ส่งมอบและตรวจสอบผู้รับเรียบร้อย',now()-interval '4 days','10000000-0000-0000-0000-000000000001',null,null,now()-interval '4 days'),
  ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000003',now()-interval '1 day','pending','delivery','ณัฐยา ศรีสุข','0812345678','หอผู้ป่วยอายุรกรรม อาคารผู้ป่วยใน ชั้น 3','ฝากส่งที่เคาน์เตอร์พยาบาล',null,null,null,null,null,now()-interval '1 day'),
  ('70000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000002',now()-interval '12 days','cancelled','pickup','กนกวรรณ มีสุข','0898765432',null,null,'ยกเลิกตามคำขอของผู้แลกและคืนแต้มแล้ว',null,null,now()-interval '11 days','10000000-0000-0000-0000-000000000001',now()-interval '11 days');

insert into public.point_transactions (id, user_id, amount, transaction_type, reason, ref_reward_item_id, created_at)
values
  ('71000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005',-40,'redeem','แลกกระบอกน้ำสเตนเลส ขนาด 500 มล.','50000000-0000-0000-0000-000000000001',now()-interval '5 days'),
  ('71000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005',-15,'redeem','แลกสมุดบันทึกปกแข็ง','50000000-0000-0000-0000-000000000003',now()-interval '1 day'),
  ('71000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000006',-30,'redeem','แลกร่มพับอัตโนมัติ','50000000-0000-0000-0000-000000000002',now()-interval '12 days'),
  ('71000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000006',30,'refund','คืนแต้มจากการยกเลิกร่มพับอัตโนมัติ','50000000-0000-0000-0000-000000000002',now()-interval '11 days');

update public.point_wallets set balance = balance - 55, updated_at = now() - interval '1 day'
where user_id = '10000000-0000-0000-0000-000000000005';
insert into public.point_wallets (user_id, balance)
values ('10000000-0000-0000-0000-000000000007', 0)
on conflict (user_id) do nothing;

-- Historical leaderboard data from the previous campaign.
insert into public.campaign_scores (campaign_id, user_id, points, last_scored_at)
values
  ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005',70,date_trunc('month',current_date)-interval '3 days'),
  ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006',50,date_trunc('month',current_date)-interval '5 days'),
  ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000007',30,date_trunc('month',current_date)-interval '7 days');

-- ---------------------------------------------------------------------------
-- 7. Preventive maintenance schedules and logs
-- ---------------------------------------------------------------------------
insert into public.pm_schedules (id, location_id, location_label, asset_name, plan_details, interval_months, last_done_at, next_due_at)
values
  ('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007','อาคารผู้ป่วยนอก · ทุกชั้น · โถงลิฟต์ A','ลิฟต์โดยสาร A','ตรวจสอบระบบประตู เบรกฉุกเฉิน สัญญาณเตือน และทดสอบการทำงานทุกชั้น',1,now()-interval '35 days',now()-interval '5 days'),
  ('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005','อาคารเภสัชกรรม · ชั้น 1 · ห้องเก็บเวชภัณฑ์','เครื่องปรับอากาศควบคุมอุณหภูมิ','ล้างแผงกรอง ตรวจแรงดันน้ำยา และทดสอบการควบคุมอุณหภูมิห้องเก็บเวชภัณฑ์',3,now()-interval '89 days',now()+interval '1 day'),
  ('80000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','อาคารอุบัติเหตุและฉุกเฉิน · ชั้น 1 · หน้าห้องกู้ชีพ','ตู้จ่ายไฟฟ้าฉุกเฉิน','ตรวจความแน่นของจุดต่อสาย วัดความร้อนสะสม และทดสอบไฟฟ้าสำรอง',1,now()-interval '25 days',now()+interval '5 days'),
  ('80000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000010','อาคารอำนวยการ · ชั้น 2 · ห้องประชุมใหญ่','ระบบปรับอากาศส่วนกลาง','ตรวจชุดควบคุม ทำความสะอาดชุดกรอง และทดสอบการกระจายลมของระบบส่วนกลาง',6,now()-interval '4 months',now()+interval '2 months'),
  ('80000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000003','อาคารผู้ป่วยใน · ชั้น 3 · หอผู้ป่วยอายุรกรรม','ระบบน้ำประปาหอผู้ป่วย','ตรวจแรงดันน้ำ วาล์ว ระบบระบายน้ำ และจุดเสี่ยงการรั่วซึมในหอผู้ป่วย',3,now()-interval '2 months',now()+interval '1 month');

insert into public.pm_logs (id, schedule_id, completed_at, technician_id, notes)
values
  ('81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',now()-interval '35 days','10000000-0000-0000-0000-000000000003','ตรวจสอบระบบประตู เบรกฉุกเฉิน และสัญญาณแจ้งเตือน ผลการทดสอบปกติ'),
  ('81000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000002',now()-interval '89 days','10000000-0000-0000-0000-000000000004','ล้างแผงกรอง ตรวจแรงดันน้ำยา และวัดอุณหภูมิหลังบำรุงรักษา'),
  ('81000000-0000-0000-0000-000000000003','80000000-0000-0000-0000-000000000003',now()-interval '25 days','10000000-0000-0000-0000-000000000003','ขันจุดต่อสาย ตรวจความร้อนสะสม และทดสอบไฟฟ้าสำรอง');

-- ---------------------------------------------------------------------------
-- 8. Curated notifications
-- ---------------------------------------------------------------------------
-- Workflow triggers generate valid notifications while seeding. Replace them
-- with a compact deterministic inbox that covers read and unread states.
delete from public.notifications;
insert into public.notifications (id, user_id, type, message, related_incident_id, is_read, created_at)
values
  ('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','new_assignment_pending','มีเหตุใหม่ ISRI-202608-000001 รอตรวจสอบและจัดสรรงาน','30000000-0000-0000-0000-000000000001',false,now()-interval '25 minutes'),
  ('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','new_assignment_pending','มีเหตุใหม่ ISRI-202608-000002 รอตรวจสอบและจัดสรรงาน','30000000-0000-0000-0000-000000000002',false,now()-interval '3 hours'),
  ('90000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','job_assigned','คุณได้รับมอบหมายงาน ISRI-202608-000003 ตรวจสอบลิฟต์โดยสาร A','30000000-0000-0000-0000-000000000003',false,now()-interval '45 minutes'),
  ('90000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','job_assigned','คุณได้รับมอบหมายงาน ISRI-202608-000004 ตรวจสอบเครื่องปรับอากาศห้องเก็บเวชภัณฑ์','30000000-0000-0000-0000-000000000004',true,now()-interval '4 hours'),
  ('90000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','job_done','งาน ISRI-202608-000008 ดำเนินการเรียบร้อยและได้รับแต้มแล้ว','30000000-0000-0000-0000-000000000008',true,now()-interval '6 days'),
  ('90000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','job_done','งาน ISRI-202608-000011 ดำเนินการเรียบร้อยและได้รับแต้มแล้ว','30000000-0000-0000-0000-000000000011',false,now()-interval '18 days'),
  ('90000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000005','reward_status','คำขอแลกรางวัล "กระบอกน้ำสเตนเลส ขนาด 500 มล." ได้รับการส่งมอบแล้ว',null,false,now()-interval '5 days');

-- Keep future automatically generated ticket numbers after the seeded range.
-- The original Cloud project and the reproducible Local baseline use different
-- legacy sequence names, so support only the two known ISRI names explicitly.
do $$
begin
  if to_regclass('public.incident_ticket_seq') is not null then
    perform setval('public.incident_ticket_seq', 12, true);
  end if;
  if to_regclass('public.incident_ticket_sequence') is not null then
    perform setval('public.incident_ticket_sequence', 12, true);
  end if;
end;
$$;

commit;

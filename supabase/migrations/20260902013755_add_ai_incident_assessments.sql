-- AI assessment is deliberately additive. It never changes incident status,
-- verified urgency, SLA deadlines, point awards, or work-order assignment.
create table public.ai_incident_assessments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 120),
  model_response_id text,
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  summary text not null check (char_length(trim(summary)) between 1 and 1000),
  category_suggested text not null check (category_suggested in (
    'ไฟฟ้า', 'ประปา', 'เครื่องปรับอากาศ', 'ลิฟต์',
    'โครงสร้าง/พื้นผิวอาคาร (ผนัง พื้น เพดาน ประตู)', 'อื่น ๆ'
  )),
  suggested_urgency public.incident_urgency,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  detected_hazards text[] not null default '{}',
  evidence text[] not null default '{}',
  missing_information text[] not null default '{}',
  rule_reasons text[] not null default '{}',
  needs_human_review boolean not null default true,
  input_attachment_count smallint not null default 0
    check (input_attachment_count between 0 and 3),
  latency_ms integer not null check (latency_ms >= 0),
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (cardinality(detected_hazards) <= 12),
  check (cardinality(evidence) <= 8),
  check (cardinality(missing_information) <= 6),
  check (cardinality(rule_reasons) <= 8)
);

create index ai_incident_assessments_incident_created_idx
  on public.ai_incident_assessments (incident_id, created_at desc);
create index ai_incident_assessments_requested_by_idx
  on public.ai_incident_assessments (requested_by)
  where requested_by is not null;

alter table public.ai_incident_assessments enable row level security;
revoke all on table public.ai_incident_assessments from anon, authenticated;

-- The browser must go through isri-ai-assessment, where dispatcher
-- authorization is checked. Keeping browser roles ungranted also avoids accidental Data API
-- exposure when platform defaults change.
create policy api_only_ai_incident_assessments
  on public.ai_incident_assessments
  for all
  to anon, authenticated
  using (false)
  with check (false);

grant select, insert, update, delete
  on table public.ai_incident_assessments
  to service_role;


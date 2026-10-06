alter table public.managed_locations
  add column if not exists qr_scope text not null default 'area'
  check (qr_scope in ('area', 'asset'));

update public.managed_locations
set qr_scope = case
  when nullif(trim(asset_name), '') is null then 'area'
  else 'asset'
end;

create table if not exists public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  building text not null check (char_length(trim(building)) between 1 and 120),
  floor text not null check (char_length(trim(floor)) between 1 and 60),
  name text not null check (char_length(trim(name)) between 1 and 180),
  canvas_width integer not null default 1600 check (canvas_width between 600 and 5000),
  canvas_height integer not null default 1000 check (canvas_height between 400 and 5000),
  background_bucket text,
  background_object_path text,
  background_file_name text,
  layout jsonb not null default '{"elements":[]}'::jsonb,
  version integer not null default 1 check (version > 0),
  is_published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building, floor),
  check ((background_bucket is null) = (background_object_path is null))
);

create table if not exists public.floor_plan_versions (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  version integer not null check (version > 0),
  layout jsonb not null,
  background_bucket text,
  background_object_path text,
  background_file_name text,
  is_published boolean not null,
  saved_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (floor_plan_id, version)
);

create index if not exists floor_plans_building_floor_idx
  on public.floor_plans (building, floor);
create index if not exists floor_plan_versions_plan_created_idx
  on public.floor_plan_versions (floor_plan_id, created_at desc);

drop trigger if exists floor_plans_set_updated_at on public.floor_plans;
create trigger floor_plans_set_updated_at
before update on public.floor_plans
for each row execute procedure public.set_updated_at();

alter table public.floor_plans enable row level security;
alter table public.floor_plan_versions enable row level security;

drop policy if exists api_only_floor_plans on public.floor_plans;
create policy api_only_floor_plans on public.floor_plans
for all to authenticated using (false) with check (false);

drop policy if exists api_only_floor_plan_versions on public.floor_plan_versions;
create policy api_only_floor_plan_versions on public.floor_plan_versions
for all to authenticated using (false) with check (false);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'floor-plan-images',
  'floor-plan-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

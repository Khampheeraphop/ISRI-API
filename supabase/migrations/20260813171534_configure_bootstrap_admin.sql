-- Accounts in this table are promoted to administrator when Supabase Auth
-- creates or updates a matching profile. Keep this configuration private:
-- clients never need direct access to it.
create table if not exists public.bootstrap_admins (
  email text primary key,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint bootstrap_admins_email_check check (
    email = lower(trim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

alter table public.bootstrap_admins enable row level security;
revoke all on table public.bootstrap_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.bootstrap_admins to service_role;

insert into public.bootstrap_admins (email, display_name)
values ('poplowplay1@gmail.com', 'ผู้ดูแลระบบหลัก')
on conflict (email) do update set display_name = excluded.display_name;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_is_bootstrap_admin boolean;
begin
  select exists (
    select 1
    from public.bootstrap_admins bootstrap
    where bootstrap.email = v_email
  ) into v_is_bootstrap_admin;

  insert into public.profiles (
    id,
    email,
    full_name,
    approval_status,
    role,
    requested_position,
    approved_at
  ) values (
    new.id,
    v_email,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, 'ผู้ใช้งาน'), '@', 1)
    ),
    case when v_is_bootstrap_admin then 'approved'::public.approval_status else 'pending'::public.approval_status end,
    case when v_is_bootstrap_admin then 'admin'::public.app_role else null end,
    case when v_is_bootstrap_admin then 'ผู้ดูแลระบบหลัก' else null end,
    case when v_is_bootstrap_admin then now() else null end
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when public.profiles.full_name = '' then excluded.full_name
          else public.profiles.full_name
        end,
        approval_status = case
          when v_is_bootstrap_admin then 'approved'::public.approval_status
          else public.profiles.approval_status
        end,
        role = case
          when v_is_bootstrap_admin then 'admin'::public.app_role
          else public.profiles.role
        end,
        requested_position = case
          when v_is_bootstrap_admin then coalesce(public.profiles.requested_position, 'ผู้ดูแลระบบหลัก')
          else public.profiles.requested_position
        end,
        rejection_reason = case
          when v_is_bootstrap_admin then null
          else public.profiles.rejection_reason
        end,
        approved_at = case
          when v_is_bootstrap_admin then coalesce(public.profiles.approved_at, now())
          else public.profiles.approved_at
        end,
        updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- Promote an existing account as well, in case this migration is applied after
-- the owner has already signed in with Google.
update public.profiles profile
set approval_status = 'approved'::public.approval_status,
    role = 'admin'::public.app_role,
    requested_position = coalesce(profile.requested_position, 'ผู้ดูแลระบบหลัก'),
    rejection_reason = null,
    approved_at = coalesce(profile.approved_at, now()),
    updated_at = now()
where lower(profile.email) in (select email from public.bootstrap_admins);

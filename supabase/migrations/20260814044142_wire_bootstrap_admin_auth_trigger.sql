drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

update public.profiles profile
set approval_status = 'approved'::public.approval_status,
    role = 'admin'::public.app_role,
    requested_position = coalesce(profile.requested_position, 'ผู้ดูแลระบบหลัก'),
    rejection_reason = null,
    approved_at = coalesce(profile.approved_at, now()),
    updated_at = now()
where lower(trim(profile.email)) in (
  select bootstrap.email
  from public.bootstrap_admins bootstrap
);;

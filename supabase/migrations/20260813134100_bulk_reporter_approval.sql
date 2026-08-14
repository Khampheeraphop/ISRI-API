create or replace function public.bulk_approve_reporters(
  p_user_ids uuid[],
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if coalesce(array_length(p_user_ids, 1), 0) < 1
     or array_length(p_user_ids, 1) > 200 then
    raise exception 'Select between 1 and 200 users.';
  end if;
  if p_actor_id = any(p_user_ids) then
    raise exception 'You cannot change your own access.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and approval_status = 'approved' and role = 'admin'
  ) then
    raise exception 'Administrator access is required.';
  end if;

  update public.profiles
  set approval_status = 'approved', role = 'reporter',
      technician_specialties = '{}', rejection_reason = null,
      approved_by = p_actor_id, approved_at = now()
  where id = any(p_user_ids)
    and approval_status = 'pending';
  get diagnostics v_count = row_count;

  insert into public.user_approval_history (
    user_id, action, role, specialties, note, acted_by
  )
  select id, 'approved', 'reporter', '{}',
         'อนุมัติผู้แจ้งเหตุแบบหลายรายการ', p_actor_id
  from public.profiles
  where id = any(p_user_ids)
    and approval_status = 'approved'
    and role = 'reporter'
    and approved_by = p_actor_id
    and approved_at >= transaction_timestamp();

  return v_count;
end;
$$;

revoke all on function public.bulk_approve_reporters(uuid[], uuid)
from public, anon, authenticated;
grant execute on function public.bulk_approve_reporters(uuid[], uuid)
to service_role;

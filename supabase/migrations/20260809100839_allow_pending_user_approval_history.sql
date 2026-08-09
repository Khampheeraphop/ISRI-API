alter table public.user_approval_history
  drop constraint if exists user_approval_history_action_check;

alter table public.user_approval_history
  add constraint user_approval_history_action_check
  check (action in ('pending', 'approved', 'rejected'));

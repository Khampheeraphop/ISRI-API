-- Refunds restore points to the reporter, so they must carry a positive amount.
alter table public.point_transactions
  drop constraint if exists point_transactions_type_amount_check;

alter table public.point_transactions
  add constraint point_transactions_type_amount_check check (
    (transaction_type in ('earn', 'refund') and amount > 0)
    or
    (transaction_type = 'redeem' and amount < 0)
  );

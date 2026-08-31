create index if not exists incidents_rejected_by_idx
  on public.incidents (rejected_by)
  where rejected_by is not null;

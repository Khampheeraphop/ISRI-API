create or replace function public.apply_work_order_action(
  p_work_order_id uuid,
  p_status public.work_order_status,
  p_actor_id uuid,
  p_note text,
  p_event_type text,
  p_incident_status public.incident_status,
  p_attachments jsonb default '[]'::jsonb
)
returns table (
  id uuid,
  incident_id uuid,
  status public.work_order_status,
  history_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_order public.work_orders%rowtype;
  v_history_id uuid;
  v_attachment jsonb;
  v_file_id uuid;
begin
  update public.work_orders as work_order
  set status = p_status,
      updated_at = now()
  where work_order.id = p_work_order_id
  returning * into v_work_order;

  if not found then
    raise exception 'Work order was not found.';
  end if;

  insert into public.work_order_history (
    work_order_id,
    status,
    changed_by,
    note,
    event_type
  )
  values (
    v_work_order.id,
    p_status,
    p_actor_id,
    nullif(trim(p_note), ''),
    p_event_type
  )
  returning work_order_history.id into v_history_id;

  update public.incidents as incident
  set status = p_incident_status,
      updated_at = now()
  where incident.id = v_work_order.incident_id;

  for v_attachment in select value from jsonb_array_elements(p_attachments)
  loop
    insert into public.files (
      bucket,
      object_path,
      file_name,
      mime_type,
      size_bytes,
      uploaded_by
    )
    values (
      'work-order-attachments',
      v_attachment->>'objectPath',
      v_attachment->>'fileName',
      v_attachment->>'mimeType',
      (v_attachment->>'sizeBytes')::integer,
      p_actor_id
    )
    returning files.id into v_file_id;

    insert into public.work_order_files (work_order_id, file_id)
    values (v_work_order.id, v_file_id);

    insert into public.work_order_history_files (work_order_history_id, file_id)
    values (v_history_id, v_file_id);
  end loop;

  return query
  select v_work_order.id, v_work_order.incident_id, v_work_order.status, v_history_id;
end;
$$;

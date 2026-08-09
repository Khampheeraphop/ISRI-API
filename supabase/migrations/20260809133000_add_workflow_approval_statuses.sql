alter type public.work_order_status add value if not exists 'pending_parts_approval';
alter type public.work_order_status add value if not exists 'pending_repair_approval';
alter type public.incident_status add value if not exists 'pending_parts_approval';
alter type public.incident_status add value if not exists 'pending_repair_approval';

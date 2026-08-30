alter type public.incident_status add value if not exists 'rejected';
alter type public.notification_type add value if not exists 'incident_rejected';

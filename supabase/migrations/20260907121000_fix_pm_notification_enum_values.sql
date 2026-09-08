-- notification_type already exists on established databases, so CREATE TYPE in
-- the earlier PM migration was intentionally skipped and did not add PM values.
alter type public.notification_type add value if not exists 'pm_due_soon';
alter type public.notification_type add value if not exists 'pm_overdue';
alter type public.notification_type add value if not exists 'pm_assigned';
alter type public.notification_type add value if not exists 'pm_updated';

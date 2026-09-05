-- The earlier CREATE TYPE ... duplicate_object block did not extend the existing enum.
-- Commit these values before the existing PM notification triggers use them.
alter type public.notification_type add value if not exists 'pm_due_soon';
alter type public.notification_type add value if not exists 'pm_overdue';
alter type public.notification_type add value if not exists 'pm_assigned';
alter type public.notification_type add value if not exists 'pm_updated';

// @ts-ignore - Deno types not available in this environment
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore - Supabase types not available in this environment
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// @ts-ignore
const Deno = globalThis.Deno || {
  env: {
    get: (key: string) => (globalThis as any)[key] || null,
  },
};

serve(async (req: Request) => {
  try {
    // Verify this is a cron job request (from Supabase cron or internal scheduler)
    const authHeader = req.headers.get("authorization");
    const cronSecret = Deno.env.get("CRON_SECRET");

    if (!cronSecret) {
      return new Response("CRON_SECRET not configured", { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Import the reminder service logic
    // For simplicity, we'll implement the logic directly here
    // In production, this would be a shared module

    // Check PM due soon (7 days ahead)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + 7);

    const { data: dueSoonSchedules } = await supabase
      .from("pm_schedules")
      .select(
        `
        id,
        asset_name,
        location_label,
        next_due_at,
        assigned_technician_id,
        profiles!pm_schedules_assigned_technician_id_fkey(full_name, email)
      `,
      )
      .lte("next_due_at", cutoffDate.toISOString())
      .gt("next_due_at", new Date().toISOString())
      .not("assigned_technician_id", "is", null);

    let emailsEnqueued = 0;

    if (dueSoonSchedules && dueSoonSchedules.length > 0) {
      const { data: admins } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "admin")
        .eq("approval_status", "approved");

      for (const schedule of dueSoonSchedules) {
        const technician = schedule.profiles;
        if (!technician) continue;

        const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";

        // Email to technician
        await supabase.from("email_outbox").insert({
          recipient_user_id: schedule.assigned_technician_id,
          recipient_email: technician.email,
          event_key: "pm_due_soon",
          related_pm_schedule_id: schedule.id,
          payload: {
            recipientName: technician.full_name,
            assetName: schedule.asset_name,
            locationLabel: schedule.location_label,
            nextDueAt: schedule.next_due_at,
            actionUrl: `${appUrl}/pm/schedules`,
          },
        });

        // Emails to admins
        if (admins) {
          for (const admin of admins) {
            await supabase.from("email_outbox").insert({
              recipient_user_id: admin.id,
              recipient_email: admin.email,
              event_key: "pm_due_soon",
              related_pm_schedule_id: schedule.id,
              payload: {
                recipientName: admin.full_name,
                assetName: schedule.asset_name,
                locationLabel: schedule.location_label,
                nextDueAt: schedule.next_due_at,
                actionUrl: `${appUrl}/admin/pm-schedules`,
              },
            });
          }
        }

        emailsEnqueued += 1 + (admins?.length || 0);
      }
    }

    // Check PM overdue
    const { data: overdueSchedules } = await supabase
      .from("pm_schedules")
      .select(
        `
        id,
        asset_name,
        location_label,
        next_due_at,
        assigned_technician_id,
        profiles!pm_schedules_assigned_technician_id_fkey(full_name, email)
      `,
      )
      .lt("next_due_at", new Date().toISOString())
      .not("assigned_technician_id", "is", null);

    if (overdueSchedules && overdueSchedules.length > 0) {
      const { data: admins } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "admin")
        .eq("approval_status", "approved");

      for (const schedule of overdueSchedules) {
        const technician = schedule.profiles;
        if (!technician) continue;

        const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";

        // Email to technician
        await supabase.from("email_outbox").insert({
          recipient_user_id: schedule.assigned_technician_id,
          recipient_email: technician.email,
          event_key: "pm_overdue",
          related_pm_schedule_id: schedule.id,
          payload: {
            recipientName: technician.full_name,
            assetName: schedule.asset_name,
            locationLabel: schedule.location_label,
            nextDueAt: schedule.next_due_at,
            actionUrl: `${appUrl}/pm/schedules`,
          },
        });

        // Emails to admins
        if (admins) {
          for (const admin of admins) {
            await supabase.from("email_outbox").insert({
              recipient_user_id: admin.id,
              recipient_email: admin.email,
              event_key: "pm_overdue",
              related_pm_schedule_id: schedule.id,
              payload: {
                recipientName: admin.full_name,
                assetName: schedule.asset_name,
                locationLabel: schedule.location_label,
                nextDueAt: schedule.next_due_at,
                actionUrl: `${appUrl}/admin/pm-schedules`,
              },
            });
          }
        }

        emailsEnqueued += 1 + (admins?.length || 0);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dueSoonCount: dueSoonSchedules?.length || 0,
        overdueCount: overdueSchedules?.length || 0,
        emailsEnqueued,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("PM reminder cron error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});

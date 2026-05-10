import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

function parseWaStatus(
  s: string | null | undefined
):
  | "disconnected"
  | "awaiting_scan"
  | "connected"
  | "session_lost" {
  if (s === "connected" || s === "awaiting_scan" || s === "session_lost") return s;
  return "disconnected";
}

export default async function OverviewPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, whatsapp_link_status")
    .eq("id", user.id)
    .maybeSingle();

  const wa = parseWaStatus(profile?.whatsapp_link_status as string | undefined);
  const business = profile?.business_name?.trim() || "Your workspace";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Overview
        </h1>
        <p className="mt-1 text-muted-foreground">
          Metrics and recent activity will appear here from your linked WhatsApp
          conversations once ingestion and order extraction are processing.
        </p>
      </div>

      {wa !== "connected" ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-4 sm:px-5">
          <p className="text-sm font-medium text-foreground">
            Link WhatsApp to unlock operational data
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Orders, inventory, and analytics stay empty until your business number
            is connected and chats are synced.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-3 inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to Settings → WhatsApp
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            Orders (30 days)
          </p>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-muted-foreground">
            —
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            No data yet — pulled from parsed chat orders when the pipeline runs.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            Revenue (30 days)
          </p>
          <p className="mt-3 text-2xl font-semibold tabular-nums text-muted-foreground">
            —
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Totals will reflect confirmed orders from your threads.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Recent activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Latest orders and messages will list here after WhatsApp is linked and
          processing is live for {business}.
        </p>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nothing to show yet.
        </p>
      </div>
    </div>
  );
}

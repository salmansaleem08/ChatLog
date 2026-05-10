import { NextResponse } from "next/server";

import { automationConfigured, automationFetch } from "@/lib/chatlog-automation";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (automationConfigured()) {
    try {
      const res = await automationFetch(
        `/whatsapp/session/disconnect?business_id=${encodeURIComponent(user.id)}&wipe_profile=true`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
        console.warn("[whatsapp/session/disconnect] upstream", res.status, body);
      }
    } catch (e) {
      if (
        e instanceof Error &&
        e.message === "CHATLOG_AUTOMATION_NOT_CONFIGURED"
      ) {
        /* fall through to profile update */
      } else {
        console.error("[whatsapp/session/disconnect]", e);
      }
    }
  }

  const { error: upErr } = await supabase
    .from("profiles")
    .update({
      whatsapp_link_status: "disconnected",
      whatsapp_linked_phone_live: null,
      whatsapp_updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (upErr) {
    console.error("[whatsapp/session/disconnect] profile update", upErr);
    return NextResponse.json(
      { error: "Could not update your workspace. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

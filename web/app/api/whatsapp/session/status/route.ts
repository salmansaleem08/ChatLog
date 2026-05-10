import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetch,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { createClient } from "@/lib/supabase/server";
import { syncWhatsappProfile } from "@/lib/whatsapp-profile-sync";

export const maxDuration = 60;

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!automationConfigured()) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("whatsapp_link_status")
      .eq("id", user.id)
      .maybeSingle();
    return NextResponse.json({
      serviceConfigured: false,
      whatsapp_link_status:
        (profile?.whatsapp_link_status as string) ?? "disconnected",
    });
  }

  try {
    const res = await automationFetch(
      `/whatsapp/session/status?business_id=${encodeURIComponent(user.id)}`,
      { method: "GET" }
    );
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!res.ok) {
      const detail = body.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? JSON.stringify(detail)
            : JSON.stringify(body) || "Upstream request failed";
      return NextResponse.json(
        {
          error: msg,
          serviceConfigured: true,
          upstreamStatus: res.status,
        },
        { status: 502 }
      );
    }

    const remote = {
      logged_in: Boolean(body.logged_in),
      needs_qr: Boolean(body.needs_qr),
      running: Boolean(body.running),
    };

    const upstreamPhone =
      typeof body.linked_phone_e164 === "string" &&
      body.linked_phone_e164.trim().length > 0
        ? body.linked_phone_e164.trim()
        : undefined;

    const whatsapp_link_status = await syncWhatsappProfile(
      supabase,
      user.id,
      remote,
      upstreamPhone
    );

    const { data: phoneRow } = await supabase
      .from("profiles")
      .select("whatsapp_linked_phone_live")
      .eq("id", user.id)
      .maybeSingle();

    return NextResponse.json({
      serviceConfigured: true,
      whatsapp_link_status,
      ...remote,
      recognizedPhone:
        (phoneRow?.whatsapp_linked_phone_live as string | null) ?? null,
    });
  } catch (e) {
    if (
      e instanceof Error &&
      e.message === "CHATLOG_AUTOMATION_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        {
          error: "This feature isn’t available right now. Please try again later.",
          code: "not_configured",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: describeAutomationReachabilityError(e),
        serviceConfigured: true,
        code: "upstream_unreachable",
      },
      { status: 502 }
    );
  }
}

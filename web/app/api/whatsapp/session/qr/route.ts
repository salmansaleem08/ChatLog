import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetch,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { createClient } from "@/lib/supabase/server";

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
    return NextResponse.json(
      { error: "This feature isn’t available right now." },
      { status: 503 }
    );
  }

  try {
    const res = await automationFetch(
      `/whatsapp/session/qr?business_id=${encodeURIComponent(user.id)}`,
      { method: "GET" }
    );

    if (!res.ok) {
      const meta = (await res.json().catch(() => ({}))) as {
        detail?: string | string[];
      };
      const detailRaw = meta.detail;
      const detail =
        typeof detailRaw === "string"
          ? detailRaw
          : Array.isArray(detailRaw)
            ? String(detailRaw[0] ?? "")
            : "";

      if (res.status === 409 || detail === "already_logged_in") {
        return NextResponse.json(
          {
            code: "already_logged_in",
            error:
              "This workspace is already linked. Refresh the page to see the latest status.",
          },
          { status: 409 }
        );
      }

      const code = detail === "qr_not_ready" ? "qr_not_ready" : "qr_unavailable";
      return NextResponse.json(
        {
          code,
          error:
            code === "qr_not_ready"
              ? "The code is still loading. Try again in a moment."
              : "The code could not be loaded. Try Connect WhatsApp again.",
        },
        { status: res.status >= 400 ? res.status : 404 }
      );
    }

    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (
      e instanceof Error &&
      e.message === "CHATLOG_AUTOMATION_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        { error: "This feature isn’t available right now." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: describeAutomationReachabilityError(e) },
      { status: 502 }
    );
  }
}

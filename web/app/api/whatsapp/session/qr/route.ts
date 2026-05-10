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
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  try {
    const res = await automationFetch(
      `/whatsapp/session/qr?business_id=${encodeURIComponent(user.id)}`,
      { method: "GET" }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "QR not available" }, { status: 404 });
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
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }
    return NextResponse.json(
      { error: describeAutomationReachabilityError(e) },
      { status: 502 }
    );
  }
}

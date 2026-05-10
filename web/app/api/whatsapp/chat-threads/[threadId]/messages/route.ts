import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetchLong,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

type ChatMessageVm = {
  role: "customer" | "business";
  text: string;
  timestampIso: string;
};

export async function GET(
  _request: Request,
  { params }: { params: { threadId: string } }
) {
  const threadId = params.threadId?.trim();
  if (!threadId) {
    return NextResponse.json({ error: "Missing chat." }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!automationConfigured()) {
    return NextResponse.json(
      {
        error: "This feature isn’t available right now. Please try again later.",
      },
      { status: 503 }
    );
  }

  const { data: thread, error: threadErr } = await supabase
    .from("whatsapp_chat_threads")
    .select("wa_chat_jid")
    .eq("id", threadId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (threadErr || !thread) {
    return NextResponse.json(
      { error: "That conversation could not be found." },
      { status: 404 }
    );
  }

  try {
    const qs = new URLSearchParams({
      business_id: user.id,
      chat_jid: String(thread.wa_chat_jid),
    }).toString();
    const res = await automationFetchLong(`/whatsapp/chat/messages?${qs}`, {
      method: "GET",
    });

    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "We couldn’t load messages for this conversation. Try again shortly.",
        },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 }
      );
    }

    const rawList = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessageVm[] = [];

    for (const m of rawList) {
      if (!m || typeof m !== "object") continue;
      const o = m as Record<string, unknown>;
      const role =
        o.role === "business"
          ? "business"
          : o.role === "customer"
            ? "customer"
            : "customer";
      const text =
        typeof o.text === "string"
          ? o.text.trim()
          : String(o.text ?? "").trim();
      const ts =
        typeof o.timestamp_iso === "string" && o.timestamp_iso.trim().length > 0
          ? o.timestamp_iso.trim()
          : typeof o.timestamp_ms === "number"
            ? new Date(o.timestamp_ms).toISOString()
            : new Date().toISOString();
      if (!text) continue;
      messages.push({
        role,
        text,
        timestampIso: ts,
      });
    }

    const latestRaw = String(body.latest_message_iso ?? "").trim();
    const latestIso =
      latestRaw && !Number.isNaN(Date.parse(latestRaw))
        ? new Date(Date.parse(latestRaw)).toISOString()
        : null;

    return NextResponse.json({
      ok: true,
      messages,
      latestMessageIso: latestIso,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return NextResponse.json(
        {
          error:
            "Loading the conversation took too long. Try again in a moment.",
        },
        { status: 504 }
      );
    }
    console.error("[chat messages]", e);
    return NextResponse.json(
      { error: describeAutomationReachabilityError(e) },
      { status: 502 }
    );
  }
}

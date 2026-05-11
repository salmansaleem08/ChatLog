import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetchLong,
  AUTOMATION_FETCH_MESSAGES_MS,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { createClient } from "@/lib/supabase/server";

/** Python completes in <25s; 300s gives a wide safety net for the platform. */
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
  const routeStart = Date.now();
  const threadId = params.threadId?.trim();
  console.info("[chat_messages] step=request_arrived", {
    threadId: threadId || "(empty)",
    ts: new Date().toISOString(),
  });
  if (!threadId) {
    console.error("[chat_messages] step=thread_param missing");
    return NextResponse.json({ error: "Missing chat.", ok: false }, { status: 400 });
  }

  const supabase = createClient();
  let userId: string | undefined;

  try {
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      console.error("[chat_messages] step=auth", {
        threadId,
        message: authErr?.message,
      });
      return NextResponse.json(
        { error: "Unauthorized", ok: false },
        { status: 401 }
      );
    }
    userId = user.id;
  } catch (e) {
    console.error("[chat_messages] step=auth_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json({ error: "Unauthorized", ok: false }, { status: 401 });
  }

  if (!automationConfigured()) {
    console.error("[chat_messages] step=config automation_not_configured", {
      threadId,
    });
    return NextResponse.json(
      {
        error: "This feature isn’t available right now. Please try again later.",
        ok: false,
      },
      { status: 503 }
    );
  }

  let waChatJid: string;
  try {
    const { data: thread, error: threadErr } = await supabase
      .from("whatsapp_chat_threads")
      .select("wa_chat_jid")
      .eq("id", threadId)
      .eq("business_id", userId!)
      .maybeSingle();

    if (threadErr || !thread) {
      console.error("[chat_messages] step=load_thread", {
        threadId,
        userId,
        message: threadErr?.message,
      });
      return NextResponse.json(
        { error: "That conversation could not be found.", ok: false },
        { status: 404 }
      );
    }
    waChatJid = String(thread.wa_chat_jid);
  } catch (e) {
    console.error("[chat_messages] step=load_thread_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      { error: "That conversation could not be found.", ok: false },
      { status: 500 }
    );
  }

  try {
    const qs = new URLSearchParams({
      business_id: userId!,
      chat_jid: waChatJid,
    }).toString();

    const waFetchStart = Date.now();
    console.info("[chat_messages] step=automation_fetch_start", {
      threadId,
      waChatJid,
      timeoutMs: AUTOMATION_FETCH_MESSAGES_MS,
      routeElapsedMs: waFetchStart - routeStart,
    });

    const res = await automationFetchLong(
      `/whatsapp/chat/messages?${qs}`,
      { method: "GET" },
      AUTOMATION_FETCH_MESSAGES_MS
    );

    const waFetchElapsed = Date.now() - waFetchStart;
    console.info("[chat_messages] step=automation_fetch_complete", {
      threadId,
      httpStatus: res.status,
      ok: res.ok,
      elapsedMs: waFetchElapsed,
    });

    let body: Record<string, unknown>;
    try {
      body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (e) {
      console.error("[chat_messages] step=parse_automation_json", {
        threadId,
        status: res.status,
        err: e instanceof Error ? e.message : String(e),
      });
      return NextResponse.json(
        {
          error: "We couldn’t load messages for this conversation. Try again shortly.",
          ok: false,
        },
        { status: 502 }
      );
    }

    if (!res.ok) {
      const detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
      console.error("[chat_messages] step=automation_upstream_error", {
        threadId,
        httpStatus: res.status,
        detail: detail.slice(0, 400),
      });
      return NextResponse.json(
        {
          error: "We couldn’t load messages for this conversation. Try again shortly.",
          ok: false,
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

    const transcript =
      typeof body.transcript === "string" ? body.transcript.trim() : "";

    const latestRaw = String(body.latest_message_iso ?? "").trim();
    const latestIso =
      latestRaw && !Number.isNaN(Date.parse(latestRaw))
        ? new Date(Date.parse(latestRaw)).toISOString()
        : null;

    // Store the snapshot so the analyze step can read from DB without needing
    // the client to pass the transcript back in the request body.
    if (transcript) {
      const snapshotPayload = {
        snapshot_transcript: transcript,
        snapshot_latest_msg_at: latestIso ?? new Date().toISOString(),
      };
      console.info("[chat_messages] step=store_snapshot_start", {
        threadId,
        transcriptChars: transcript.length,
        latestIso,
      });
      const { error: snapErr } = await supabase
        .from("whatsapp_chat_threads")
        .update(snapshotPayload)
        .eq("id", threadId)
        .eq("business_id", userId!);
      if (snapErr) {
        console.error("[chat_messages] step=store_snapshot_error", {
          threadId,
          message: snapErr.message,
          code: snapErr.code,
        });
      } else {
        console.info("[chat_messages] step=store_snapshot_ok", { threadId });
      }
    } else {
      console.warn("[chat_messages] step=store_snapshot_skipped_empty_transcript", {
        threadId,
        messageCount: messages.length,
      });
    }

    const totalElapsedMs = Date.now() - routeStart;
    console.info("[chat_messages] step=sending_response", {
      threadId,
      messageCount: messages.length,
      transcriptChars: transcript.length,
      hasLatestIso: Boolean(latestIso),
      totalElapsedMs,
    });

    return NextResponse.json({
      ok: true,
      messages,
      transcript,
      latestMessageIso: latestIso,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error("[chat_messages] step=automation_abort_timeout", {
        threadId,
        timeoutMs: AUTOMATION_FETCH_MESSAGES_MS,
        routeElapsedMs: Date.now() - routeStart,
      });
      return NextResponse.json(
        {
          error:
            "Loading the conversation took too long. Try again in a moment.",
          ok: false,
        },
        { status: 504 }
      );
    }
    console.error("[chat_messages] step=unexpected", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      { error: describeAutomationReachabilityError(e), ok: false },
      { status: 502 }
    );
  }
}

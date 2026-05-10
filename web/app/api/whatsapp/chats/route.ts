import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetch,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { canAnalyzeThreadState } from "@/lib/whatsapp-analysis-eligibility";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

type RemoteChat = {
  chat_jid?: string;
  phone_digits?: string;
  display_name?: string;
  last_message_preview?: string;
  last_message_at_ms?: number;
};

type StoredThreadRow = {
  id: string;
  wa_chat_jid: string;
  last_analyzed_at: string | null;
  extraction_watermark_at: string | null;
  last_message_at: string | null;
};

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
      chats: [] as [],
      whatsapp_link_status:
        (profile?.whatsapp_link_status as string) ?? "disconnected",
    });
  }

  try {
    const res = await automationFetch(
      `/whatsapp/chats/list?business_id=${encodeURIComponent(user.id)}`,
      { method: "GET" }
    );

    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!res.ok) {
      const detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? {});
      let code =
        typeof body.detail === "string" &&
        body.detail.includes("cannot_list_chats:not_logged_in")
          ? ("not_logged_in" as const)
          : undefined;
      if (
        typeof detail === "string" &&
        detail.includes("not_logged_in")
      ) {
        code = "not_logged_in";
      }
      return NextResponse.json(
        {
          error: "We couldn’t load your chats right now. Try linking again shortly.",
          serviceConfigured: true,
          chats: [],
          upstreamStatus: res.status,
          code,
          detail:
            process.env.NODE_ENV === "development" ? detail : undefined,
        },
        { status: res.status === 409 ? 409 : 502 }
      );
    }

    const rawChats = Array.isArray(body.chats)
      ? (body.chats as RemoteChat[])
      : [];

    const rows = rawChats
      .filter(
        (c) =>
          typeof c.chat_jid === "string" &&
          typeof c.phone_digits === "string" &&
          c.chat_jid.length > 0
      )
      .map((c) => ({
        business_id: user.id,
        wa_chat_jid: c.chat_jid as string,
        phone_digits: c.phone_digits as string,
        contact_name: typeof c.display_name === "string" ? c.display_name : "",
        last_message_preview:
          typeof c.last_message_preview === "string"
            ? c.last_message_preview.slice(0, 2000)
            : "",
        last_message_at:
          typeof c.last_message_at_ms === "number" && c.last_message_at_ms > 0
            ? new Date(c.last_message_at_ms).toISOString()
            : null,
      }));

    let storedLookup = new Map<string, StoredThreadRow>();

    if (rows.length > 0) {
      const { data: stored, error: upErr } = await supabase
        .from("whatsapp_chat_threads")
        .upsert(rows, {
          onConflict: "business_id,wa_chat_jid",
        })
        .select(
          "id, wa_chat_jid, last_analyzed_at, extraction_watermark_at, last_message_at"
        );

      if (upErr) {
        console.error("[whatsapp/chats] upsert threads failed", upErr);
      } else if (stored) {
        storedLookup = new Map(
          stored.map((row) => [
            row.wa_chat_jid as string,
            row as StoredThreadRow,
          ])
        );
      }
    } else {
      const { data: existing } = await supabase
        .from("whatsapp_chat_threads")
        .select(
          "id, wa_chat_jid, last_analyzed_at, extraction_watermark_at, last_message_at"
        )
        .eq("business_id", user.id);
      storedLookup = new Map(
        (existing ?? []).map((row) => [
          row.wa_chat_jid as string,
          row as StoredThreadRow,
        ])
      );
    }

    const merged = rawChats
      .filter((c) => typeof c.chat_jid === "string")
      .map((c) => {
        const jid = c.chat_jid as string;
        const row = storedLookup.get(jid);
        const liveMs = Number(c.last_message_at_ms || 0);
        const dbMs = row?.last_message_at
          ? Date.parse(String(row.last_message_at))
          : 0;

        let effectiveIso: string | null = null;

        let maxTs = NaN;

        maxTs =
          Number.isFinite(liveMs) && liveMs > 0
            ? Math.max(liveMs, dbMs)
            : dbMs;

        if (Number.isFinite(maxTs) && maxTs > 0) {
          effectiveIso = new Date(maxTs).toISOString();
        } else if (row?.last_message_at) {
          effectiveIso = String(row.last_message_at);
        }

        const canAnalyze = canAnalyzeThreadState({
          last_analyzed_at: row?.last_analyzed_at
            ? String(row.last_analyzed_at)
            : null,
          extraction_watermark_at: row?.extraction_watermark_at
            ? String(row.extraction_watermark_at)
            : null,
          last_message_at: effectiveIso,
        });

        const phoneDigits =
          typeof c.phone_digits === "string" ? c.phone_digits : "";
        const display =
          typeof c.display_name === "string"
            ? c.display_name.trim()
            : phoneDigits || "Contact";

        return {
          threadId: row?.id ?? null,
          chatJid: jid,
          phoneDigits,
          displayName: display,
          preview:
            typeof c.last_message_preview === "string"
              ? c.last_message_preview
              : "",
          lastMessageAt: effectiveIso,
          lastMessageMs: Number.isFinite(maxTs) ? maxTs : null,
          canAnalyze,
          lastAnalyzedAt: row?.last_analyzed_at ?? null,
        };
      });

    merged.sort((a, b) => {
      const am = typeof a.lastMessageMs === "number" ? a.lastMessageMs : 0;
      const bm = typeof b.lastMessageMs === "number" ? b.lastMessageMs : 0;
      return bm - am;
    });

    const { data: waProfile } = await supabase
      .from("profiles")
      .select("whatsapp_link_status")
      .eq("id", user.id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      serviceConfigured: true,
      chats: merged,
      whatsapp_link_status:
        (waProfile?.whatsapp_link_status as string) ?? "disconnected",
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
    console.error("[whatsapp/chats] GET", e);

    const dev =
      process.env.NODE_ENV === "development"
        ? { detail: describeAutomationReachabilityError(e) }
        : {};
    return NextResponse.json(
      {
        ...dev,
        error: "Something went wrong. Try again shortly.",
      },
      { status: 502 }
    );
  }
}

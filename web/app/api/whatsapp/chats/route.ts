import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetch,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { canAnalyzeThreadState } from "@/lib/whatsapp-analysis-eligibility";
import { createClient } from "@/lib/supabase/server";
import { syncWhatsappProfile } from "@/lib/whatsapp-profile-sync";

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
  phone_digits: string | null;
  contact_name: string | null;
  last_message_preview: string | null;
  last_analyzed_at: string | null;
  extraction_watermark_at: string | null;
  last_message_at: string | null;
};

function toChatPayloadFromStored(rows: StoredThreadRow[]) {
  return rows
    .map((row) => {
      const effectiveIso = row.last_message_at ? String(row.last_message_at) : null;
      const lastMs = effectiveIso ? Date.parse(effectiveIso) : NaN;
      return {
        threadId: String(row.id),
        chatJid: String(row.wa_chat_jid),
        phoneDigits: String(row.phone_digits ?? ""),
        displayName:
          String(row.contact_name ?? "").trim() ||
          String(row.phone_digits ?? "") ||
          "Contact",
        preview: String(row.last_message_preview ?? ""),
        lastMessageAt: effectiveIso,
        lastMessageMs: Number.isFinite(lastMs) ? lastMs : null,
        canAnalyze: canAnalyzeThreadState({
          last_analyzed_at: row.last_analyzed_at
            ? String(row.last_analyzed_at)
            : null,
          extraction_watermark_at: row.extraction_watermark_at
            ? String(row.extraction_watermark_at)
            : null,
          last_message_at: effectiveIso,
        }),
        lastAnalyzedAt: row.last_analyzed_at ?? null,
      };
    })
    .sort((a, b) => {
      const am = typeof a.lastMessageMs === "number" ? a.lastMessageMs : 0;
      const bm = typeof b.lastMessageMs === "number" ? b.lastMessageMs : 0;
      return bm - am;
    });
}

function parseChatsListFailureCode(detail: string): string {
  const prefix = "cannot_list_chats:";
  const idx = detail.indexOf(prefix);
  if (idx !== -1) {
    const rest = detail.slice(idx + prefix.length).trim();
    return (rest.split(/[\s,]/)[0] || "unknown").trim();
  }
  if (detail.includes("not_logged_in")) return "not_logged_in";
  if (detail.includes("chat_list_timeout")) return "chat_list_timeout";
  return "unknown";
}

function userSafeWarningForListFailure(failureCode: string): string {
  if (failureCode === "not_logged_in") {
    return "We couldn't confirm an active WhatsApp session. Open Settings to reconnect, then try Refresh.";
  }
  if (failureCode === "chat_list_timeout") {
    return "WhatsApp took too long to load. Wait a moment and tap Refresh.";
  }
  return "Live WhatsApp is temporarily unavailable. Showing any conversations already saved for your account.";
}

async function refreshWhatsappLinkFromAutomationProbe(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> {
  try {
    const res = await automationFetch(
      `/whatsapp/session/status?business_id=${encodeURIComponent(userId)}`,
      { method: "GET" }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return;
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
    await syncWhatsappProfile(supabase, userId, remote, upstreamPhone);
  } catch {
    /* keep prior profile if probe fails */
  }
}

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
      const failureCode =
        typeof detail === "string"
          ? parseChatsListFailureCode(detail)
          : "unknown";

      await refreshWhatsappLinkFromAutomationProbe(supabase, user.id);

      const correlationId = randomUUID();
      console.info(
        "[whatsapp/chats]",
        JSON.stringify({
          tag: "chats_list_upstream_error",
          correlationId,
          businessId: user.id,
          upstreamHttpStatus: res.status,
          failureCode,
          upstreamDetail:
            typeof detail === "string" ? detail.slice(0, 400) : String(detail),
        })
      );

      const { data: existing } = await supabase
        .from("whatsapp_chat_threads")
        .select(
          [
            "id",
            "wa_chat_jid",
            "phone_digits",
            "contact_name",
            "last_message_preview",
            "last_analyzed_at",
            "extraction_watermark_at",
            "last_message_at",
          ].join(",")
        )
        .eq("business_id", user.id);

      const fallbackRows = toChatPayloadFromStored(
        (existing ?? []) as unknown as StoredThreadRow[]
      );
      const { data: waProfile } = await supabase
        .from("profiles")
        .select("whatsapp_link_status")
        .eq("id", user.id)
        .maybeSingle();

      return NextResponse.json({
        ok: false,
        warning: userSafeWarningForListFailure(failureCode),
        serviceConfigured: true,
        chats: fallbackRows,
        upstreamStatus: res.status,
        code: failureCode,
        diagnostics: {
          correlationId,
          failureCode,
          upstreamHttpStatus: res.status,
          upstreamDetailSnippet:
            typeof detail === "string" ? detail.slice(0, 240) : undefined,
        },
        whatsapp_link_status:
          (waProfile?.whatsapp_link_status as string) ?? "disconnected",
        detail: process.env.NODE_ENV === "development" ? detail : undefined,
      });
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
      const { error: upErr } = await supabase
        .from("whatsapp_chat_threads")
        .upsert(rows, {
          onConflict: "business_id,wa_chat_jid",
        });

      if (upErr) {
        console.error("[whatsapp/chats] upsert threads failed", upErr);
      }
    }

    // Always SELECT after upsert so storedLookup is populated even when the
    // upsert fails or returns no data (e.g. RLS, constraint, or client quirk).
    {
      const { data: allStored } = await supabase
        .from("whatsapp_chat_threads")
        .select(
          [
            "id",
            "wa_chat_jid",
            "phone_digits",
            "contact_name",
            "last_message_preview",
            "last_analyzed_at",
            "extraction_watermark_at",
            "last_message_at",
          ].join(",")
        )
        .eq("business_id", user.id);
      const typedStored = (allStored ?? []) as unknown as StoredThreadRow[];
      storedLookup = new Map(
        typedStored.map((row) => [row.wa_chat_jid as string, row])
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
    const correlationId = randomUUID();
    console.error("[whatsapp/chats] GET", e);
    console.info(
      "[whatsapp/chats]",
      JSON.stringify({
        tag: "chats_list_exception",
        correlationId,
        businessId: user.id,
        message: e instanceof Error ? e.message : String(e),
      })
    );

    const dev =
      process.env.NODE_ENV === "development"
        ? { detail: describeAutomationReachabilityError(e) }
        : {};
    const { data: existing } = await supabase
      .from("whatsapp_chat_threads")
      .select(
        [
          "id",
          "wa_chat_jid",
          "phone_digits",
          "contact_name",
          "last_message_preview",
          "last_analyzed_at",
          "extraction_watermark_at",
          "last_message_at",
        ].join(",")
      )
      .eq("business_id", user.id);
    const { data: waProfile } = await supabase
      .from("profiles")
      .select("whatsapp_link_status")
      .eq("id", user.id)
      .maybeSingle();

    return NextResponse.json({
      ...dev,
      ok: false,
      warning:
        "Live WhatsApp is temporarily unavailable. Showing your last synced chats.",
      serviceConfigured: true,
      chats: toChatPayloadFromStored(
        (existing ?? []) as unknown as StoredThreadRow[]
      ),
      whatsapp_link_status:
        (waProfile?.whatsapp_link_status as string) ?? "disconnected",
      error: "Something went wrong. Try again shortly.",
      code: "upstream_unreachable",
      diagnostics: {
        correlationId,
        failureCode: "upstream_unreachable",
      },
    });
  }
}

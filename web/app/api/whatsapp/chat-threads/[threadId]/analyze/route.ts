import { NextResponse } from "next/server";

import {
  automationConfigured,
  automationFetch,
  describeAutomationReachabilityError,
} from "@/lib/chatlog-automation";
import { loadInventoryCatalogVariants } from "@/lib/inventory/catalogue-loader";
import { toNumber } from "@/lib/inventory/helpers";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import {
  extractOrdersStructuredJson,
  type ParsedExtractionPayload,
} from "@/lib/order-extractor";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

export async function POST(
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
    .select(
      "id, business_id, wa_chat_jid, last_analyzed_at, extraction_watermark_at, last_message_at"
    )
    .eq("id", threadId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (threadErr || !thread) {
    return NextResponse.json(
      { error: "That conversation could not be found." },
      { status: 404 }
    );
  }

  let msgPayload: Record<string, unknown>;

  try {
    const qs = new URLSearchParams({
      business_id: user.id,
      chat_jid: String(thread.wa_chat_jid),
    }).toString();
    const mr = await automationFetch(`/whatsapp/chat/messages?${qs}`, {
      method: "GET",
    });

    msgPayload = (await mr.json().catch(() => ({}))) as Record<string, unknown>;

    if (!mr.ok) {
      const detail =
        typeof msgPayload.detail === "string"
          ? msgPayload.detail
          : JSON.stringify(msgPayload.detail ?? msgPayload ?? {});
      const dev =
        process.env.NODE_ENV === "development"
          ? { detail }
          : ({} as Record<string, unknown>);
      return NextResponse.json(
        {
          error: "We couldn’t read this conversation. Try again in a minute.",
          ...dev,
        },
        { status: mr.status >= 400 && mr.status < 600 ? mr.status : 502 }
      );
    }
  } catch (e) {
    console.error("[analyze] message fetch", e);
    return NextResponse.json(
      {
        error:
          describeAutomationReachabilityError(e),
      },
      { status: 502 }
    );
  }

  const transcript = String(msgPayload.transcript ?? "").trim();
  const latestIsoRaw = String(msgPayload.latest_message_iso ?? "").trim();
  const latestMs = Date.parse(latestIsoRaw);

  if (!transcript) {
    return NextResponse.json(
      {
        error:
          "This chat has no readable messages yet. Try again after the customer writes something.",
      },
      { status: 422 }
    );
  }

  const analysedBefore = Boolean(thread.last_analyzed_at);
  const watermarkMs = thread.extraction_watermark_at
    ? Date.parse(String(thread.extraction_watermark_at))
    : NaN;

  if (
    analysedBefore &&
    Number.isFinite(watermarkMs) &&
    Number.isFinite(latestMs) &&
    latestMs <= watermarkMs
  ) {
    return NextResponse.json(
      {
        error:
          "There’s nothing new to extract since your last analysis. Wait for a new customer message or reset the analysis.",
      },
      { status: 409 }
    );
  }

  let catalogue;
  try {
    catalogue = await loadInventoryCatalogVariants(supabase, user.id);
  } catch {
    return NextResponse.json(
      {
        error:
          "Add at least one product in Inventory before extracting orders from chats.",
      },
      { status: 422 }
    );
  }

  if (catalogue.length < 1) {
    return NextResponse.json(
      {
        error:
          "Add at least one product in Inventory before extracting orders from chats.",
      },
      { status: 422 }
    );
  }

  const variantLookup = new Map(
    catalogue.map((row) => [row.variant_id, row] as const)
  );
  const catalogueJson = JSON.stringify(catalogue, null, 2);

  let extraction: ParsedExtractionPayload;
  try {
    extraction = await extractOrdersStructuredJson({
      transcript,
      catalogueJson,
    });
  } catch (e) {
    console.error("[analyze] AI extraction failed", e);
    return NextResponse.json(
      {
        error:
          "We couldn’t extract orders automatically right now. Try again in a few minutes.",
      },
      { status: 502 }
    );
  }

  const nowIso = new Date().toISOString();
  const mergedLatestIso = Number.isFinite(latestMs)
    ? new Date(latestMs).toISOString()
    : nowIso;

  const prevMsgMs = thread.last_message_at
    ? Date.parse(String(thread.last_message_at))
    : NaN;
  const mergedLastMessageIso =
    Number.isFinite(prevMsgMs) && Number.isFinite(latestMs)
      ? new Date(Math.max(prevMsgMs, latestMs)).toISOString()
      : Number.isFinite(latestMs)
        ? mergedLatestIso
        : thread.last_message_at
          ? String(thread.last_message_at)
          : mergedLatestIso;

  const insertRows: Record<string, unknown>[] = [];

  for (const raw of extraction.items) {
    let unresolved = Boolean(raw.unresolved);
    let vid =
      typeof raw.matched_variant_id === "string"
        ? raw.matched_variant_id.trim()
        : null;
    if (vid && !variantLookup.has(vid)) {
      unresolved = true;
      vid = null;
    }

    let qty =
      typeof raw.quantity === "number"
        ? raw.quantity
        : typeof raw.quantity === "string"
          ? Number.parseFloat(raw.quantity)
          : 1;
    if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    if (qty > 1_000_000_000) qty = 1_000_000_000;

    let unitPrice: number | null =
      typeof raw.unit_price === "number"
        ? raw.unit_price
        : typeof raw.unit_price === "string"
          ? Number.parseFloat(raw.unit_price)
          : null;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      unitPrice = null;
    }
    if (unitPrice === null && vid) {
      unitPrice = variantLookup.get(vid)!.selling_price;
    }

    let confidence =
      typeof raw.confidence === "number"
        ? raw.confidence
        : typeof raw.confidence === "string"
          ? Number.parseFloat(raw.confidence)
          : 0.35;
    if (!Number.isFinite(confidence)) confidence = 0.35;
    confidence = Math.min(1, Math.max(0, confidence));

    const productId = vid ? variantLookup.get(vid)!.product_id : null;

    if (unresolved) {
      vid = null;
    }

    insertRows.push({
      business_id: user.id,
      chat_thread_id: thread.id,
      product_id: unresolved ? null : productId,
      product_variant_id: unresolved ? null : vid,
      quantity: qty,
      unit_price: unitPrice,
      confidence,
      unresolved,
      evidence: String(raw.evidence ?? "").slice(0, 2000),
      special_instructions: raw.special_instructions
        ? String(raw.special_instructions).slice(0, 2000)
        : null,
      ai_product_label: String(raw.product_customer_text ?? "").slice(0, 400),
      ai_variant_label: String(raw.variant_customer_text ?? "").slice(0, 400),
    });
  }

  const { error: delErr } = await supabase
    .from("whatsapp_extracted_order_lines")
    .delete()
    .eq("chat_thread_id", thread.id)
    .eq("business_id", user.id);

  if (delErr) {
    console.error("[analyze] delete prior lines", delErr);
    return NextResponse.json(
      { error: "We couldn’t save the analysis. Try again." },
      { status: 500 }
    );
  }

  if (insertRows.length > 0) {
    const { error: insErr } = await supabase
      .from("whatsapp_extracted_order_lines")
      .insert(insertRows);
    if (insErr) {
      console.error("[analyze] insert lines", insErr);
      return NextResponse.json(
        { error: "We couldn’t save the analysis. Try again." },
        { status: 500 }
      );
    }
  }

  const { error: upThreadErr } = await supabase
    .from("whatsapp_chat_threads")
    .update({
      last_analyzed_at: nowIso,
      extraction_watermark_at: mergedLatestIso,
      last_message_at: mergedLastMessageIso,
    })
    .eq("id", thread.id)
    .eq("business_id", user.id);

  if (upThreadErr) {
    console.error("[analyze] update thread", upThreadErr);
  }

  return NextResponse.json({
    ok: true,
    analyzedAt: nowIso,
    lineCount: insertRows.length,
    latestMessageAt: mergedLatestIso,
    estimatedTotal: formatMoneyAmount(
      insertRows.reduce((sum, row) => {
        const q = toNumber(row.quantity);
        const p = row.unit_price == null ? 0 : toNumber(row.unit_price);
        return sum + q * p;
      }, 0)
    ),
  });
}

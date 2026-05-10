import { NextResponse } from "next/server";

import { loadInventoryCatalogVariants } from "@/lib/inventory/catalogue-loader";
import { toNumber } from "@/lib/inventory/helpers";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import {
  extractOrdersStructuredJson,
  type ParsedExtractionPayload,
} from "@/lib/order-extractor";
import { createClient } from "@/lib/supabase/server";
import {
  applyInventoryForInsertedLines,
  REASON_RESTORE_BEFORE_REPLACE,
  restoreInventoryForExtractionLines,
  type ExtractionLineRow,
} from "@/lib/whatsapp-extraction-stock";

/**
 * Stay within Vercel Hobby / typical free-tier ~60s execution: this route only
 * runs AI + DB. The client loads messages in a separate request first.
 */
export const maxDuration = 60;

const MAX_TRANSCRIPT_CHARS = 600_000;

type AnalyzeBody = {
  transcript?: unknown;
  latestMessageIso?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: { threadId: string } }
) {
  const threadId = params.threadId?.trim();
  if (!threadId) {
    console.error("[analyze] step=validate_thread_param missing_thread_id");
    return NextResponse.json(
      { ok: false as const, error: "Missing chat." },
      { status: 400 }
    );
  }

  let body: AnalyzeBody;
  try {
    body = (await request.json()) as AnalyzeBody;
  } catch (e) {
    console.error("[analyze] step=parse_json_body", {
      threadId,
      err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false as const, error: "Invalid request." },
      { status: 400 }
    );
  }

  const transcriptRaw =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  const latestIsoRaw =
    typeof body.latestMessageIso === "string"
      ? body.latestMessageIso.trim()
      : "";

  if (!transcriptRaw) {
    console.error("[analyze] step=validate_body missing_transcript", {
      threadId,
      hadTranscriptKey: "transcript" in body,
    });
    return NextResponse.json(
      {
        ok: false as const,
        error:
          "No conversation text was sent. Refresh this page and try Analyze again.",
      },
      { status: 400 }
    );
  }

  if (transcriptRaw.length > MAX_TRANSCRIPT_CHARS) {
    console.error("[analyze] step=validate_body transcript_too_large", {
      threadId,
      length: transcriptRaw.length,
    });
    return NextResponse.json(
      {
        ok: false as const,
        error: "This conversation is too long to process in one step.",
      },
      { status: 413 }
    );
  }

  const supabase = createClient();
  let userId: string | undefined;

  try {
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr) {
      console.error("[analyze] step=auth_getUser", {
        threadId,
        message: authErr.message,
        code: authErr.status,
      });
      return NextResponse.json(
        { ok: false as const, error: "Unauthorized" },
        { status: 401 }
      );
    }
    if (!user) {
      console.error("[analyze] step=auth_getUser no_user", { threadId });
      return NextResponse.json(
        { ok: false as const, error: "Unauthorized" },
        { status: 401 }
      );
    }
    userId = user.id;
  } catch (e) {
    console.error("[analyze] step=auth_getUser_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false as const, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let thread: {
    id: string;
    last_analyzed_at: string | null;
    extraction_watermark_at: string | null;
    last_message_at: string | null;
  } | null = null;

  try {
    const { data: row, error: threadErr } = await supabase
      .from("whatsapp_chat_threads")
      .select(
        "id, business_id, last_analyzed_at, extraction_watermark_at, last_message_at"
      )
      .eq("id", threadId)
      .eq("business_id", userId!)
      .maybeSingle();

    if (threadErr) {
      console.error("[analyze] step=load_thread", {
        threadId,
        userId,
        message: threadErr.message,
        code: threadErr.code,
        details: threadErr.details,
      });
      return NextResponse.json(
        {
          ok: false as const,
          error: "That conversation could not be found.",
        },
        { status: 404 }
      );
    }
    if (!row) {
      console.error("[analyze] step=load_thread not_found", { threadId, userId });
      return NextResponse.json(
        {
          ok: false as const,
          error: "That conversation could not be found.",
        },
        { status: 404 }
      );
    }
    thread = row;
  } catch (e) {
    console.error("[analyze] step=load_thread_throw", {
      threadId,
      userId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false as const, error: "That conversation could not be found." },
      { status: 500 }
    );
  }

  const transcript = transcriptRaw;
  const latestMs = Date.parse(latestIsoRaw);

  if (!Number.isFinite(latestMs)) {
    console.warn("[analyze] step=watermark invalid_latest_iso", {
      threadId,
      latestIsoPreview: latestIsoRaw.slice(0, 80),
    });
  }

  const analysedBefore = Boolean(thread!.last_analyzed_at);
  const watermarkMs = thread!.extraction_watermark_at
    ? Date.parse(String(thread!.extraction_watermark_at))
    : NaN;

  if (
    analysedBefore &&
    Number.isFinite(watermarkMs) &&
    Number.isFinite(latestMs) &&
    latestMs <= watermarkMs
  ) {
    console.info("[analyze] step=skip_up_to_date", { threadId });
    return NextResponse.json(
      {
        ok: false as const,
        error:
          "Everything is already up to date for this thread. When a new message arrives, you can run another interpretation.",
      },
      { status: 409 }
    );
  }

  let catalogue;
  try {
    catalogue = await loadInventoryCatalogVariants(supabase, userId!);
  } catch (e) {
    console.error("[analyze] step=load_catalogue", {
      threadId,
      userId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false as const,
        error:
          "Add at least one product in Inventory before interpreting orders from conversations.",
      },
      { status: 422 }
    );
  }

  if (catalogue.length < 1) {
    console.error("[analyze] step=load_catalogue empty", { threadId, userId });
    return NextResponse.json(
      {
        ok: false as const,
        error:
          "Add at least one product in Inventory before interpreting orders from conversations.",
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
    console.error("[analyze] step=ai_extract", {
      threadId,
      userId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false as const,
        error:
          "We couldn’t interpret this conversation right now. Try again in a few minutes.",
      },
      { status: 502 }
    );
  }

  const nowIso = new Date().toISOString();
  const mergedLatestIso = Number.isFinite(latestMs)
    ? new Date(latestMs).toISOString()
    : nowIso;

  const prevMsgMs = thread!.last_message_at
    ? Date.parse(String(thread!.last_message_at))
    : NaN;
  const mergedLastMessageIso =
    Number.isFinite(prevMsgMs) && Number.isFinite(latestMs)
      ? new Date(Math.max(prevMsgMs, latestMs)).toISOString()
      : Number.isFinite(latestMs)
        ? mergedLatestIso
        : thread!.last_message_at
          ? String(thread!.last_message_at)
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
      business_id: userId,
      chat_thread_id: thread!.id,
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

  let priorLines: ExtractionLineRow[] = [];
  try {
    const { data: priorRows, error: priorErr } = await supabase
      .from("whatsapp_extracted_order_lines")
      .select(
        "id, product_variant_id, unresolved, quantity, stock_units_applied"
      )
      .eq("chat_thread_id", thread!.id)
      .eq("business_id", userId!);

    if (priorErr) {
      console.error("[analyze] step=load_prior_lines", {
        threadId,
        message: priorErr.message,
        code: priorErr.code,
      });
      return NextResponse.json(
        {
          ok: false as const,
          error: "We couldn’t update this interpretation. Try again.",
        },
        { status: 500 }
      );
    }
    priorLines = (priorRows ?? []) as unknown as ExtractionLineRow[];
  } catch (e) {
    console.error("[analyze] step=load_prior_lines_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false as const,
        error: "We couldn’t update this interpretation. Try again.",
      },
      { status: 500 }
    );
  }

  try {
    const restoreOld = await restoreInventoryForExtractionLines(
      supabase,
      priorLines,
      REASON_RESTORE_BEFORE_REPLACE
    );
    if (restoreOld.error) {
      console.error("[analyze] step=restore_inventory_prior", {
        threadId,
        message: restoreOld.error,
      });
      return NextResponse.json(
        { ok: false as const, error: restoreOld.error },
        { status: 422 }
      );
    }
  } catch (e) {
    console.error("[analyze] step=restore_inventory_prior_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false as const,
        error: "We couldn’t update inventory for this thread. Try again.",
      },
      { status: 500 }
    );
  }

  try {
    const { error: delErr } = await supabase
      .from("whatsapp_extracted_order_lines")
      .delete()
      .eq("chat_thread_id", thread!.id)
      .eq("business_id", userId!);

    if (delErr) {
      console.error("[analyze] step=delete_prior_lines", {
        threadId,
        message: delErr.message,
        code: delErr.code,
      });
      return NextResponse.json(
        {
          ok: false as const,
          error: "We couldn’t save the interpretation. Try again.",
        },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("[analyze] step=delete_prior_lines_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false as const,
        error: "We couldn’t save the interpretation. Try again.",
      },
      { status: 500 }
    );
  }

  if (insertRows.length > 0) {
    try {
      const { data: inserted, error: insErr } = await supabase
        .from("whatsapp_extracted_order_lines")
        .insert(insertRows)
        .select("id, product_variant_id, unresolved, quantity");

      if (insErr || !inserted) {
        console.error("[analyze] step=insert_lines", {
          threadId,
          message: insErr?.message,
          code: insErr?.code,
        });
        return NextResponse.json(
          {
            ok: false as const,
            error: "We couldn’t save the interpretation. Try again.",
          },
          { status: 500 }
        );
      }

      const rowsForStock = inserted as {
        id: string;
        product_variant_id: string | null;
        unresolved: boolean;
        quantity: unknown;
      }[];

      const inv = await applyInventoryForInsertedLines(supabase, rowsForStock);
      if (inv.error) {
        console.error("[analyze] step=apply_inventory", {
          threadId,
          message: inv.error,
        });
        const { error: rmErr } = await supabase
          .from("whatsapp_extracted_order_lines")
          .delete()
          .eq("chat_thread_id", thread!.id)
          .eq("business_id", userId!);
        if (rmErr) {
          console.error("[analyze] step=cleanup_lines_after_inventory_failure", {
            threadId,
            message: rmErr.message,
          });
        }
        return NextResponse.json(
          { ok: false as const, error: inv.error },
          { status: 422 }
        );
      }
    } catch (e) {
      console.error("[analyze] step=insert_or_inventory_throw", {
        threadId,
        err: e instanceof Error ? e.stack ?? e.message : String(e),
      });
      return NextResponse.json(
        {
          ok: false as const,
          error: "We couldn’t save the interpretation. Try again.",
        },
        { status: 500 }
      );
    }
  }

  try {
    const { error: upThreadErr } = await supabase
      .from("whatsapp_chat_threads")
      .update({
        last_analyzed_at: nowIso,
        extraction_watermark_at: mergedLatestIso,
        last_message_at: mergedLastMessageIso,
      })
      .eq("id", thread!.id)
      .eq("business_id", userId!);

    if (upThreadErr) {
      console.error("[analyze] step=update_thread", {
        threadId,
        message: upThreadErr.message,
        code: upThreadErr.code,
      });
      return NextResponse.json(
        {
          ok: false as const,
          error: "We couldn’t save this thread’s status. Try again.",
        },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("[analyze] step=update_thread_throw", {
      threadId,
      err: e instanceof Error ? e.stack ?? e.message : String(e),
    });
    return NextResponse.json(
      {
        ok: false as const,
        error: "We couldn’t save this thread’s status. Try again.",
      },
      { status: 500 }
    );
  }

  console.info("[analyze] step=done_ok", {
    threadId,
    userId,
    lineCount: insertRows.length,
  });

  return NextResponse.json({
    ok: true as const,
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

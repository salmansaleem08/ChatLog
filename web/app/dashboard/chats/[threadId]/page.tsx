import { notFound } from "next/navigation";

import { ChatDetailClient } from "@/components/dashboard/chats/chat-detail-client";
import { canAnalyzeThreadState } from "@/lib/whatsapp-analysis-eligibility";
import { toNumber } from "@/lib/inventory/helpers";
import { createClient } from "@/lib/supabase/server";

type LineRow = {
  id: unknown;
  quantity: unknown;
  unit_price: unknown;
  confidence: unknown;
  unresolved: unknown;
  ai_product_label: unknown;
  ai_variant_label: unknown;
  product_variant_id: unknown;
};

export default async function ChatThreadDetailPage({
  params,
}: {
  params: { threadId: string };
}) {
  const threadId = params.threadId?.trim();
  if (!threadId) {
    notFound();
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: thread, error: tErr } = await supabase
    .from("whatsapp_chat_threads")
    .select(
      "id, contact_name, phone_digits, last_message_at, last_analyzed_at, extraction_watermark_at"
    )
    .eq("id", threadId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (tErr || !thread) {
    notFound();
  }

  const { data: lineRows } = await supabase
    .from("whatsapp_extracted_order_lines")
    .select(
      [
        "id",
        "quantity",
        "unit_price",
        "confidence",
        "unresolved",
        "ai_product_label",
        "ai_variant_label",
        "product_variant_id",
      ].join(",")
    )
    .eq("chat_thread_id", threadId)
    .eq("business_id", user.id)
    .order("created_at", { ascending: true });

  const rawLines = (lineRows ?? []) as unknown as LineRow[];
  const variantIds = Array.from(
    new Set(
      rawLines
        .map((l) =>
          typeof l.product_variant_id === "string" ? l.product_variant_id : null
        )
        .filter(Boolean) as string[]
    )
  );

  const metaByVariant = new Map<
    string,
    { attrs: Record<string, string>; productName: string | null }
  >();

  if (variantIds.length > 0) {
    const { data: vrows } = await supabase
      .from("product_variants")
      .select("id,attributes,products(name,business_id)")
      .in("id", variantIds);

    for (const v of vrows ?? []) {
      const row = v as {
        id: string;
        attributes?: unknown;
        products?: { name?: string | null; business_id?: string | null } | null;
      };
      if (row.products?.business_id !== user.id) continue;
      const rawAttr = row.attributes;
      const attrs =
        rawAttr && typeof rawAttr === "object" && !Array.isArray(rawAttr)
          ? (rawAttr as Record<string, string>)
          : {};
      const productName = String(row.products?.name ?? "");
      metaByVariant.set(row.id, {
        attrs,
        productName: productName || null,
      });
    }
  }

  const lines = rawLines.map((l) => {
    const vid =
      typeof l.product_variant_id === "string" ? l.product_variant_id : null;
    const meta = vid ? metaByVariant.get(vid) : undefined;
    return {
      id: String(l.id),
      quantity: toNumber(l.quantity),
      unitPrice:
        l.unit_price === null || l.unit_price === undefined
          ? null
          : toNumber(l.unit_price),
      confidence: toNumber(l.confidence),
      unresolved: Boolean(l.unresolved),
      aiProduct: String(l.ai_product_label ?? ""),
      aiVariant: String(l.ai_variant_label ?? ""),
      matchedProduct: meta?.productName ?? null,
      matchedVariantAttrs: meta?.attrs ?? null,
    };
  });

  const canAnalyze = canAnalyzeThreadState({
    last_analyzed_at: thread.last_analyzed_at
      ? String(thread.last_analyzed_at)
      : null,
    extraction_watermark_at: thread.extraction_watermark_at
      ? String(thread.extraction_watermark_at)
      : null,
    last_message_at: thread.last_message_at
      ? String(thread.last_message_at)
      : null,
  });

  return (
    <ChatDetailClient
      threadId={threadId}
      displayName={String(thread.contact_name ?? "").trim() || "Customer"}
      phoneDigits={String(thread.phone_digits ?? "")}
      lastMessageAt={
        thread.last_message_at ? String(thread.last_message_at) : null
      }
      lastAnalyzedAt={
        thread.last_analyzed_at ? String(thread.last_analyzed_at) : null
      }
      canAnalyze={canAnalyze}
      lines={lines}
    />
  );
}

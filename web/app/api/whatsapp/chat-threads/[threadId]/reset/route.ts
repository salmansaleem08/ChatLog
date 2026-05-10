import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  restoreInventoryForExtractionLines,
  type ExtractionLineRow,
} from "@/lib/whatsapp-extraction-stock";

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

  const { data: lines, error: loadErr } = await supabase
    .from("whatsapp_extracted_order_lines")
    .select(
      "id, product_variant_id, unresolved, quantity, stock_units_applied"
    )
    .eq("chat_thread_id", threadId)
    .eq("business_id", user.id);

  if (loadErr) {
    console.error("[delete analysis] load lines", loadErr);
    return NextResponse.json(
      { error: "We couldn’t remove this interpretation. Try again." },
      { status: 500 }
    );
  }

  const typed = (lines ?? []) as unknown as ExtractionLineRow[];
  const restore = await restoreInventoryForExtractionLines(supabase, typed);
  if (restore.error) {
    return NextResponse.json({ error: restore.error }, { status: 422 });
  }

  const { error: delLines } = await supabase
    .from("whatsapp_extracted_order_lines")
    .delete()
    .eq("chat_thread_id", threadId)
    .eq("business_id", user.id);

  if (delLines) {
    console.error("[delete analysis] delete lines", delLines);
    return NextResponse.json(
      { error: "We couldn’t remove this interpretation. Try again." },
      { status: 500 }
    );
  }

  const { error: upThread } = await supabase
    .from("whatsapp_chat_threads")
    .update({
      last_analyzed_at: null,
      extraction_watermark_at: null,
    })
    .eq("id", threadId)
    .eq("business_id", user.id);

  if (upThread) {
    console.error("[delete analysis] thread", upThread);
    return NextResponse.json(
      { error: "We couldn’t reset this conversation. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

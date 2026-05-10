import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

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

  const { error: delLines } = await supabase
    .from("whatsapp_extracted_order_lines")
    .delete()
    .eq("chat_thread_id", threadId)
    .eq("business_id", user.id);

  if (delLines) {
    console.error("[reset] delete lines", delLines);
    return NextResponse.json(
      { error: "We couldn’t reset this analysis. Try again." },
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
    console.error("[reset] thread", upThread);
    return NextResponse.json(
      { error: "We couldn’t reset this analysis. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

/** Server-only; never mention provider names in surfaced errors — log here if needed. */

export type InventoryCatalogVariant = {
  variant_id: string;
  product_id: string;
  product_name: string;
  variant_label: string;
  selling_price: number;
};

export type ExtractedAiLineRaw = {
  matched_variant_id: string | null;
  unresolved: boolean;
  product_customer_text: string;
  variant_customer_text?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  special_instructions?: string | null;
  evidence?: string | null;
  confidence?: number | null;
};

export type ParsedExtractionPayload = {
  items: ExtractedAiLineRaw[];
};

const SYSTEM_JSON_RULES =
  "Respond with JSON ONLY. Shape: {\"items\":[{\"matched_variant_id\":string|null," +
  '"unresolved":boolean,"product_customer_text":string,' +
  '"variant_customer_text":string|null,"quantity":number,"unit_price":number|null,' +
  '"special_instructions":string|null,"evidence":string,"confidence":number}]}';

function buildPrompt(
  transcript: string,
  catalogueJson: string
): { user: string; system: string } {
  const system = [
    "You classify customer WhatsApp conversations for a retailer.",
    "Each item must cite evidence copied from chat text.",
    "Only set matched_variant_id when you match an exact catalogue variant_id.",
    "If uncertain, unresolved must be true and matched_variant_id null.",
    SYSTEM_JSON_RULES,
  ].join("\n");

  const user = [
    "Catalogue variants (trusted):",
    catalogueJson,
    "",
    "Chat transcript (mixed sender labels):",
    transcript,
    "",
    "Identify purchasable order lines spoken by the customer.",
  ].join("\n");

  return { user, system };
}

export async function extractOrdersStructuredJson(payload: {
  transcript: string;
  catalogueJson: string;
}): Promise<ParsedExtractionPayload> {
  const { user, system } = buildPrompt(payload.transcript, payload.catalogueJson);
  try {
    return await geminiExtract(user, system);
  } catch (firstErr) {
    console.warn("[extractOrders] Primary model failed:", firstErr);
    try {
      return await openRouterExtract(user, system);
    } catch {
      throw firstErr;
    }
  }
}

async function geminiExtract(
  userPrompt: string,
  systemPrompt: string
): Promise<ParsedExtractionPayload> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new Error("GEMINI_KEY_MISSING");
  }
  const model =
    process.env.GEMINI_MODEL?.trim()?.replace(/^["']+|["']+$/g, "") ||
    "gemini-1.5-flash";

  console.info("[order-extractor] step=gemini_start", {
    model,
    promptChars: userPrompt.length + systemPrompt.length,
  });
  const geminiStart = Date.now();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });

  const raw = (await res.json()) as Record<string, unknown>;
  const geminiElapsed = Date.now() - geminiStart;
  if (!res.ok) {
    console.error("[order-extractor] step=gemini_failed", {
      model,
      httpStatus: res.status,
      elapsedMs: geminiElapsed,
      errorCode: (raw.error as Record<string, unknown> | undefined)?.code,
    });
    throw new Error("GEMINI_FAILED");
  }

  console.info("[order-extractor] step=gemini_done", {
    model,
    httpStatus: res.status,
    elapsedMs: geminiElapsed,
  });

  const text = extractGeminiText(raw);
  return parseJsonPayload(text);
}

function extractGeminiText(raw: Record<string, unknown>): string {
  const candidates = raw.candidates as unknown;
  if (!Array.isArray(candidates) || candidates.length < 1) {
    throw new Error("GEMINI_EMPTY");
  }
  const content = (candidates[0] as { content?: { parts?: { text?: string }[] } })
    .content;
  const parts = content?.parts;
  if (!Array.isArray(parts) || !parts[0]?.text) {
    throw new Error("GEMINI_PARTS");
  }
  return String(parts[0].text);
}

async function openRouterExtract(
  userPrompt: string,
  systemPrompt: string
): Promise<ParsedExtractionPayload> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENROUTER_KEY_MISSING");
  }
  const model =
    process.env.OPENROUTER_MODEL?.trim() || "google/gemma-2-9b-it:free";

  console.info("[order-extractor] step=openrouter_start", {
    model,
    promptChars: userPrompt.length + systemPrompt.length,
  });
  const orStart = Date.now();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };

  const orElapsed = Date.now() - orStart;
  if (!res.ok || !body?.choices?.[0]?.message?.content) {
    console.error("[order-extractor] step=openrouter_failed", {
      model,
      httpStatus: res.status,
      elapsedMs: orElapsed,
      errorMsg: body?.error?.message,
    });
    throw new Error("OPENROUTER_FAILED");
  }

  console.info("[order-extractor] step=openrouter_done", {
    model,
    httpStatus: res.status,
    elapsedMs: orElapsed,
  });

  return parseJsonPayload(body.choices[0].message.content);
}

function parseJsonPayload(text: string): ParsedExtractionPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    const fenced = text.match(/\{[\s\S]*\}/);
    if (!fenced) throw new Error("JSON_PARSE");

    parsed = JSON.parse(fenced[0]);
  }

  const itemsUnknown = (parsed as { items?: unknown }).items;
  if (!Array.isArray(itemsUnknown)) {
    return { items: [] };
  }

  const cleaned: ExtractedAiLineRaw[] = [];
  for (const row of itemsUnknown) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    cleaned.push({
      matched_variant_id:
        typeof r.matched_variant_id === "string"
          ? r.matched_variant_id
          : r.matched_variant_id === null
            ? null
            : null,
      unresolved: Boolean(r.unresolved),
      product_customer_text:
        typeof r.product_customer_text === "string"
          ? r.product_customer_text
          : "",
      variant_customer_text:
        typeof r.variant_customer_text === "string"
          ? r.variant_customer_text
          : typeof r.variant_customer_text === "object"
            ? JSON.stringify(r.variant_customer_text ?? "")
            : null,
      quantity:
        typeof r.quantity === "number"
          ? r.quantity
          : typeof r.quantity === "string"
            ? Number.parseFloat(r.quantity)
            : undefined,
      unit_price:
        typeof r.unit_price === "number"
          ? r.unit_price
          : typeof r.unit_price === "string"
            ? Number.parseFloat(r.unit_price)
            : undefined,
      special_instructions:
        typeof r.special_instructions === "string"
          ? r.special_instructions
          : null,
      evidence: typeof r.evidence === "string" ? r.evidence : "",
      confidence:
        typeof r.confidence === "number"
          ? r.confidence
          : typeof r.confidence === "string"
            ? Number.parseFloat(r.confidence)
            : undefined,
    });
  }

  return { items: cleaned };
}

/**
 * Chat interpretation runs in two HTTP steps so each stays within typical
 * serverless execution limits (~60s on hobby): snapshot messages, then AI + DB.
 */

/** WhatsApp snapshot from automation — keep under route budget headroom. */
export const CHAT_SNAPSHOT_TIMEOUT_MS = 58_000;

/** AI + DB step — same ceiling so the client stops waiting before the platform does. */
export const CHAT_ANALYZE_STEP_TIMEOUT_MS = 58_000;

export type ThreadMessageBubble = {
  role: "customer" | "business";
  text: string;
  timestampIso: string;
};

function abortedMessage(): string {
  return "This step took too long and was stopped. Try again in a moment.";
}

function networkMessage(): string {
  return "Something went wrong. Check your connection and try again.";
}

/** Build a single transcript line-per-message when the scraper omits `transcript`. */
export function buildTranscriptFromMessages(
  messages: ThreadMessageBubble[]
): string {
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role === "business" ? "You" : "Customer";
    const text = (m.text ?? "").trim();
    if (!text) continue;
    const ts =
      typeof m.timestampIso === "string" && m.timestampIso.length > 0
        ? m.timestampIso
        : "";
    lines.push(ts ? `[${ts}] ${role}: ${text}` : `${role}: ${text}`);
  }
  return lines.join("\n").trim();
}

function mergeAbortSignals(
  outer: AbortSignal | undefined,
  ms: number
): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const cancelTimer = () => clearTimeout(timer);

  const abortMerged = () => {
    cancelTimer();
    controller.abort();
  };

  if (outer) {
    if (outer.aborted) {
      abortMerged();
      return controller.signal;
    }
    outer.addEventListener("abort", abortMerged, { once: true });
  }

  return controller.signal;
}

export type ThreadSnapshotResult =
  | {
      ok: true;
      transcript: string;
      latestMessageIso: string;
      messages: ThreadMessageBubble[];
    }
  | { ok: false; message: string };

/**
 * Fetches one conversation snapshot (same payload used by Analyze step 1 and the detail UI).
 */
export async function fetchThreadMessagesSnapshot(
  threadId: string,
  options?: { signal?: AbortSignal }
): Promise<ThreadSnapshotResult> {
  const snapshotUrl = `/api/whatsapp/chat-threads/${threadId}/messages`;
  const signal = mergeAbortSignals(
    options?.signal,
    CHAT_SNAPSHOT_TIMEOUT_MS
  );

  let snapRes: Response;
  try {
    snapRes = await fetch(snapshotUrl, {
      method: "GET",
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, message: abortedMessage() };
    }
    return { ok: false, message: networkMessage() };
  }

  let snapJson: Record<string, unknown>;
  try {
    snapJson = (await snapRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      ok: false,
      message: "We couldn’t read the server response. Try again.",
    };
  }

  if (!snapRes.ok) {
    const err =
      typeof snapJson.error === "string" && snapJson.error.trim().length > 0
        ? snapJson.error.trim()
        : "We couldn’t load this conversation. Try again shortly.";
    return { ok: false, message: err };
  }

  if (snapJson.ok !== true) {
    const err =
      typeof snapJson.error === "string" && snapJson.error.trim().length > 0
        ? snapJson.error.trim()
        : "We couldn’t load this conversation. Try again shortly.";
    return { ok: false, message: err };
  }

  const rawMessages = Array.isArray(snapJson.messages)
    ? snapJson.messages
    : [];
  const messages: ThreadMessageBubble[] = [];
  for (const item of rawMessages) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
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
    const timestampIso =
      typeof o.timestampIso === "string"
        ? o.timestampIso.trim()
        : typeof o.timestamp_iso === "string"
          ? o.timestamp_iso.trim()
          : "";
    if (!text) continue;
    messages.push({
      role,
      text,
      timestampIso:
        timestampIso ||
        new Date().toISOString(),
    });
  }

  let transcript =
    typeof snapJson.transcript === "string"
      ? snapJson.transcript.trim()
      : "";

  if (!transcript && messages.length > 0) {
    transcript = buildTranscriptFromMessages(messages);
  }

  const latestRaw =
    typeof snapJson.latestMessageIso === "string"
      ? snapJson.latestMessageIso.trim()
      : "";

  if (!transcript) {
    return {
      ok: false,
      message:
        "No messages were found in this conversation. Open the chat in WhatsApp to make sure it has messages, then try again.",
    };
  }

  return {
    ok: true,
    transcript,
    latestMessageIso: latestRaw,
    messages,
  };
}

export type InterpretThreadResult =
  | { ok: true }
  | { ok: false; message: string };

export type AnalyzeStep = "fetching" | "analyzing";

/** Hard cap: spinner always clears after this even if the server never responds. */
const GLOBAL_ANALYZE_TIMEOUT_MS = 90_000;

/**
 * Two-step interpretation:
 *   1. GET /messages  — fetches from WhatsApp and stores snapshot in DB.
 *   2. POST /analyze  — reads snapshot from DB, runs AI, persists results.
 *
 * `onStep` fires as each step begins so the caller can update UI labels.
 * A 90-second global timeout ensures the spinner ALWAYS clears — the function
 * is guaranteed to resolve (never hang) regardless of server behaviour.
 */
export async function interpretChatThread(
  threadId: string,
  options?: { onStep?: (step: AnalyzeStep) => void }
): Promise<InterpretThreadResult> {
  const analyzeUrl = `/api/whatsapp/chat-threads/${threadId}/analyze`;
  const globalStart = Date.now();

  // Global hard cap — guarantees spinner always clears.
  const globalController = new AbortController();
  const globalTimer = setTimeout(
    () => globalController.abort(),
    GLOBAL_ANALYZE_TIMEOUT_MS
  );

  const elapsed = () => Date.now() - globalStart;

  try {
    // ── Step 1: fetch WhatsApp messages + store snapshot in DB ──────────────
    options?.onStep?.("fetching");
    console.log("[analyze-client] step1_start", { threadId, t: elapsed() });

    let snap: ThreadSnapshotResult;
    try {
      snap = await fetchThreadMessagesSnapshot(threadId, {
        signal: globalController.signal,
      });
    } catch (e) {
      console.log("[analyze-client] step1_unexpected_throw", {
        threadId,
        err: String(e),
        t: elapsed(),
      });
      return { ok: false, message: networkMessage() };
    }

    console.log("[analyze-client] step1_done", {
      threadId,
      ok: snap.ok,
      error: snap.ok ? undefined : snap.message,
      globalAborted: globalController.signal.aborted,
      t: elapsed(),
    });

    if (!snap.ok) {
      if (globalController.signal.aborted) {
        return {
          ok: false,
          message: "This is taking longer than expected. Please try again.",
        };
      }
      return snap;
    }

    // ── Step 2: run AI + persist results (reads transcript from DB) ──────────
    options?.onStep?.("analyzing");
    console.log("[analyze-client] step2_start", { threadId, t: elapsed() });

    const stepController = new AbortController();
    const stepTimer = setTimeout(
      () => stepController.abort(),
      CHAT_ANALYZE_STEP_TIMEOUT_MS
    );
    // Propagate global abort into the step controller.
    globalController.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(stepTimer);
        stepController.abort();
      },
      { once: true }
    );

    let annRes: Response;
    try {
      // No transcript in body — the analyze route reads from the DB snapshot
      // written by GET /messages above.
      annRes = await fetch(analyzeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: stepController.signal,
        cache: "no-store",
      });
    } catch (e) {
      clearTimeout(stepTimer);
      const isAbort = e instanceof Error && e.name === "AbortError";
      console.log("[analyze-client] step2_fetch_error", {
        threadId,
        type: isAbort ? "abort" : "network",
        globalAborted: globalController.signal.aborted,
        err: String(e),
        t: elapsed(),
      });
      if (globalController.signal.aborted) {
        return {
          ok: false,
          message: "This is taking longer than expected. Please try again.",
        };
      }
      if (isAbort) {
        return { ok: false, message: abortedMessage() };
      }
      return { ok: false, message: networkMessage() };
    }
    clearTimeout(stepTimer);

    console.log("[analyze-client] step2_response", {
      threadId,
      status: annRes.status,
      ok: annRes.ok,
      t: elapsed(),
    });

    let annJson: Record<string, unknown>;
    try {
      annJson = (await annRes.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
    } catch {
      return {
        ok: false,
        message: "We couldn’t read the server response. Try again.",
      };
    }

    const serverErr =
      typeof annJson.error === "string" && annJson.error.trim().length > 0
        ? annJson.error.trim()
        : null;

    if (!annRes.ok) {
      console.log("[analyze-client] step2_server_error", {
        threadId,
        status: annRes.status,
        serverErr,
        t: elapsed(),
      });
      return {
        ok: false,
        message:
          serverErr ??
          "We couldn’t finish interpreting this thread. Try again shortly.",
      };
    }

    if (annJson.ok !== true) {
      console.log("[analyze-client] step2_not_ok", {
        threadId,
        serverErr,
        annOk: annJson.ok,
        t: elapsed(),
      });
      return {
        ok: false,
        message:
          serverErr ??
          "We couldn’t finish interpreting this thread. Try again shortly.",
      };
    }

    console.log("[analyze-client] step2_success", { threadId, t: elapsed() });
    return { ok: true };
  } finally {
    clearTimeout(globalTimer);
  }
}

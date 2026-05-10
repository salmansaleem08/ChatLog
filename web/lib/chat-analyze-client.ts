/**
 * Chat interpretation runs in two HTTP steps so each stays within typical
 * serverless execution limits (~60s on hobby): snapshot messages, then AI + DB.
 */

/** Per-request budget slightly under common 60s platform caps. */
export const CHAT_ANALYZE_STEP_TIMEOUT_MS = 55_000;

function abortedMessage(): string {
  return "This step took too long and was stopped. Try again in a moment.";
}

function networkMessage(): string {
  return "Something went wrong. Check your connection and try again.";
}

export type InterpretThreadResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Loads conversation text from the messaging snapshot endpoint, then runs
 * interpretation (AI + persistence) in a second request.
 */
export async function interpretChatThread(
  threadId: string
): Promise<InterpretThreadResult> {
  const snapshotUrl = `/api/whatsapp/chat-threads/${threadId}/messages`;
  const analyzeUrl = `/api/whatsapp/chat-threads/${threadId}/analyze`;

  const acSnap = new AbortController();
  const snapTimer = setTimeout(
    () => acSnap.abort(),
    CHAT_ANALYZE_STEP_TIMEOUT_MS
  );
  let snapRes: Response;
  try {
    snapRes = await fetch(snapshotUrl, {
      method: "GET",
      signal: acSnap.signal,
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(snapTimer);
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, message: abortedMessage() };
    }
    return { ok: false, message: networkMessage() };
  }
  clearTimeout(snapTimer);

  let snapJson: Record<string, unknown>;
  try {
    snapJson = (await snapRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      ok: false,
      message:
        "We couldn’t read the server response. Try again.",
    };
  }

  if (!snapRes.ok) {
    const err =
      typeof snapJson.error === "string" && snapJson.error.trim().length > 0
        ? snapJson.error.trim()
        : "We couldn’t load this conversation. Try again shortly.";
    return { ok: false, message: err };
  }

  const transcript =
    typeof snapJson.transcript === "string" ? snapJson.transcript.trim() : "";
  const latestRaw =
    typeof snapJson.latestMessageIso === "string"
      ? snapJson.latestMessageIso.trim()
      : "";

  if (!transcript) {
    return {
      ok: false,
      message:
        "No readable messages were found for this conversation yet.",
    };
  }

  const acAnalyze = new AbortController();
  const analyzeTimer = setTimeout(
    () => acAnalyze.abort(),
    CHAT_ANALYZE_STEP_TIMEOUT_MS
  );
  let annRes: Response;
  try {
    annRes = await fetch(analyzeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        latestMessageIso: latestRaw,
      }),
      signal: acAnalyze.signal,
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(analyzeTimer);
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, message: abortedMessage() };
    }
    return { ok: false, message: networkMessage() };
  }
  clearTimeout(analyzeTimer);

  let annJson: Record<string, unknown>;
  try {
    annJson = (await annRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      ok: false,
      message:
        "We couldn’t read the server response. Try again.",
    };
  }

  const serverErr =
    typeof annJson.error === "string" && annJson.error.trim().length > 0
      ? annJson.error.trim()
      : null;

  if (!annRes.ok) {
    return {
      ok: false,
      message:
        serverErr ??
        "We couldn’t finish interpreting this thread. Try again shortly.",
    };
  }

  if (annJson.ok !== true) {
    return {
      ok: false,
      message:
        serverErr ??
        "We couldn’t finish interpreting this thread. Try again shortly.",
    };
  }

  return { ok: true };
}

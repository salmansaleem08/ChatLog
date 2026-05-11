export function automationConfigured(): boolean {
  const base = process.env.CHATLOG_AUTOMATION_URL?.trim();
  const secret = process.env.CHATLOG_AUTOMATION_SECRET?.trim();
  return Boolean(base && secret);
}

export function automationBaseUrl(): string | undefined {
  return process.env.CHATLOG_AUTOMATION_URL?.replace(/\/$/, "");
}

const USER_SAFE_CONNECTION_ERROR =
  "We couldn’t connect right now. Check your connection and try again.";

/**
 * End-user-safe messages in production; optional detail in development only.
 */
export function describeAutomationReachabilityError(err: unknown): string {
  const isDev = process.env.NODE_ENV === "development";

  if (err instanceof TypeError && err.message === "fetch failed") {
    if (!isDev) {
      return USER_SAFE_CONNECTION_ERROR;
    }
    const base = automationBaseUrl() ?? "(CHATLOG_AUTOMATION_URL not set)";
    const cause = (err as Error & { cause?: { code?: string; message?: string } })
      .cause;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code?: string }).code)
        : "";
    const causeMsg =
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message?: string }).message)
        : "";
    const tail = [code, causeMsg].filter(Boolean).join(" ");
    const hint =
      code === "ECONNREFUSED" || code === "ETIMEDOUT" || !code
        ? "Start the API: cd whatsapp-service && source .venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000"
        : "";
    return `Cannot reach backend at ${base}${tail ? ` (${tail})` : ""}. ${hint}`.trim();
  }
  if (err instanceof Error) {
    if (!isDev) {
      return USER_SAFE_CONNECTION_ERROR;
    }
    return err.message;
  }
  return isDev ? String(err) : USER_SAFE_CONNECTION_ERROR;
}

export async function automationFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = automationBaseUrl();
  const secret = process.env.CHATLOG_AUTOMATION_SECRET;
  if (!base || !secret) {
    throw new Error("CHATLOG_AUTOMATION_NOT_CONFIGURED");
  }
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "X-ChatLog-Secret": secret,
      ...init?.headers,
    },
  });
}

/** Default ceiling under typical Vercel Hobby ~60s route limits (leave headroom). */
export const AUTOMATION_FETCH_VERCEL_SAFE_MS = 55_000;

/** Extended ceiling for the messages route — Python now returns in <25s so this
 *  is a permissive safety net that fits inside the 300s maxDuration budget. */
export const AUTOMATION_FETCH_MESSAGES_MS = 280_000;

/**
 * Long-running automation calls (e.g. open chat + read history in browser).
 * Aborts if the request exceeds the timeout so the route can return an error
 * before platform limits kill the invocation without a response.
 */
export async function automationFetchLong(
  path: string,
  init?: Omit<RequestInit, "signal">,
  timeoutMs: number = AUTOMATION_FETCH_VERCEL_SAFE_MS
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await automationFetch(path, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

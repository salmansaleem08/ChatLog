export function automationConfigured(): boolean {
  const base = process.env.CHATLOG_AUTOMATION_URL?.trim();
  const secret = process.env.CHATLOG_AUTOMATION_SECRET?.trim();
  return Boolean(base && secret);
}

export function automationBaseUrl(): string | undefined {
  return process.env.CHATLOG_AUTOMATION_URL?.replace(/\/$/, "");
}

/**
 * Turns undici's opaque "fetch failed" into an actionable message for local dev.
 */
export function describeAutomationReachabilityError(err: unknown): string {
  const base = automationBaseUrl() ?? "(CHATLOG_AUTOMATION_URL not set)";
  if (err instanceof TypeError && err.message === "fetch failed") {
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
        ? "Start the API in another terminal: cd whatsapp-service && source .venv/bin/activate && uvicorn main:app --host 127.0.0.1 --port 8000 — then curl http://127.0.0.1:8000/health"
        : "";
    return `Cannot reach automation service at ${base}${tail ? ` (${tail})` : ""}. ${hint}`.trim();
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
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

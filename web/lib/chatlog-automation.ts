export function automationConfigured(): boolean {
  const base = process.env.CHATLOG_AUTOMATION_URL?.trim();
  const secret = process.env.CHATLOG_AUTOMATION_SECRET?.trim();
  return Boolean(base && secret);
}

export async function automationFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = process.env.CHATLOG_AUTOMATION_URL?.replace(/\/$/, "");
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

import type { SupabaseClient } from "@supabase/supabase-js";

/** Persisted WhatsApp linkage for the workspace (merchant-facing statuses only). */
export type WhatsappLinkStatus =
  | "disconnected"
  | "awaiting_scan"
  | "connected"
  | "session_lost";

type RemoteStatus = {
  logged_in?: boolean;
  needs_qr?: boolean;
  running?: boolean;
  linked_phone_e164?: string | null;
};

export function deriveWhatsappLinkStatus(
  remote: RemoteStatus,
  priorStored: WhatsappLinkStatus | null | undefined
): WhatsappLinkStatus {
  const prior = priorStored ?? "disconnected";
  if (remote.logged_in) return "connected";
  if (remote.running) {
    if (remote.needs_qr) return "awaiting_scan";
    return "awaiting_scan";
  }
  if (prior === "connected" || prior === "session_lost") {
    return "session_lost";
  }
  return "disconnected";
}

/** Phone shown in Settings once WhatsApp confirms the paired account (scraped periodically). */
function pickDisplayedLinkedPhone(opts: {
  remote: RemoteStatus;
  linkedFromAutomation?: string;
  previouslyStoredLive?: string | null;
}): string | null {
  if (!opts.remote.logged_in) return null;
  const fresh =
    typeof opts.linkedFromAutomation === "string"
      ? opts.linkedFromAutomation.trim()
      : "";
  if (fresh) return fresh;
  const prev =
    typeof opts.previouslyStoredLive === "string"
      ? opts.previouslyStoredLive.trim()
      : "";
  return prev || null;
}

export async function syncWhatsappProfile(
  supabase: SupabaseClient,
  userId: string,
  remote: RemoteStatus,
  linkedPhoneFromAutomation?: string
): Promise<WhatsappLinkStatus> {
  const { data: priorRow } = await supabase
    .from("profiles")
    .select("whatsapp_link_status, whatsapp_linked_phone_live")
    .eq("id", userId)
    .maybeSingle();

  const priorStatus = normalizeStoredStatus(priorRow?.whatsapp_link_status);
  const whatsapp_link_status = deriveWhatsappLinkStatus(remote, priorStatus);

  const linked_phone_live = pickDisplayedLinkedPhone({
    remote,
    linkedFromAutomation: linkedPhoneFromAutomation,
    previouslyStoredLive:
      typeof priorRow?.whatsapp_linked_phone_live === "string"
        ? priorRow.whatsapp_linked_phone_live
        : null,
  });

  await supabase
    .from("profiles")
    .update({
      whatsapp_link_status,
      whatsapp_linked_phone_live: linked_phone_live,
      whatsapp_updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return whatsapp_link_status;
}

function normalizeStoredStatus(raw: unknown): WhatsappLinkStatus | null {
  if (raw === "connected") return "connected";
  if (raw === "awaiting_scan") return "awaiting_scan";
  if (raw === "session_lost") return "session_lost";
  if (raw === "disconnected") return "disconnected";
  return null;
}

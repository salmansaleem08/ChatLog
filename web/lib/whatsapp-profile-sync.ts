import type { SupabaseClient } from "@supabase/supabase-js";

export type WhatsappLinkStatus =
  | "disconnected"
  | "awaiting_scan"
  | "connected";

type RemoteStatus = {
  logged_in?: boolean;
  needs_qr?: boolean;
  running?: boolean;
};

export function deriveWhatsappLinkStatus(
  remote: RemoteStatus
): WhatsappLinkStatus {
  if (remote.logged_in) return "connected";
  if (remote.running && remote.needs_qr) return "awaiting_scan";
  if (remote.running) return "awaiting_scan";
  return "disconnected";
}

export async function syncWhatsappProfile(
  supabase: SupabaseClient,
  userId: string,
  remote: RemoteStatus
): Promise<WhatsappLinkStatus> {
  const whatsapp_link_status = deriveWhatsappLinkStatus(remote);
  await supabase
    .from("profiles")
    .update({
      whatsapp_link_status,
      whatsapp_updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  return whatsapp_link_status;
}

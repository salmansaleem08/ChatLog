import { createClient } from "@/lib/supabase/server";
import { ChatsClient } from "@/components/dashboard/chats/chats-client";
import type { WhatsappLinkStatus } from "@/lib/whatsapp-profile-sync";

function normalizeLinkStatus(raw: string | null | undefined): WhatsappLinkStatus {
  if (
    raw === "connected" ||
    raw === "awaiting_scan" ||
    raw === "session_lost"
  ) {
    return raw;
  }
  return "disconnected";
}

export default async function ChatsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("whatsapp_link_status")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <ChatsClient
      initialLinkStatus={normalizeLinkStatus(
        profile?.whatsapp_link_status as string | undefined
      )}
    />
  );
}

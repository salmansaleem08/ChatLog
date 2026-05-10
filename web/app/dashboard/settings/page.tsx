import { WhatsAppLinkPanel } from "@/components/dashboard/whatsapp-link-panel";
import type { WhatsappLinkStatus } from "@/lib/whatsapp-profile-sync";
import { createClient } from "@/lib/supabase/server";

function parseWaStatus(s: string | null | undefined): WhatsappLinkStatus {
  if (s === "connected" || s === "awaiting_scan" || s === "session_lost") return s;
  return "disconnected";
}

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("whatsapp_link_status, whatsapp_phone_e164, whatsapp_linked_phone_live")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-muted-foreground">
          Connect WhatsApp and manage workspace preferences.
        </p>
      </div>

      <WhatsAppLinkPanel
        initialStatus={parseWaStatus(
          profile?.whatsapp_link_status as string | undefined
        )}
        initialPhone={(profile?.whatsapp_phone_e164 as string | null) ?? null}
        initialRecognizedPhone={
          (profile?.whatsapp_linked_phone_live as string | null) ?? null
        }
      />
    </div>
  );
}

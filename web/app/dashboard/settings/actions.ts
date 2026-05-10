"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function saveWhatsAppPhoneE164(phone: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Please sign in again." as const };
  }

  const v = phone.trim();
  await supabase
    .from("profiles")
    .update({
      whatsapp_phone_e164: v || null,
      whatsapp_updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

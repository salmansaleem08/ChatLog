import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const businessName =
    profile?.business_name?.trim() || "Your business";
  const email = profile?.email?.trim() || user.email || "";

  return (
    <DashboardShell businessName={businessName} email={email}>
      {children}
    </DashboardShell>
  );
}

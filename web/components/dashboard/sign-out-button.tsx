"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignOutButton({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "outline";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={cn("gap-2", className)}
      onClick={signOut}
      disabled={loading}
      aria-label={loading ? "Signing out" : "Sign out"}
    >
      <LogOut className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
      <span className="hidden sm:inline">
        {loading ? "Signing out…" : "Sign out"}
      </span>
    </Button>
  );
}

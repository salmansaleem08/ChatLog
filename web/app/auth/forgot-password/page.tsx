import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Reset your password
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Use the password you chose at sign up. If you no longer have it, ask
          your workspace owner to send a new invitation, or sign up again once
          they have freed your previous seat on the account.
        </p>
        <Link
          href="/auth/login"
          className={cn(
            buttonVariants({ variant: "default" }),
            "inline-flex h-11 w-full"
          )}
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

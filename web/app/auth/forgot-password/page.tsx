import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-16">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Use the password you chose at sign up. If you no longer have it, ask
            your workspace owner to send a new invitation, or sign up again once
            they have freed your previous seat on the account.
          </p>
        </div>
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

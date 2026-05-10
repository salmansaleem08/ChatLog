"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthBrandAside } from "@/components/auth/auth-brand-aside";
import { AuthFormPanel } from "@/components/auth/auth-form-panel";
import { mapLoginError } from "@/lib/auth/map-auth-error";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

export function LoginView({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordError(null);
    setLoading(true);
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement)
      .value;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);
    if (error) {
      setPasswordError(mapLoginError(error.message));
      return;
    }

    router.replace(nextPath.startsWith("/") ? nextPath : "/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-background lg:grid lg:h-screen lg:min-h-0 lg:grid-cols-[11fr_9fr] lg:overflow-hidden">
      <div className="relative flex min-h-[320px] flex-col bg-secondary lg:hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,var(--primary)_0%,transparent_55%)] opacity-20"
          aria-hidden
        />
        <div className="relative z-10 flex flex-1 flex-col justify-center px-6 py-10">
          <Image
            src="/logo.png"
            alt="ChatLog"
            width={44}
            height={44}
            className="mb-8 h-11 w-auto object-contain opacity-95"
            priority
          />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-secondary-foreground/55">
            ChatLog
          </p>
          <h1 className="mt-4 text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] text-secondary-foreground sm:text-4xl">
            Run your WhatsApp store like a real operation.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-secondary-foreground/80 sm:text-lg">
            Sign in for live orders, stock, and customer updates — everything in
            one calm dashboard.
          </p>
        </div>
      </div>

      <AuthBrandAside />

      <div className="flex min-h-0 flex-col justify-center bg-background px-6 py-14 lg:h-full lg:px-12 lg:py-0">
        <AuthFormPanel className="mx-auto w-full max-w-[400px]">
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Welcome back
              </h2>
              <p className="mt-2 text-base text-muted-foreground">
                Sign in to your workspace.
              </p>
            </div>

            <form
              className="flex flex-col gap-5"
              method="post"
              noValidate
              onSubmit={onSubmit}
            >
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@business.com"
                  className="h-11 md:text-base"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <PasswordInput
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className={cn(
                    "h-11 md:text-base",
                    passwordError &&
                      "border-destructive aria-invalid:border-destructive"
                  )}
                  aria-invalid={!!passwordError}
                  required
                />
                {passwordError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {passwordError}
                  </p>
                ) : null}
              </div>
              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <div className="flex justify-end">
              <Link
                href="/auth/forgot-password"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/signup"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Get started
              </Link>
            </p>
          </div>
        </AuthFormPanel>
      </div>
    </div>
  );
}

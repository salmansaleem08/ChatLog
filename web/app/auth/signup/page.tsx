"use client";

import Image from "next/image";
import Link from "next/link";

import { AuthBrandAside } from "@/components/auth/auth-brand-aside";
import { AuthFormPanel } from "@/components/auth/auth-form-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

export default function SignUpPage() {
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
            Create your account and start turning chats into structured orders,
            live inventory, and clear customer communication.
          </p>
        </div>
      </div>

      <AuthBrandAside />

      <div className="flex min-h-0 flex-col justify-center bg-background px-6 py-14 lg:h-full lg:px-12 lg:py-0">
        <AuthFormPanel className="mx-auto w-full max-w-[400px]">
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Create your account
              </h2>
              <p className="mt-2 text-base text-muted-foreground">
                Free to start. No credit card required.
              </p>
            </div>

            <form className="flex flex-col gap-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="business-name">Business name</Label>
                <Input
                  id="business-name"
                  name="business-name"
                  type="text"
                  autoComplete="organization"
                  placeholder="e.g. Noor Textiles"
                  className="h-11 md:text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@business.com"
                  className="h-11 md:text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <PasswordInput
                  id="signup-password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  className="h-11 md:text-base"
                />
              </div>
              <Button type="submit" className="h-11 w-full">
                Create account
              </Button>
            </form>

            <div className="flex items-center gap-4">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium text-muted-foreground">
                or
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 w-full gap-2"
              )}
            >
              <span
                className="flex size-4 shrink-0 items-center justify-center rounded border border-border text-[10px] font-bold leading-none text-muted-foreground"
                aria-hidden
              >
                G
              </span>
              Continue with Google
            </button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>

            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              By creating an account, you agree to our{" "}
              <Link
                href="/terms"
                className="text-primary underline underline-offset-2 hover:text-primary/90"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                href="/privacy"
                className="text-primary underline underline-offset-2 hover:text-primary/90"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </AuthFormPanel>
      </div>
    </div>
  );
}

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
    <div className="min-h-screen bg-background lg:grid lg:h-screen lg:min-h-0 lg:grid-cols-[55fr_45fr] lg:overflow-hidden">
      <div className="relative flex min-h-[280px] flex-col bg-secondary lg:hidden">
        <div
          className="pointer-events-none absolute -left-24 -top-24 rounded-full bg-primary opacity-10 blur-3xl"
          style={{ width: 360, height: 360 }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -right-16 rounded-full bg-sky-300/30 opacity-40 blur-3xl dark:bg-sky-400/20"
          style={{ width: 400, height: 400 }}
          aria-hidden
        />
        <div className="relative z-10 flex flex-1 flex-col justify-center p-6">
          <Image
            src="/logo.png"
            alt="ChatLog"
            width={40}
            height={40}
            className="mb-6 h-10 w-auto rounded-md object-contain"
            priority
          />
          <h1 className="text-2xl font-bold leading-tight text-gradient-hero">
            Your WhatsApp orders, finally organized.
          </h1>
          <p className="mt-3 text-sm text-secondary-foreground/85">
            Sign up to turn chats into structured orders, live stock, and calm
            customer updates.
          </p>
        </div>
      </div>

      <AuthBrandAside />

      <div className="flex min-h-0 flex-col justify-center bg-background px-6 py-12 lg:h-full lg:py-0">
        <AuthFormPanel className="mx-auto w-full max-w-sm">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Create your account
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Free forever. No credit card.
              </p>
            </div>

            <form className="flex flex-col gap-4" noValidate>
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

            <div className="flex items-center gap-3">
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

            <p className="text-center text-xs text-muted-foreground leading-relaxed">
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

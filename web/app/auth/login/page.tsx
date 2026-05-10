"use client";

import Image from "next/image";
import Link from "next/link";

import { AuthBrandAside } from "@/components/auth/auth-brand-aside";
import { AuthDashboardPreview } from "@/components/marketing/analytics-previews";
import { AuthFormPanel } from "@/components/auth/auth-form-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background lg:grid lg:h-screen lg:min-h-0 lg:grid-cols-[55fr_45fr] lg:overflow-hidden">
      <div className="relative flex min-h-[280px] flex-col bg-secondary lg:hidden">
        <div
          className="pointer-events-none absolute -left-24 -top-24 rounded-full bg-primary opacity-10 blur-3xl"
          style={{ width: 360, height: 360 }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-20 -right-16 rounded-full bg-chart-3/35 opacity-50 blur-3xl"
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
            Sign in to see every order extracted from your chats, stock that stays
            accurate, and customer updates that send themselves.
          </p>
          <AuthDashboardPreview compact />
        </div>
      </div>

      <AuthBrandAside />

      <div className="flex min-h-0 flex-col justify-center bg-background px-6 py-12 lg:h-full lg:py-0">
        <AuthFormPanel className="mx-auto w-full max-w-sm">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in to your workspace.
              </p>
            </div>

            <form className="flex flex-col gap-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@business.com"
                  className="h-11 md:text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <PasswordInput
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="h-11 md:text-base"
                />
              </div>
              <Button type="submit" className="h-11 w-full">
                Sign in
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

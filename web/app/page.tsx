import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  LineChart,
  ListChecks,
  MessageSquare,
  PackageCheck,
  Send,
  Sparkles,
  SplitSquareVertical,
} from "lucide-react";

import { LandingAnalyticsShowcase } from "@/components/marketing/analytics-previews";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = [
  {
    n: "01",
    icon: MessageSquare,
    title: "Connect your WhatsApp",
    desc: "Scan once. Conversations sync so nothing is copied by hand.",
  },
  {
    n: "02",
    icon: PackageCheck,
    title: "Structured orders, automatically",
    desc: "Products, variants, quantities, and prices parsed from natural chat.",
  },
  {
    n: "03",
    icon: BarChart3,
    title: "Operate with confidence",
    desc: "Inventory, statuses, and margin stay aligned as you dispatch and deliver.",
  },
] as const;

const features = [
  {
    icon: Sparkles,
    label: "Smart order extraction",
    desc: "Chaotic threads become line items you can pick, pack, and ship.",
  },
  {
    icon: PackageCheck,
    label: "Inventory with variants",
    desc: "Color, size, and model tracked without a second spreadsheet.",
  },
  {
    icon: LineChart,
    label: "Profit analytics",
    desc: "Revenue and margin update as orders move — not after month-end.",
  },
  {
    icon: Send,
    label: "Automatic customer messages",
    desc: "Pre-approved copy goes out at each status change.",
  },
  {
    icon: ListChecks,
    label: "Order workflow",
    desc: "Confirmed → dispatched → delivered → returned. Always explicit.",
  },
  {
    icon: SplitSquareVertical,
    label: "Session-aware chats",
    desc: "Finished orders stay closed; new messages start a clean session.",
  },
] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-2 sm:h-14 sm:flex-nowrap sm:px-8 sm:py-0">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="ChatLog"
              width={32}
              height={32}
              className="h-8 w-auto object-contain"
              priority
            />
            <span className="text-sm font-semibold tracking-tight">
              ChatLog
            </span>
          </Link>
          <nav className="flex w-full items-center justify-end gap-1 sm:w-auto">
            <Link
              href="/auth/login"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "h-10 px-4 text-sm font-medium"
              )}
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className={cn(
                buttonVariants({ variant: "default" }),
                "h-10 px-4 text-sm font-medium"
              )}
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-border/80">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Operations for WhatsApp sellers
              </p>
              <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl lg:text-[3.25rem] lg:leading-[1.06]">
                Turn every conversation into a{" "}
                <span className="text-primary">clear order pipeline</span>.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
                ChatLog reads customer chats, builds structured orders with
                variants and totals, and keeps stock and profit honest — without
                slowing down how you already sell.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/auth/signup"
                  className={cn(
                    buttonVariants({ variant: "default" }),
                    "h-11 justify-center px-7 text-sm font-medium"
                  )}
                >
                  Start for free
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  href="#how-it-works"
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-11 px-5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  )}
                >
                  How it works
                </Link>
              </div>
            </div>

            <div className="relative lg:justify-self-end">
              <div className="relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-muted/30 shadow-sm lg:max-w-none">
                <div
                  className="absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_70%_20%,oklch(0.38_0.075_264_/_0.08),transparent_65%)]"
                  aria-hidden
                />
                <div className="absolute inset-6 rounded-xl border border-border/80 bg-card/90 p-5 shadow-sm backdrop-blur-sm">
                  <div className="flex items-center justify-between border-b border-border pb-4">
                    <div className="space-y-1">
                      <div className="h-2 w-24 rounded bg-muted" />
                      <div className="h-2 w-16 rounded bg-muted/70" />
                    </div>
                    <div className="h-8 w-8 rounded-md bg-primary/15" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2.5"
                      >
                        <div className="size-2 rounded-full bg-primary/70" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-1.5 w-3/4 max-w-[180px] rounded bg-foreground/10" />
                          <div className="h-1.5 w-1/2 max-w-[120px] rounded bg-foreground/5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border/60 bg-muted/25">
          <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
            <p className="text-center text-sm font-medium leading-relaxed text-muted-foreground">
              ChatLog is early-stage software built for sellers who run serious
              volume on WhatsApp. We are onboarding founding teams in Pakistan, the
              Gulf, and Saudi Arabia — no inflated metrics, just a product roadmap
              shaped with real businesses.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-6">
              <span className="rounded-full border border-border bg-background/80 px-4 py-2 text-xs font-medium text-foreground">
                WhatsApp → structured orders
              </span>
              <span className="rounded-full border border-border bg-background/80 px-4 py-2 text-xs font-medium text-foreground">
                Inventory and margin in one place
              </span>
              <span className="rounded-full border border-border bg-background/80 px-4 py-2 text-xs font-medium text-foreground">
                Built for mobile-first teams
              </span>
            </div>
          </div>
        </section>

        <LandingAnalyticsShowcase />

        <section
          id="how-it-works"
          className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              How it works
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Three steps from raw chat to a business you can measure.
            </p>
          </div>
          <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-12">
            {steps.map((step) => (
              <div key={step.n}>
                <span className="text-xs font-semibold tabular-nums text-primary">
                  {step.n}
                </span>
                <step.icon
                  className="mt-4 size-8 text-foreground/80"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <h3 className="mt-4 text-lg font-semibold leading-snug">
                  {step.title}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border/60 bg-muted/20">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything serious WhatsApp sellers expect
            </h2>
            <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
              One system for extraction, inventory, messaging, and reporting.
            </p>
            <div className="mt-14 grid gap-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-14 lg:gap-y-12">
              {features.map((f) => (
                <div key={f.label} className="flex gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                    <f.icon
                      className="size-4 text-primary"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </div>
                  <div>
                    <p className="font-semibold leading-snug">{f.label}</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-foreground text-background">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Ready to stop losing orders in the scroll?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-background/70 sm:text-lg">
                If you sell on WhatsApp and want operations to keep pace, we would
                like to hear from you.
              </p>
              <Link
                href="/auth/signup"
                className="mt-9 inline-flex h-11 items-center gap-2 rounded-md bg-background px-8 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-background/90"
              >
                Get started free
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:px-8">
            <span>© 2026 ChatLog</span>
            <span>Built for WhatsApp sellers</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import {
  BarChart3,
  LineChart,
  ListChecks,
  MessageSquare,
  PackageCheck,
  Send,
  Sparkles,
  SplitSquareVertical,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const steps = [
  {
    n: "01",
    icon: MessageSquare,
    title: "Connect your WhatsApp",
    desc: "Scan once, we read your chats automatically.",
  },
  {
    n: "02",
    icon: PackageCheck,
    title: "AI extracts every order",
    desc: "Products, variants, quantities, prices detected instantly.",
  },
  {
    n: "03",
    icon: BarChart3,
    title: "Track, dispatch, grow",
    desc: "Manage inventory, update statuses, watch profit in real time.",
  },
] as const;

const features = [
  {
    icon: Sparkles,
    label: "Smart order extraction",
    desc: "Turn messy chat lines into line items you can fulfill.",
  },
  {
    icon: PackageCheck,
    label: "Inventory with variants",
    desc: "Colors, sizes, and models tracked without a second spreadsheet.",
  },
  {
    icon: LineChart,
    label: "Profit analytics",
    desc: "See margin and revenue the moment orders move forward.",
  },
  {
    icon: Send,
    label: "Auto customer messages",
    desc: "Pre-written updates go out when status changes.",
  },
  {
    icon: ListChecks,
    label: "Order status workflow",
    desc: "Confirmed, dispatched, delivered, returned — always clear.",
  },
  {
    icon: SplitSquareVertical,
    label: "Multi-session chat detection",
    desc: "New orders after delivery start clean, never mixed with old ones.",
  },
] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="ChatLog"
              width={36}
              height={36}
              className="h-9 w-auto rounded-md object-contain"
              priority
            />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/auth/login"
              className={cn(buttonVariants({ variant: "ghost" }), "h-11 px-4")}
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className={cn(buttonVariants({ variant: "ghost" }), "h-11 px-4")}
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div
            className="pointer-events-none absolute left-0 top-0 -translate-x-1/4 -translate-y-1/4 rounded-full bg-primary opacity-10 blur-3xl"
            style={{ width: 520, height: 520 }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute bottom-0 right-0 translate-x-1/4 translate-y-1/4 rounded-full bg-secondary opacity-10 blur-3xl"
            style={{ width: 560, height: 560 }}
            aria-hidden
          />

          <div className="relative z-10 mx-auto max-w-4xl text-center">
            <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight text-gradient-hero md:text-7xl md:leading-[1.05]">
              Orders from WhatsApp, organized for real business.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-xl text-muted-foreground">
              ChatLog reads your customer conversations, builds structured orders
              with variants and totals, and keeps inventory and profit honest —
              without losing the speed of chat.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Link
                href="/auth/signup"
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "h-11 w-full min-w-[200px] px-8 sm:w-auto"
                )}
              >
                Start for free
              </Link>
              <Link
                href="#how-it-works"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-11 w-full min-w-[200px] px-8 sm:w-auto"
                )}
              >
                See how it works
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-muted py-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center text-sm font-medium text-muted-foreground sm:text-base">
              Trusted by small businesses across Pakistan, UAE, and Saudi Arabia
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {[
                "500+ Businesses",
                "10,000+ Orders tracked",
                "98% Delivery rate",
              ].map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-background px-5 py-2 text-sm font-medium text-foreground shadow-sm"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6"
        >
          <h2 className="text-3xl font-bold tracking-tight">
            How ChatLog works
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.n}
                className="relative rounded-xl border border-border bg-card px-6 py-6 shadow-sm"
              >
                <span className="absolute right-5 top-5 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                  {step.n}
                </span>
                <step.icon
                  className="size-9 text-primary"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <h3 className="mt-4 text-lg font-semibold leading-snug">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight">
            Everything a WhatsApp seller needs
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.label} className="flex gap-4">
                <f.icon
                  className="size-6 shrink-0 text-primary"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div>
                  <p className="font-semibold leading-snug">{f.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="relative left-1/2 w-screen -translate-x-1/2 border-y border-border bg-gradient-to-br from-primary/12 via-muted to-secondary/15 py-16">
          <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Start managing orders the smart way.
            </h2>
            <p className="mt-3 text-muted-foreground">
              Join sellers who stopped losing orders in the chat scroll.
            </p>
            <Link
              href="/auth/signup"
              className={cn(
                buttonVariants({ variant: "default" }),
                "mt-8 inline-flex h-11 px-8"
              )}
            >
              Get started free
            </Link>
          </div>
        </section>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
            <span>© 2026 ChatLog</span>
            <span>Built for WhatsApp sellers</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

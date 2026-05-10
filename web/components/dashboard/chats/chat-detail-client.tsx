"use client";

import { ArrowLeft, Loader2, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import { toNumber } from "@/lib/inventory/helpers";

type LineVm = {
  id: string;
  quantity: number;
  unitPrice: number | null;
  confidence: number;
  unresolved: boolean;
  aiProduct: string;
  aiVariant: string;
  matchedProduct?: string | null;
  matchedVariantAttrs?: Record<string, string> | null;
};

export function ChatDetailClient({
  threadId,
  displayName,
  phoneDigits,
  lastMessageAt,
  lastAnalyzedAt,
  canAnalyze,
  lines,
}: {
  threadId: string;
  displayName: string;
  phoneDigits: string;
  lastMessageAt: string | null;
  lastAnalyzedAt: string | null;
  canAnalyze: boolean;
  lines: LineVm[];
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<null | "reset" | "analyze">(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const phone =
    phoneDigits.replace(/\D/g, "").length > 0
      ? phoneDigits.startsWith("+")
        ? phoneDigits.replace(/\s/g, "")
        : `+${phoneDigits.replace(/\D/g, "")}`
      : "—";

  async function resetAnalysis() {
    setBusyAction("reset");
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/chat-threads/${threadId}/reset`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not reset.");
        return;
      }
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function runAnalyze() {
    setBusyAction("analyze");
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/chat-threads/${threadId}/analyze`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not extract orders.");
        return;
      }
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-8">
        <div className="min-w-0 space-y-3">
          <Link
            href="/dashboard/chats"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline hover:underline-offset-4"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Chats
          </Link>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {displayName}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">{phone}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>
              Last message:{" "}
              <time dateTime={lastMessageAt ?? undefined}>
                {lastMessageAt
                  ? new Date(lastMessageAt).toLocaleString()
                  : "—"}
              </time>
            </span>
            <span className="opacity-60">·</span>
            <span>
              Last extraction:{" "}
              <time dateTime={lastAnalyzedAt ?? undefined}>
                {lastAnalyzedAt
                  ? new Date(lastAnalyzedAt).toLocaleString()
                  : "—"}
              </time>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="outline"
            className="h-11 border-border sm:h-10"
            disabled={busyAction !== null}
            onClick={resetAnalysis}
          >
            {busyAction === "reset" ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="mr-2 size-4 opacity-80" aria-hidden />
            )}
            Reset extraction
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-11 sm:h-10"
            disabled={!canAnalyze || busyAction !== null}
            onClick={runAnalyze}
          >
            {busyAction === "analyze" ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="mr-2 size-4 opacity-90" aria-hidden />
            )}
            Extract orders
          </Button>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!canAnalyze && lastAnalyzedAt ? (
        <p className="text-sm text-muted-foreground">
          Extraction is up to date. When the customer sends something new here,
          unlock “Extract orders” again from this page or from the chats list.
        </p>
      ) : null}

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <header className="border-b border-border px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight">
            Extracted line items
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Matched against your catalogue when we’re confident. Anything
            flagged needs your eyes before becoming an order later.
          </p>
        </header>

        {lines.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            No extraction yet — run extraction from the chats list or the button
            above.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((ln) => {
              const sub =
                ln.matchedProduct && ln.matchedVariantAttrs
                  ? `${ln.matchedProduct} · ${Object.entries(ln.matchedVariantAttrs)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}`
                  : ln.matchedProduct;
              return (
                <li key={ln.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {ln.unresolved ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100"
                        >
                          Review
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-primary/35 bg-primary/10 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary"
                        >
                          Matched
                        </Badge>
                      )}
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        Confidence {(ln.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-[1.015rem] font-semibold leading-snug text-foreground">
                      Customer said:{" "}
                      <span className="font-medium text-muted-foreground">
                        {ln.aiProduct}
                      </span>
                      {ln.aiVariant.trim() ? (
                        <>
                          {" "}
                          <span className="text-muted-foreground/80">
                            ({ln.aiVariant})
                          </span>
                        </>
                      ) : null}
                    </p>
                    {sub ? (
                      <p className="text-sm leading-relaxed text-primary">
                        Matched catalogue:{" "}
                        <span className="font-semibold">{sub}</span>
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className="text-sm font-semibold text-foreground">
                      × {String(ln.quantity)}{" "}
                      @{" "}
                      {ln.unitPrice == null
                        ? "—"
                        : formatMoneyAmount(toNumber(ln.unitPrice))}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Row total:{" "}
                      {ln.unitPrice == null
                        ? "—"
                        : formatMoneyAmount(
                            toNumber(ln.quantity) * toNumber(ln.unitPrice)
                          )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

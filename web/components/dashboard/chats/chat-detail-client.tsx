"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ArrowLeft,
  Loader2,
  MessagesSquare,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchThreadMessagesSnapshot,
  interpretChatThread,
  type ThreadMessageBubble,
} from "@/lib/chat-analyze-client";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import { toNumber } from "@/lib/inventory/helpers";
import { cn } from "@/lib/utils";

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

function bubbleTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LineRow({ ln }: { ln: LineVm }) {
  const sub =
    ln.matchedProduct && ln.matchedVariantAttrs
      ? `${ln.matchedProduct} · ${Object.entries(ln.matchedVariantAttrs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")}`
      : ln.matchedProduct;
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-5">
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
          <span className="font-medium text-muted-foreground">{ln.aiProduct}</span>
          {ln.aiVariant.trim() ? (
            <>
              {" "}
              <span className="text-muted-foreground/80">({ln.aiVariant})</span>
            </>
          ) : null}
        </p>
        {sub ? (
          <p className="text-sm leading-relaxed text-primary">
            Matched catalogue: <span className="font-semibold">{sub}</span>
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <p className="text-sm font-semibold text-foreground">
          × {String(ln.quantity)} @{" "}
          {ln.unitPrice == null ? "—" : formatMoneyAmount(toNumber(ln.unitPrice))}
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
}

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
  const [busyAction, setBusyAction] = useState<null | "analyze">(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<ThreadMessageBubble[]>([]);
  const convBottomRef = useRef<HTMLDivElement | null>(null);

  const { matchedLines, reviewLines } = useMemo(() => {
    const matchedLines = lines.filter((l) => !l.unresolved);
    const reviewLines = lines.filter((l) => l.unresolved);
    return { matchedLines, reviewLines };
  }, [lines]);

  const phone =
    phoneDigits.replace(/\D/g, "").length > 0
      ? phoneDigits.startsWith("+")
        ? phoneDigits.replace(/\s/g, "")
        : `+${phoneDigits.replace(/\D/g, "")}`
      : "—";

  const hasInterpretation = Boolean(lastAnalyzedAt) || lines.length > 0;

  const loadConversation = useCallback(async () => {
    setConvLoading(true);
    setConvError(null);
    try {
      const snap = await fetchThreadMessagesSnapshot(threadId);
      if (!snap.ok) {
        setConvError(snap.message);
        setConvMessages([]);
        return;
      }
      setConvMessages(snap.messages);
    } catch {
      setConvError(
        "Something went wrong while loading messages. Check your connection and try again."
      );
      setConvMessages([]);
    } finally {
      setConvLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    if (convLoading || convMessages.length === 0) return;
    convBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [convLoading, convMessages]);

  async function confirmDeleteInterpretation() {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/whatsapp/chat-threads/${threadId}/reset`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(
          body.error ?? "Could not remove this interpretation. Try again."
        );
        return;
      }
      setDeleteOpen(false);
      router.refresh();
      void loadConversation();
    } finally {
      setDeletePending(false);
    }
  }

  async function runAnalyze() {
    setBusyAction("analyze");
    setAnalyzeError(null);
    try {
      const result = await interpretChatThread(threadId);
      if (!result.ok) {
        setAnalyzeError(result.message);
        return;
      }
      router.refresh();
      void loadConversation();
    } catch {
      setAnalyzeError(
        "Something went wrong. Check your connection and try again."
      );
    } finally {
      setBusyAction(null);
    }
  }

  const analyzeDisabled =
    !canAnalyze || busyAction !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-8">
        <div className="min-w-0 space-y-3">
          <Link
            href="/dashboard/chats"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline hover:underline-offset-4"
          >
            <ArrowLeft className="size-4" aria-hidden />
            All chats
          </Link>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {displayName}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">{phone}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>
              Last message here:{" "}
              <time dateTime={lastMessageAt ?? undefined}>
                {lastMessageAt
                  ? new Date(lastMessageAt).toLocaleString()
                  : "—"}
              </time>
            </span>
            <span className="opacity-60">·</span>
            <span>
              Last interpretation:{" "}
              <time dateTime={lastAnalyzedAt ?? undefined}>
                {lastAnalyzedAt
                  ? new Date(lastAnalyzedAt).toLocaleString()
                  : "—"}
              </time>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            {hasInterpretation ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-10"
                disabled={busyAction !== null || deletePending}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="mr-2 size-4 opacity-90" aria-hidden />
                Delete interpretation…
              </Button>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                size="lg"
                className="h-11 sm:h-10"
                disabled={analyzeDisabled}
                onClick={runAnalyze}
              >
                {busyAction === "analyze" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="mr-2 size-4 opacity-90" aria-hidden />
                )}
                Analyze
              </Button>
              {lastAnalyzedAt && !canAnalyze ? (
                <p className="text-center text-[0.6875rem] leading-tight text-muted-foreground sm:text-left">
                  Analyzed ·{" "}
                  {new Date(lastAnalyzedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              ) : null}
              {analyzeError ? (
                <p
                  className="max-w-[220px] text-[0.8125rem] leading-snug text-destructive sm:max-w-[260px]"
                  role="alert"
                >
                  {analyzeError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px]" />
          <AlertDialog.Popup className="fixed inset-0 z-50 mx-auto flex min-h-[100vh] items-center justify-center px-4 py-16">
            <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
              <AlertDialog.Title className="text-lg font-semibold tracking-tight">
                Delete this interpretation?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
                All line items saved from this interpretation will be removed. Stock
                that was reserved for matched items will be returned to your inventory.
                This does not delete messages in the conversation.
              </AlertDialog.Description>
              {deleteError ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  {deleteError}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={deletePending}
                  onClick={() => setDeleteOpen(false)}
                >
                  Keep interpretation
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deletePending}
                  onClick={() => void confirmDeleteInterpretation()}
                >
                  {deletePending ? "Removing…" : "Delete interpretation"}
                </Button>
              </div>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="size-5 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight">Conversation</h2>
        </div>
        <div className="rounded-xl border border-border bg-card/80 shadow-sm">
          {convLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Loading messages…
            </div>
          ) : convError ? (
            <div className="flex flex-col items-center gap-4 px-4 py-12 text-center">
              <p className="max-w-md text-sm text-destructive" role="alert">
                {convError}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadConversation()}
              >
                Try again
              </Button>
            </div>
          ) : convMessages.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No messages found for this thread yet.
            </p>
          ) : (
            <div className="flex max-h-[min(52vh,520px)] flex-col gap-2 overflow-y-auto px-3 py-4 sm:px-5">
              {convMessages.map((m, i) => (
                <div
                  key={`${m.timestampIso}-${i}-${m.text.slice(0, 24)}`}
                  className={cn(
                    "flex w-full",
                    m.role === "business" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[min(100%,24rem)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                      m.role === "business"
                        ? "rounded-br-md bg-primary/15 text-foreground"
                        : "rounded-bl-md bg-muted text-foreground"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <time
                      className="mt-1 block text-[0.6875rem] tabular-nums text-muted-foreground"
                      dateTime={m.timestampIso}
                    >
                      {bubbleTimeLabel(m.timestampIso)}
                    </time>
                  </div>
                </div>
              ))}
              <div ref={convBottomRef} className="h-px w-full shrink-0" aria-hidden />
            </div>
          )}
        </div>
      </section>

      {!canAnalyze && lastAnalyzedAt ? (
        <p className="text-sm text-muted-foreground">
          You’re up to date with the latest messages. When something new arrives,
          Analyze will be available again here and on your chat list.
        </p>
      ) : null}

      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Interpretation
          </h2>
        </div>

        {lines.length === 0 ? (
          <section className="rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm sm:px-10 sm:py-14">
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              No interpretation yet
            </h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Run Analyze to read this thread against your catalogue. Line items
              appear here when the run succeeds.
            </p>
            <div className="mt-8 flex flex-col items-center gap-2">
              <Button
                type="button"
                size="lg"
                className="h-11 sm:h-10"
                disabled={analyzeDisabled}
                onClick={runAnalyze}
              >
                {busyAction === "analyze" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="mr-2 size-4 opacity-90" aria-hidden />
                )}
                Analyze
              </Button>
              {analyzeError ? (
                <p className="max-w-md text-sm text-destructive" role="alert">
                  {analyzeError}
                </p>
              ) : null}
              {!canAnalyze && lastAnalyzedAt ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Waiting for new messages before another run.
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <>
            {matchedLines.length > 0 ? (
              <section className="rounded-xl border border-border bg-card shadow-sm">
                <header className="border-b border-border px-5 py-4 sm:px-6">
                  <h3 className="text-lg font-semibold tracking-tight">
                    Extracted line items
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Lines we matched to your catalogue with usable confidence.
                  </p>
                </header>
                <ul className="divide-y divide-border">
                  {matchedLines.map((ln) => (
                    <LineRow key={ln.id} ln={ln} />
                  ))}
                </ul>
              </section>
            ) : null}

            {reviewLines.length > 0 ? (
              <section className="rounded-xl border border-amber-500/25 bg-card shadow-sm">
                <header className="border-b border-amber-500/20 bg-amber-500/[0.06] px-5 py-4 sm:px-6">
                  <h3 className="text-lg font-semibold tracking-tight">
                    Needs your review
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    These lines are flagged so you can confirm wording or catalogue
                    matches before they flow into orders.
                  </p>
                </header>
                <ul className="divide-y divide-border">
                  {reviewLines.map((ln) => (
                    <LineRow key={ln.id} ln={ln} />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

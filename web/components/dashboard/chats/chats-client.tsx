"use client";

import {
  ArrowRight,
  Loader2,
  MessageCircle,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WhatsappLinkStatus } from "@/lib/whatsapp-profile-sync";

type ChatRow = {
  threadId: string | null;
  chatJid: string;
  phoneDigits: string;
  displayName: string;
  preview: string;
  lastMessageAt: string | null;
  lastMessageMs: number | null;
  canAnalyze: boolean;
  lastAnalyzedAt: string | null;
};

type ChatDiagnostics = {
  correlationId: string;
  failureCode: string;
  upstreamHttpStatus?: number;
  upstreamDetailSnippet?: string;
};

type ChatsPayload = {
  ok?: boolean;
  serviceConfigured?: boolean;
  chats?: ChatRow[];
  whatsapp_link_status?: string;
  error?: string;
  warning?: string;
  code?: string;
  diagnostics?: ChatDiagnostics;
};

function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (!d) return "—";
  return d.startsWith("+") ? d : `+${d}`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ChatsClient({
  initialLinkStatus,
}: {
  initialLinkStatus: WhatsappLinkStatus;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ChatDiagnostics | null>(null);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [linkStatus, setLinkStatus] =
    useState<WhatsappLinkStatus>(initialLinkStatus);
  const [search, setSearch] = useState("");
  const [busyThread, setBusyThread] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setWarning(null);
    setDiagnostics(null);
    setCopiedDiag(false);
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/chats");
      const data = (await res.json()) as ChatsPayload;
      if (!res.ok) {
        setError(
          data.error ??
            "We couldn’t load conversations. Try again in a few minutes."
        );
        setRows([]);
        if (data.diagnostics?.correlationId) {
          setDiagnostics(data.diagnostics);
        }
        return;
      }
      if (typeof data.warning === "string" && data.warning.trim().length > 0) {
        setWarning(data.warning);
      }
      if (
        data.diagnostics &&
        typeof data.diagnostics === "object" &&
        typeof data.diagnostics.correlationId === "string"
      ) {
        setDiagnostics(data.diagnostics);
      }
      if (typeof data.whatsapp_link_status === "string") {
        const s = data.whatsapp_link_status;
        if (
          s === "connected" ||
          s === "awaiting_scan" ||
          s === "session_lost" ||
          s === "disconnected"
        ) {
          setLinkStatus(s);
        }
      }
      setRows(Array.isArray(data.chats) ? data.chats : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = `${r.displayName} ${r.phoneDigits}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  async function analyze(threadId: string | null) {
    if (!threadId) {
      setError(
        "This row is still syncing. Refresh the page in a moment and try again."
      );
      return;
    }
    setBusyThread(threadId);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/chat-threads/${threadId}/analyze`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          body.error ??
            "We couldn’t extract orders for this chat. Try again shortly."
        );
        return;
      }
      router.push(`/dashboard/chats/${threadId}`);
      router.refresh();
    } finally {
      setBusyThread(null);
    }
  }

  const needsLink = linkStatus !== "connected";

  async function copyDiagnostics() {
    if (!diagnostics) return;
    const text = JSON.stringify(diagnostics, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDiag(true);
      window.setTimeout(() => setCopiedDiag(false), 2000);
    } catch {
      setError("Could not copy. Select the text below instead.");
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5 overflow-x-hidden pb-24 sm:space-y-8 sm:pb-20">
      <header className="space-y-2 border-b border-border pb-6 sm:pb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Chats
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Every row is a live WhatsApp thread on the number you linked. Search by
          name or phone, open a thread to review what was last extracted, or run
          a fresh interpretation when new messages arrive.
        </p>
      </header>

      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {warning ? (
        <p
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
          role="status"
        >
          {warning}
        </p>
      ) : null}

      {diagnostics ? (
        <details className="rounded-lg border border-border bg-muted/40 text-foreground">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
            Details to copy for support
          </summary>
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Paste this block in your message if you need help troubleshooting.
            </p>
            <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-background p-3 text-[11px] leading-snug text-foreground">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 h-9"
              onClick={() => void copyDiagnostics()}
            >
              {copiedDiag ? "Copied" : "Copy details"}
            </Button>
          </div>
        </details>
      ) : null}

      {needsLink ? (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-6 sm:px-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {linkStatus === "session_lost"
                  ? "Your WhatsApp session ended"
                  : "Connect WhatsApp to see conversations"}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {linkStatus === "session_lost"
                  ? "The browser session that kept you signed in has stopped — often after a hosting restart. Open Settings to connect again and we’ll restore your chat list."
                  : "Link your business WhatsApp in Settings first. Once it shows as connected, your customer threads load here automatically."}
              </p>
            </div>
            <Link
              href="/dashboard/settings"
              className={cn(
                buttonVariants({ size: "lg" }),
                "inline-flex h-11 shrink-0 items-center justify-center"
              )}
            >
              Open Settings
              <ArrowRight className="ml-2 size-4" aria-hidden />
            </Link>
          </div>
        </section>
      ) : null}

      {!needsLink ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="h-11 pl-10"
            aria-label="Search chats"
          />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:w-auto"
            onClick={() => void load()}
          >
            Refresh
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Loading conversations…
        </div>
      ) : needsLink ? null : filtered.length === 0 ? (
        <div className="flex min-h-[14rem] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-4 py-12 text-center shadow-sm sm:min-h-[16rem] sm:px-6 sm:py-16">
          <MessageCircle
            className="size-10 text-muted-foreground/70"
            strokeWidth={1.25}
            aria-hidden
          />
          <p className="mt-4 text-sm font-medium text-foreground">
            {warning ? "No saved conversations to show" : "No conversations yet"}
          </p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {warning
              ? "We could not load a fresh list from WhatsApp. After you reconnect in Settings, tap Refresh. Once a sync succeeds, threads appear here even if the live link blips."
              : "When customers message your linked WhatsApp, their threads appear here—newest first."}
          </p>
          {warning ? (
            <Link
              href="/dashboard/settings"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "mt-6 h-10"
              )}
            >
              Open Settings
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const openHref = r.threadId
              ? `/dashboard/chats/${r.threadId}`
              : "#";
            const analyzedLabel = r.lastAnalyzedAt
              ? formatRelativeTime(r.lastAnalyzedAt)
              : null;
            return (
              <li key={r.chatJid}>
                <div className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/35 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <Link
                    href={openHref}
                    className={cn(
                      "min-w-0 flex-1 rounded-lg outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
                      !r.threadId && "pointer-events-none opacity-70"
                    )}
                    prefetch={Boolean(r.threadId)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[1.02rem] font-semibold text-foreground group-hover:text-primary">
                          {r.displayName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatPhoneDisplay(r.phoneDigits)}
                        </p>
                      </div>
                      <time
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                        dateTime={r.lastMessageAt ?? undefined}
                      >
                        {formatRelativeTime(r.lastMessageAt)}
                      </time>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {r.preview || "No preview"}
                    </p>
                    <span className="sr-only">
                      Opens detail for{" "}
                      {r.threadId ?? "conversation still syncing"}
                    </span>
                  </Link>

                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-52">
                    <Button
                      type="button"
                      size="lg"
                      className="h-10 w-full"
                      disabled={
                        !r.threadId || !r.canAnalyze || busyThread === r.threadId
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void analyze(r.threadId);
                      }}
                    >
                      {busyThread === r.threadId ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                          Working…
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 size-4 opacity-90" aria-hidden />
                          Extract orders
                        </>
                      )}
                    </Button>
                    {!r.canAnalyze && r.threadId ? (
                      <p className="text-center text-[0.6875rem] leading-snug text-muted-foreground">
                        Last extracted {analyzedLabel ?? "recently"}
                        . New messages will unlock this again.
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { saveWhatsAppPhoneE164 } from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WhatsappLinkStatus } from "@/lib/whatsapp-profile-sync";
import { cn } from "@/lib/utils";

type StatusPayload = {
  serviceConfigured?: boolean;
  whatsapp_link_status?: WhatsappLinkStatus;
  logged_in?: boolean;
  needs_qr?: boolean;
  running?: boolean;
  recognizedPhone?: string | null;
  error?: string;
};

function statusLabel(s: WhatsappLinkStatus): string {
  switch (s) {
    case "connected":
      return "Connected";
    case "awaiting_scan":
      return "Waiting for scan";
    case "session_lost":
      return "Reconnect needed";
    default:
      return "Not linked";
  }
}

export function WhatsAppLinkPanel({
  initialStatus,
  initialPhone,
  initialRecognizedPhone,
}: {
  initialStatus: WhatsappLinkStatus;
  initialPhone: string | null;
  initialRecognizedPhone?: string | null;
}) {
  const [status, setStatus] = useState<WhatsappLinkStatus>(initialStatus);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [remote, setRemote] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStart, setLoadingStart] = useState(false);
  const [qrNonce, setQrNonce] = useState(0);
  const [savingPhone, setSavingPhone] = useState(false);
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFetchError, setQrFetchError] = useState(false);

  const refreshStatus = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/whatsapp/session/status");
    const data = (await res.json()) as StatusPayload;
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }
    setRemote(data);
    if (data.whatsapp_link_status) {
      setStatus(data.whatsapp_link_status);
    }
    if (data.needs_qr && data.running) {
      setQrNonce((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status !== "awaiting_scan") return;
    const t = setInterval(refreshStatus, 5000);
    return () => clearInterval(t);
  }, [status, refreshStatus]);

  useEffect(() => {
    if (status !== "connected" && status !== "session_lost") return;
    const interval =
      status === "connected" ? 45_000 : status === "session_lost" ? 25_000 : 0;
    if (!interval) return;
    const t = setInterval(refreshStatus, interval);
    return () => clearInterval(t);
  }, [status, refreshStatus]);

  async function startSession() {
    setLoadingStart(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/session/start", { method: "POST" });
      const data = (await res.json()) as StatusPayload & { ok?: boolean };
      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "Something went wrong. Please try again."
        );
        return;
      }
      if (data.whatsapp_link_status) {
        setStatus(data.whatsapp_link_status);
      }
      setRemote(data);
      setQrNonce((n) => n + 1);
      await refreshStatus();
    } finally {
      setLoadingStart(false);
    }
  }

  async function savePhone() {
    setSavingPhone(true);
    setError(null);
    try {
      const r = await saveWhatsAppPhoneE164(phone);
      if (r.error) {
        setError(r.error);
      }
    } finally {
      setSavingPhone(false);
    }
  }

  const serviceConfigured = remote?.serviceConfigured !== false;
  const showQr =
    status === "awaiting_scan" &&
    serviceConfigured &&
    (Boolean(remote?.needs_qr) || Boolean(remote?.running));

  const recognizedLive =
    (typeof remote?.recognizedPhone === "string" &&
      remote.recognizedPhone.trim()) ||
    (typeof initialRecognizedPhone === "string" &&
      initialRecognizedPhone.trim()) ||
    null;

  useEffect(() => {
    if (!showQr) {
      setQrBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setQrLoading(false);
      setQrFetchError(false);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;

    async function loadQr(attempt: number) {
      setQrLoading(true);
      setQrFetchError(false);
      try {
        const res = await fetch(
          `/api/whatsapp/session/qr?t=${qrNonce}&n=${attempt}`,
          { cache: "no-store" }
        );
        if (cancelled) return;

        if (res.ok) {
          const blob = await res.blob();
          if (cancelled) return;
          const nextUrl = URL.createObjectURL(blob);
          createdUrl = nextUrl;
          setQrBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return nextUrl;
          });
          setQrLoading(false);
          return;
        }

        const data = (await res.json().catch(() => ({}))) as { code?: string };
        if (res.status === 409 && data.code === "already_logged_in") {
          setQrLoading(false);
          await refreshStatus();
          return;
        }
        if (
          res.status === 404 &&
          data.code === "qr_not_ready" &&
          attempt < 8
        ) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!cancelled) return loadQr(attempt + 1);
        }
        setQrFetchError(true);
        setQrLoading(false);
      } catch {
        if (!cancelled) {
          setQrFetchError(true);
          setQrLoading(false);
        }
      }
    }

    void loadQr(0);

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [showQr, qrNonce, refreshStatus]);

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">WhatsApp</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Connect the WhatsApp number you use with customers. Tap{" "}
        <strong>Connect WhatsApp</strong>, open WhatsApp on your phone, go to{" "}
        <strong>Settings → Linked devices → Link a device</strong>, then scan the
        code that appears here.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
            status === "connected" && "bg-primary/10 text-primary",
            status === "awaiting_scan" &&
              "bg-amber-500/10 text-amber-800 dark:text-amber-200",
            status === "session_lost" &&
              "border border-amber-500/35 bg-amber-500/8 text-amber-900 dark:text-amber-100",
            status === "disconnected" && "bg-muted text-muted-foreground"
          )}
        >
          {statusLabel(status)}
        </span>
        {remote?.serviceConfigured === false ? (
          <span className="text-xs text-muted-foreground">
            Linking isn’t available on this workspace yet. Try again later.
          </span>
        ) : null}
      </div>

      {status === "connected" || status === "awaiting_scan" ? (
        <div className="mt-4 rounded-lg border border-border/80 bg-muted/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          <p className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            Number from your linked WhatsApp session
          </p>
          <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
            {recognizedLive ?? "We’re confirming the number…"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            This is read from the browser session that stays signed in for ChatLog — not
            from the optional team label below. It should match the phone you scanned with
            in WhatsApp → Settings → Linked devices.
          </p>
          {status === "connected" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Status refreshes periodically so you can see if you need to scan again after
              a restart.
            </p>
          ) : null}
        </div>
      ) : null}

      {status === "session_lost" ? (
        <div className="mt-5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-sm leading-relaxed text-amber-950 dark:text-amber-50">
          <p className="font-medium">
            WhatsApp disconnected from ChatLog&apos;s pairing session.
          </p>
          <p className="mt-1 text-amber-900/95 dark:text-amber-100/90">
            This usually happens after the pairing service restarted or WhatsApp ended
            the session. Tap <strong>Connect WhatsApp</strong> and scan another code to
            come back online.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 space-y-2">
        <Label htmlFor="wa-phone">Personal label — optional</Label>
        <p className="text-xs text-muted-foreground">
          Add whatever number you want printed on dashboards for teammates (for example
          the same WhatsApp Business line you advertise). Doesn&apos;t control linking.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            id="wa-phone"
            name="whatsapp_phone"
            type="tel"
            autoComplete="tel"
            placeholder="+92…"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="sm:max-w-sm"
          />
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={savingPhone}
            onClick={savePhone}
          >
            {savingPhone ? "Saving…" : "Save label"}
          </Button>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Button
            type="button"
            onClick={startSession}
            disabled={loadingStart}
            className="w-full sm:w-auto"
          >
            {loadingStart ? "Connecting…" : "Connect WhatsApp"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={refreshStatus}
          >
            Refresh status
          </Button>
        </div>

        {showQr ? (
          <div className="flex w-full max-w-[260px] flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 sm:max-w-none">
            <p className="text-center text-xs text-muted-foreground">
              Scan this code with your phone. It may take a short while to appear.
            </p>
            <div className="flex min-h-[220px] w-full max-w-[220px] items-center justify-center rounded-md bg-white p-1">
              {qrLoading ? (
                <Loader2
                  className="size-10 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : null}
              {!qrLoading && qrBlobUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrBlobUrl}
                  alt="Code to link your WhatsApp account"
                  width={220}
                  height={220}
                  className="max-h-[220px] max-w-full rounded-md"
                />
              ) : null}
              {!qrLoading && !qrBlobUrl && !qrFetchError ? (
                <span className="px-2 text-center text-xs text-muted-foreground">
                  Preparing code…
                </span>
              ) : null}
            </div>
            {qrFetchError ? (
              <p className="max-w-xs text-center text-xs text-destructive">
                The code didn’t load. Tap <strong>Refresh status</strong> or{" "}
                <strong>Connect WhatsApp</strong> again.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

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
  const [qrLoadError, setQrLoadError] = useState(false);

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
    if (showQr) {
      setQrLoadError(false);
    }
  }, [showQr, qrNonce]);

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
            Linked account
          </p>
          <p className="mt-1 text-base font-semibold tabular-nums text-foreground">
            {recognizedLive ?? "We’re confirming the number…"}
          </p>
          {status === "connected" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Status refreshes periodically so you always see whether you’re still
              signed in after hosting restarts.
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
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-4">
            <p className="text-center text-xs text-muted-foreground">
              Scan this code with your phone. It may take a short while to appear.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={qrNonce}
              src={`/api/whatsapp/session/qr?t=${qrNonce}`}
              alt="Code to link your WhatsApp account"
              width={220}
              height={220}
              className="rounded-md bg-white p-1"
              onLoad={() => setQrLoadError(false)}
              onError={() => setQrLoadError(true)}
            />
            {qrLoadError ? (
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

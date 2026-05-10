"use client";

import { useCallback, useEffect, useState } from "react";

import { saveWhatsAppPhoneE164 } from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type WhatsappLinkStatus =
  | "disconnected"
  | "awaiting_scan"
  | "connected";

type StatusPayload = {
  serviceConfigured?: boolean;
  whatsapp_link_status?: WhatsappLinkStatus;
  logged_in?: boolean;
  needs_qr?: boolean;
  running?: boolean;
  error?: string;
};

function statusLabel(s: WhatsappLinkStatus): string {
  switch (s) {
    case "connected":
      return "Connected";
    case "awaiting_scan":
      return "Waiting for QR scan";
    default:
      return "Not linked";
  }
}

export function WhatsAppLinkPanel({
  initialStatus,
  initialPhone,
}: {
  initialStatus: WhatsappLinkStatus;
  initialPhone: string | null;
}) {
  const [status, setStatus] = useState<WhatsappLinkStatus>(initialStatus);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [remote, setRemote] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStart, setLoadingStart] = useState(false);
  const [qrNonce, setQrNonce] = useState(0);
  const [savingPhone, setSavingPhone] = useState(false);

  const refreshStatus = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/whatsapp/session/status");
    const data = (await res.json()) as StatusPayload;
    if (!res.ok) {
      setError(data.error ?? "Could not refresh status");
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
            : "Could not start WhatsApp session"
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

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">WhatsApp</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Link the WhatsApp number you use for customer orders. We open WhatsApp Web
        in a secure session: scan the QR code with the phone that owns that number.
        Chat ingestion will use this connection once message processing is enabled.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
            status === "connected" &&
              "bg-primary/10 text-primary",
            status === "awaiting_scan" &&
              "bg-amber-500/10 text-amber-800 dark:text-amber-200",
            status === "disconnected" && "bg-muted text-muted-foreground"
          )}
        >
          {statusLabel(status)}
        </span>
        {remote?.serviceConfigured === false ? (
          <span className="text-xs text-muted-foreground">
            Automation URL/secret not set on this deployment.
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 space-y-2">
        <Label htmlFor="wa-phone">Business WhatsApp number (optional)</Label>
        <p className="text-xs text-muted-foreground">
          E.164 format if possible (e.g. +923001234567). Used as a label for your
          team; linking is still done by scanning QR with that device.
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
            {savingPhone ? "Saving…" : "Save number"}
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
            {loadingStart ? "Starting…" : "Start linking session"}
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
              Scan with your business phone (WhatsApp → Linked devices).
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/whatsapp/session/qr?t=${qrNonce}`}
              alt="WhatsApp Web QR code"
              width={220}
              height={220}
              className="rounded-md bg-white p-1"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

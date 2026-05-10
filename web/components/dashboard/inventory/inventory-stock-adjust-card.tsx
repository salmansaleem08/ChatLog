"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { adjustVariantStockAction } from "@/app/dashboard/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function InventoryStockAdjustCard({
  productId,
  variantId,
  summary,
  currentStock,
}: {
  productId: string;
  variantId: string;
  summary: string;
  currentStock: number;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set("product_id", productId);
    fd.set("variant_id", variantId);
    fd.set("delta", delta.trim());
    fd.set("reason", reason.trim());
    startTransition(async () => {
      const r = await adjustVariantStockAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSuccess(r.message ?? "Stock updated.");
      setDelta("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-border bg-muted/30 p-4 sm:p-5"
    >
      <p className="text-sm font-medium text-foreground">{summary}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Current on hand:<span className="ml-1 tabular-nums font-medium text-foreground">{currentStock}</span>
      </p>
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-2 text-xs font-medium text-primary" role="status">
          {success}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor={`delta-${variantId}`}>Change quantity</Label>
          <Input
            id={`delta-${variantId}`}
            inputMode="numeric"
            placeholder="+10 or −3"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            aria-describedby={`delta-hint-${variantId}`}
            className="max-w-xs"
          />
          <p id={`delta-hint-${variantId}`} className="text-xs leading-relaxed text-muted-foreground">
            Positive numbers add stock (for example shipments). Negative numbers remove it (damage or corrections).
          </p>
        </div>
        <div className="min-w-0 flex-[2] space-y-2">
          <Label htmlFor={`reason-${variantId}`}>Reason</Label>
          <Textarea
            id={`reason-${variantId}`}
            rows={2}
            placeholder="Shipment arrived, count correction…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className="min-h-[76px]"
          />
        </div>
        <div className="shrink-0 lg:pt-7">
          <Button type="submit" disabled={pending} className="w-full lg:w-auto">
            {pending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Applying…
              </>
            ) : (
              "Apply change"
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

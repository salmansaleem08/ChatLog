"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import { deleteProductAction } from "@/app/dashboard/inventory/actions";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function InventoryDeleteSection({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await deleteProductAction(productId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.push("/dashboard/inventory");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-destructive">Remove product</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Deleting removes this product and all of its variations from your catalog.
      </p>
      <Button
        type="button"
        variant="destructive"
        className="mt-4"
        onClick={() => setOpen(true)}
      >
        Delete product…
      </Button>

      <AlertDialog.Root open={open} onOpenChange={setOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px]" />
          <AlertDialog.Popup className="fixed inset-0 z-50 mx-auto flex min-h-[100vh] items-center justify-center px-4 py-16">
            <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
              <AlertDialog.Title className="text-lg font-semibold tracking-tight">
                Delete this product?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{productName}</span>{" "}
                will be removed from inventory. This cannot be undone.
              </AlertDialog.Description>
              {error ? (
                <p className="mt-3 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Keep product
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={confirm}
                >
                  {pending ? "Removing…" : "Delete permanently"}
                </Button>
              </div>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}

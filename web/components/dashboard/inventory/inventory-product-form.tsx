"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import {
  createProductAction,
  updateProductAction,
} from "@/app/dashboard/inventory/actions";
import type { VariantPayload } from "@/app/dashboard/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { defaultVariantDraft } from "@/lib/inventory/helpers";
import type { VariantDraft } from "@/lib/inventory/types";

function buildPayload(variants: VariantDraft[]): VariantPayload[] {
  return variants.map((v) => ({
    id: v.id,
    pairs: v.pairs,
    stock: v.stock,
  }));
}

export function InventoryProductForm({
  mode,
  productId,
  initial,
}: {
  mode: "new" | "edit";
  productId?: string;
  initial: {
    name: string;
    category: string;
    cost_price: string;
    selling_price: string;
    description: string;
    low_stock_threshold: string;
    variants: VariantDraft[];
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantDraft[]>(
    initial.variants.length ? initial.variants : [defaultVariantDraft()]
  );

  const addVariant = useCallback(() => {
    setVariants((vs) => [...vs, defaultVariantDraft()]);
  }, []);

  const removeVariant = useCallback((clientKey: string) => {
    setVariants((vs) => {
      if (vs.length <= 1) return vs;
      return vs.filter((v) => v.clientKey !== clientKey);
    });
  }, []);

  const patchVariant = useCallback(
    (
      clientKey: string,
      patch: Partial<VariantDraft> | ((v: VariantDraft) => VariantDraft)
    ) => {
      setVariants((vs) =>
        vs.map((v) =>
          v.clientKey === clientKey
            ? typeof patch === "function"
              ? patch(v)
              : { ...v, ...patch }
            : v
        )
      );
    },
    []
  );

  function addPair(clientKey: string) {
    patchVariant(clientKey, (v) => ({
      ...v,
      pairs: [...v.pairs, { key: "", value: "" }],
    }));
  }

  function removePair(clientKey: string, index: number) {
    patchVariant(clientKey, (v) => ({
      ...v,
      pairs: v.pairs.length <= 1 ? v.pairs : v.pairs.filter((_, i) => i !== index),
    }));
  }

  function patchPair(
    clientKey: string,
    index: number,
    field: "key" | "value",
    value: string
  ) {
    patchVariant(clientKey, (v) => ({
      ...v,
      pairs: v.pairs.map((p, i) =>
        i === index ? { ...p, [field]: value } : p
      ),
    }));
  }

  async function submit(fd: FormData) {
    setError(null);
    fd.set(
      "variants_json",
      JSON.stringify(buildPayload(variants))
    );
    startTransition(async () => {
      const res =
        mode === "new"
          ? await createProductAction(fd)
          : await updateProductAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (mode === "new" && res.productId) {
        router.push(`/dashboard/inventory/${res.productId}`);
        router.refresh();
        return;
      }
      if (mode === "edit" && productId) {
        router.push(`/dashboard/inventory/${productId}`);
        router.refresh();
      }
    });
  }

  return (
    <form
      className="mx-auto max-w-3xl space-y-10 pb-24"
      action={submit}
      noValidate
    >
      <input type="hidden" name="product_id" value={productId ?? ""} />

      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Basics</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Name how customers know this item. Costs and selling price help with
          margins later.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Product name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={initial.name}
              maxLength={200}
              autoComplete="off"
              aria-invalid={!!error}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              name="category"
              placeholder="Outwear · Fabric · Cakes…"
              defaultValue={initial.category}
              maxLength={128}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cost_price">Cost (what you pay)</Label>
            <Input
              id="cost_price"
              name="cost_price"
              inputMode="decimal"
              required
              defaultValue={initial.cost_price}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="selling_price">Selling price</Label>
            <Input
              id="selling_price"
              name="selling_price"
              inputMode="decimal"
              required
              defaultValue={initial.selling_price}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="low_stock_threshold">Low-stock alert threshold</Label>
            <Input
              id="low_stock_threshold"
              name="low_stock_threshold"
              inputMode="numeric"
              required
              defaultValue={initial.low_stock_threshold}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              We flag this product when any variation is at or below this count.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Description — optional</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              maxLength={4000}
              defaultValue={initial.description}
              placeholder="Materials, sizing notes, pairing ideas…"
            />
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Variations & stock</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Add as many combinations as you sell — fabric, hem, flavor, wattage —
            whatever fits. Leave labels blank for one simple SKU.
          </p>
        </div>

        <div className="space-y-6">
          {variants.map((v, vi) => (
            <div
              key={v.clientKey}
              className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow duration-500 ease-out sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Variation {vi + 1}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={variants.length <= 1}
                  onClick={() => removeVariant(v.clientKey)}
                >
                  Remove
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Attributes
                </p>
                {v.pairs.map((pair, pi) => (
                  <div
                    key={pi}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      aria-label={`Variation ${vi + 1} label ${pi + 1}`}
                      placeholder="Label · e.g. Color"
                      value={pair.key}
                      onChange={(e) =>
                        patchPair(v.clientKey, pi, "key", e.target.value)
                      }
                    />
                    <Input
                      aria-label={`Variation ${vi + 1} value ${pi + 1}`}
                      placeholder="Value · e.g. Navy"
                      value={pair.value}
                      onChange={(e) =>
                        patchPair(v.clientKey, pi, "value", e.target.value)
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0"
                      disabled={v.pairs.length <= 1}
                      onClick={() => removePair(v.clientKey, pi)}
                    >
                      Clear row
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addPair(v.clientKey)}
                  className="mt-2"
                >
                  Add attribute row
                </Button>
              </div>

              <div className="mt-6 space-y-2">
                <Label htmlFor={`stock-${v.clientKey}`}>Stock quantity</Label>
                <Input
                  id={`stock-${v.clientKey}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={Number.isFinite(v.stock) ? v.stock : 0}
                  onChange={(e) =>
                    patchVariant(v.clientKey, {
                      stock: Number.parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="max-w-[12rem]"
                />
              </div>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" size="lg" onClick={addVariant}>
          Add another variation
        </Button>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-card/80 sm:sticky sm:inset-auto sm:flex sm:justify-end sm:gap-3 sm:bg-transparent sm:px-0 sm:pb-8 sm:pt-6 sm:backdrop-blur-none">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => router.push("/dashboard/inventory")}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="min-w-[9rem]">
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : mode === "new" ? (
            "Create product"
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </form>
  );
}

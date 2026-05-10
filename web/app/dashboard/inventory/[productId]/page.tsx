import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { InventoryDeleteSection } from "@/components/dashboard/inventory/inventory-delete-dialog";
import { InventoryStockAdjustCard } from "@/components/dashboard/inventory/inventory-stock-adjust-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  formatVariantSummary,
  toNumber,
  variantDraftFromDb,
} from "@/lib/inventory/helpers";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export default async function InventoryProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (error || !product) {
    notFound();
  }

  const { data: variantRows } = await supabase
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: true });

  const variants = variantRows ?? [];
  const variantIds = variants.map((v) => v.id);

  let moveRows: {
    id: string;
    variant_id: string;
    delta: number;
    reason: string;
    created_at: string;
  }[] = [];
  if (variantIds.length > 0) {
    const { data: moves } = await supabase
      .from("variant_stock_moves")
      .select("id,variant_id,delta,reason,created_at")
      .in("variant_id", variantIds)
      .order("created_at", { ascending: false })
      .limit(40);
    moveRows = moves ?? [];
  }

  const summaries = new Map<string, string>();
  for (const v of variants) {
    summaries.set(v.id, formatVariantSummary(asAttrs(v.attributes)));
  }

  const low = Number(product.low_stock_threshold ?? 5);
  const totalStock = variants.reduce((s, v) => s + Number(v.stock_quantity ?? 0), 0);
  const anyLow = variants.some((v) => Number(v.stock_quantity ?? 0) <= low);

  const costStr = formatMoneyAmount(toNumber(product.cost_price));
  const sellStr = formatMoneyAmount(toNumber(product.selling_price));

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-8">
        <div className="min-w-0 space-y-2">
          <Link
            href="/dashboard/inventory"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline hover:underline-offset-4"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Inventory
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {product.name}
            </h1>
            {anyLow ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100"
              >
                Low stock
              </Badge>
            ) : null}
          </div>
          {product.category?.trim() ? (
            <p className="text-sm text-muted-foreground">{product.category}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Uncategorized</p>
          )}
        </div>
        <Link
          href={`/dashboard/inventory/${productId}/edit`}
          className={cn(buttonVariants({ variant: "default", size: "lg" }), "h-11")}
        >
          Edit product
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Economics
          </h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Cost
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{costStr}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Selling price
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{sellStr}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Combined stock
              </dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{totalStock}</dd>
            </div>
          </dl>
          {product.description?.trim() ? (
            <div className="border-t border-border/80 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Description
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {product.description}
              </p>
            </div>
          ) : null}
        </section>

        <aside className="rounded-xl border border-border bg-muted/25 p-5 text-sm shadow-sm">
          <p className="font-medium text-foreground">Low-stock alert</p>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            We flag this product when any variation is at or below{" "}
            <span className="tabular-nums font-semibold text-foreground">{low}</span>{" "}
            units. Change this on the edit screen anytime.
          </p>
        </aside>
      </div>

      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Variations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live counts and controlled adjustments stay in sync for your workspace.
          </p>
        </div>
        <ul className="space-y-6">
          {variants.map((row) => {
            const draft = variantDraftFromDb({
              id: row.id,
              attributes: row.attributes,
              stock_quantity: Number(row.stock_quantity ?? 0),
            });
            const summary = summaries.get(row.id) ?? "Variation";
            const stock = Number(row.stock_quantity ?? 0);
            const isRowLow = stock <= low;
            return (
              <li
                key={row.id}
                className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-muted/15 px-5 py-4 sm:px-6">
                  <div>
                    <p className="font-medium text-foreground">{summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="tabular-nums font-semibold text-foreground">
                        {stock}
                      </span>{" "}
                      on hand
                      {isRowLow ? (
                        <span className="ml-2 text-amber-800 dark:text-amber-200">
                          · below threshold
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>
                <div className="space-y-4 p-5 sm:p-6">
                  {draft.pairs.filter((p) => p.key || p.value).length > 0 ? (
                    <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {draft.pairs
                        .filter((p) => p.key.trim() || p.value.trim())
                        .map((pair, i) => (
                          <li
                            key={i}
                            className="rounded-md border border-border bg-background px-2.5 py-1"
                          >
                            <span className="font-medium text-foreground">
                              {pair.key.trim()}
                            </span>
                            : {pair.value.trim()}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">Single SKU — no extra labels.</p>
                  )}
                  <InventoryStockAdjustCard
                    productId={productId}
                    variantId={row.id}
                    summary={summary}
                    currentStock={stock}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {moveRows.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">
            Recent stock updates
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual changes with a reason from this page.
          </p>
          <ul className="mt-5 divide-y divide-border">
            {moveRows.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{m.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {summaries.get(m.variant_id) ?? "Variation"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm tabular-nums">
                  <span
                    className={cn(
                      "font-semibold",
                      m.delta > 0 ? "text-primary" : "text-destructive"
                    )}
                  >
                    {m.delta > 0 ? "+" : ""}
                    {m.delta}
                  </span>
                  <time
                    className="text-muted-foreground"
                    dateTime={m.created_at}
                  >
                    {new Date(m.created_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <InventoryDeleteSection
        productId={productId}
        productName={product.name}
      />
    </div>
  );
}

function asAttrs(raw: unknown): Record<string, string> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  return {};
}

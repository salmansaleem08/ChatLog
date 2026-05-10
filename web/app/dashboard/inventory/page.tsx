import Link from "next/link";
import { Layers, Package, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatVariantSummary, toNumber } from "@/lib/inventory/helpers";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type VariantRow = { id: string; stock_quantity: number; attributes: unknown };

export default async function InventoryPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rows, error } = await supabase
    .from("products")
    .select(
      "id,name,category,selling_price,low_stock_threshold,product_variants(id,stock_quantity,attributes)"
    )
    .eq("business_id", user.id)
    .order("name", { ascending: true });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm leading-relaxed text-destructive">
        We couldn’t load inventory. Try refreshing the page in a moment.
      </div>
    );
  }

  const items = rows ?? [];

  const cards = items.map((p) => {
    const variants = (p.product_variants ?? []) as VariantRow[];
    const total = variants.reduce((s, v) => s + v.stock_quantity, 0);
    const low = Number(p.low_stock_threshold ?? 5);
    const anyLow = variants.some((v) => v.stock_quantity <= low);
    return {
      ...p,
      variants,
      total_stock: total,
      is_low: anyLow,
      selling_price: toNumber(p.selling_price),
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-16">
      <div className="flex flex-col gap-4 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Inventory
          </h1>
          <p className="leading-relaxed text-muted-foreground">
            Your catalog ties every sale back to accurate stock counts. Add what
            you sell today — variants, thresholds, and levels stay with you alone.
          </p>
        </div>
        <Link
          href="/dashboard/inventory/new"
          className={cn(
            buttonVariants({ size: "lg" }),
            "inline-flex h-11 shrink-0 px-6 sm:h-10"
          )}
        >
          <Plus className="mr-2 size-4 opacity-90" aria-hidden />
          Add product
        </Link>
      </div>

      {cards.length === 0 ? (
        <section className="flex min-h-[24rem] flex-col items-center justify-center rounded-xl border border-dashed border-primary/35 bg-card px-8 py-16 text-center shadow-sm transition-colors duration-500 ease-out sm:py-20">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/12 text-primary">
            <Layers className="size-9" strokeWidth={1.5} aria-hidden />
          </div>
          <h2 className="mt-7 text-xl font-semibold tracking-tight sm:text-2xl">
            Build your shelf
          </h2>
          <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">
            Start with one item — shirts, parcels, pastries, bundles — then add each
            size, shade, style, or version you actually stock. Customers never see this;
            they only benefit when your counts match reality.
          </p>
          <Link
            href="/dashboard/inventory/new"
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-10 inline-flex h-11 px-8"
            )}
          >
            <Package className="mr-2 size-4 opacity-90" aria-hidden />
            Add your first product
          </Link>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((p) => {
            const subtitle =
              p.category?.trim() ||
              `${p.variants.length} variation${p.variants.length === 1 ? "" : "s"}`;
            const previewVariants = p.variants.slice(0, 3).map((v) => {
              const raw = v.attributes;
              const attrs =
                raw && typeof raw === "object" && !Array.isArray(raw)
                  ? (raw as Record<string, string>)
                  : {};
              return formatVariantSummary(attrs);
            });

            return (
              <li key={p.id}>
                <Link
                  href={`/dashboard/inventory/${p.id}`}
                  className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 shadow-sm outline-none ring-offset-background transition-colors duration-200 hover:border-primary/35 hover:bg-card/95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2 text-[1.0625rem] font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary">
                      {p.name}
                    </span>
                    {p.is_low ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-500/40 bg-amber-500/10 text-[0.6875rem] font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-100"
                      >
                        Low stock
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
                  <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border/80 pt-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Total stock
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                        {p.total_stock}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Selling price
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                        {formatMoneyAmount(p.selling_price)}
                      </p>
                    </div>
                  </div>
                  {previewVariants.length > 0 ? (
                    <div className="mt-4 space-y-1 border-t border-border/60 pt-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Variations
                      </p>
                      <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                        {previewVariants.map((line, i) => (
                          <li key={i} className="line-clamp-1">
                            {line}
                          </li>
                        ))}
                        {p.variants.length > 3 ? (
                          <li className="text-muted-foreground/80">
                            +{p.variants.length - 3} more…
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                  <span className="mt-6 text-sm font-medium text-primary opacity-95 group-hover:underline group-hover:underline-offset-4">
                    Open details →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

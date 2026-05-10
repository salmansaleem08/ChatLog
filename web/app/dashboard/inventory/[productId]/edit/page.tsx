import { notFound } from "next/navigation";

import { InventoryProductForm } from "@/components/dashboard/inventory/inventory-product-form";
import { formatMoneyAmount } from "@/lib/inventory/money-format";
import { toNumber, variantDraftFromDb } from "@/lib/inventory/helpers";
import { createClient } from "@/lib/supabase/server";

export default async function EditInventoryProductPage({
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
    .select(
      "id,name,category,cost_price,selling_price,description,low_stock_threshold"
    )
    .eq("id", productId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (error || !product) {
    notFound();
  }

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id,attributes,stock_quantity")
    .eq("product_id", productId);

  const drafts = (variants ?? []).map((v) =>
    variantDraftFromDb({
      id: v.id,
      attributes: v.attributes,
      stock_quantity: Number(v.stock_quantity ?? 0),
    })
  );

  return (
    <div className="mx-auto max-w-6xl pb-28">
      <div className="mb-10 border-b border-border pb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Edit product
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          Update naming, margins, thresholds, variations, or on-hand totals. Stock
          changes you make here are saved directly.
        </p>
      </div>
      <InventoryProductForm
        mode="edit"
        productId={product.id}
        initial={{
          name: product.name,
          category: product.category ?? "",
          cost_price: formatMoneyAmount(toNumber(product.cost_price)),
          selling_price: formatMoneyAmount(toNumber(product.selling_price)),
          description: product.description ?? "",
          low_stock_threshold: String(product.low_stock_threshold ?? 5),
          variants: drafts,
        }}
      />
    </div>
  );
}

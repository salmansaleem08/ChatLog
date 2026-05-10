import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatVariantSummary,
  toNumber,
} from "@/lib/inventory/helpers";
import type { InventoryCatalogVariant } from "@/lib/order-extractor";

export async function loadInventoryCatalogVariants(
  supabase: SupabaseClient,
  userId: string
): Promise<InventoryCatalogVariant[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id,name,selling_price,product_variants(id,attributes)")
    .eq("business_id", userId);

  if (error) throw new Error("inventory_load_failed");

  const rows: InventoryCatalogVariant[] = [];
  for (const p of data ?? []) {
    const sell = toNumber((p as { selling_price?: unknown }).selling_price);
    const variants =
      (
        p as {
          product_variants?: { id: string; attributes: unknown }[];
        }
      ).product_variants ?? [];
    for (const v of variants) {
      const raw = v.attributes;
      const attrs =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, string>)
          : {};
      rows.push({
        variant_id: v.id,
        product_id: String((p as { id: string }).id),
        product_name: String((p as { name?: string }).name ?? ""),
        variant_label: formatVariantSummary(attrs),
        selling_price: sell,
      });
    }
  }
  return rows;
}

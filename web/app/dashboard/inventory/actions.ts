"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

type ActionOk = {
  ok: true;
  message?: string;
  productId?: string;
};
type ActionErr = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type InventoryActionResult = ActionOk | ActionErr;

function err(msg: string, fieldErrors?: Record<string, string>): ActionErr {
  return { ok: false as const, error: msg, fieldErrors };
}

function ok(opts?: { message?: string; productId?: string }): ActionOk {
  if (!opts) return { ok: true as const };
  return {
    ok: true as const,
    ...(opts.message ? { message: opts.message } : {}),
    ...(opts.productId ? { productId: opts.productId } : {}),
  };
}

function parseDecimal(input: unknown, label: string): number | ActionErr {
  if (typeof input !== "string") return err(`${label} is required.`);
  const n = Number.parseFloat(input.replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return err(`${label} must be zero or greater.`);
  return Math.round(n * 10000) / 10000;
}

function parseIntBounded(
  input: unknown,
  label: string,
  min: number,
  max: number
): number | ActionErr {
  if (typeof input !== "string") return err(`${label} is required.`);
  const n = Number.parseInt(input.trim(), 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    return err(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

/**
 * Build JSONB object from key/value pairs; drop blank rows.
 * Returns an error message, or `{}` when there are no attribute rows (simple product variant).
 */
function pairsToAttributes(
  pairs: { key: string; value: string }[]
): string | Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of pairs) {
    const k = row.key.trim();
    const v = row.value.trim();
    if (!k && !v) continue;
    if (!k) return "Each variation needs a label for every row you start.";
    if (!v) return `Add a value for “${k}” or remove that row.`;
    if (k.length > 64 || v.length > 128) {
      return "Labels and values must be shorter than the limit.";
    }
    if (out[k] !== undefined) {
      return `Duplicate label “${k}” in one variation. Combine them into one row.`;
    }
    out[k] = v;
  }
  return out;
}

export type VariantPayload = {
  id?: string;
  pairs: { key: string; value: string }[];
  stock: number;
};

function parseVariantsJSON(raw: unknown): VariantPayload[] | ActionErr {
  if (typeof raw !== "string") return err("Variations could not be read. Refresh and try again.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err("Variations could not be read. Check your entries and try again.");
  }
  if (!Array.isArray(parsed) || parsed.length < 1) {
    return err("Add at least one variation or stock row.");
  }
  const variants: VariantPayload[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    if (typeof row !== "object" || row === null) return err(`Variation ${i + 1} is invalid.`);
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : undefined;
    const pairsRaw = o.pairs;
    if (!Array.isArray(pairsRaw)) return err(`Variation ${i + 1}: add attributes or leave one empty variation for a simple product.`);

    const pairs: { key: string; value: string }[] = [];
    for (const p of pairsRaw) {
      if (typeof p !== "object" || p === null) continue;
      const pr = p as Record<string, unknown>;
      pairs.push({
        key: typeof pr.key === "string" ? pr.key : "",
        value: typeof pr.value === "string" ? pr.value : "",
      });
    }
    const stockN =
      typeof o.stock === "number"
        ? o.stock
        : Number.parseInt(String(o.stock ?? ""), 10);
    if (!Number.isFinite(stockN) || stockN < 0 || stockN > 1_000_000_000) {
      return err(`Variation ${i + 1}: stock must be a whole number between 0 and 1,000,000,000.`);
    }
    variants.push({ id, pairs, stock: stockN });
  }
  return variants;
}

async function ensureUser(supabase: ReturnType<typeof createClient>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return user;
}

export async function createProductAction(formData: FormData): Promise<InventoryActionResult> {
  const supabase = createClient();
  const user = await ensureUser(supabase);
  if (!user) return err("Please sign in again.");

  const nameRaw = formData.get("name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > 200) return err("Enter a product name (up to 200 characters).");

  const categoryRaw = formData.get("category");
  const category = typeof categoryRaw === "string" ? categoryRaw.trim().slice(0, 128) : "";

  const cost = parseDecimal(formData.get("cost_price"), "Cost");
  if (typeof cost !== "number") return cost;
  const sell = parseDecimal(formData.get("selling_price"), "Selling price");
  if (typeof sell !== "number") return sell;

  const descRaw = formData.get("description");
  const description =
    typeof descRaw === "string" && descRaw.trim() ? descRaw.trim().slice(0, 4000) : null;

  const low = parseIntBounded(formData.get("low_stock_threshold"), "Low-stock alert", 0, 1_000_000_000);
  if (typeof low !== "number") return low;

  const variants = parseVariantsJSON(formData.get("variants_json"));
  if (!Array.isArray(variants)) return variants;

  const rows: { attributes: Record<string, string>; stock: number }[] = [];
  for (const v of variants) {
    const attrs = pairsToAttributes(v.pairs);
    if (typeof attrs === "string") return err(attrs);
    rows.push({ attributes: attrs, stock: v.stock });
  }

  const { data: product, error: pErr } = await supabase
    .from("products")
    .insert({
      business_id: user.id,
      name,
      category,
      cost_price: cost,
      selling_price: sell,
      description,
      low_stock_threshold: low,
    })
    .select("id")
    .single();

  if (pErr || !product) {
    return err(
      "We couldn’t save the product. Check your entries and try again."
    );
  }

  const ins = rows.map((r) => ({
    product_id: product.id,
    attributes: r.attributes,
    stock_quantity: r.stock,
  }));

  const { error: vErr } = await supabase.from("product_variants").insert(ins);

  if (vErr) {
    await supabase.from("products").delete().eq("id", product.id);
    return err("We couldn’t save the variations. Fix any issues and try again.");
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath(`/dashboard/inventory/${product.id}`);
  return ok({ productId: product.id });
}

export async function updateProductAction(formData: FormData): Promise<InventoryActionResult> {
  const supabase = createClient();
  const user = await ensureUser(supabase);
  if (!user) return err("Please sign in again.");

  const productIdRaw = formData.get("product_id");
  const productId = typeof productIdRaw === "string" ? productIdRaw.trim() : "";
  if (!productId) return err("Something went wrong. Refresh the page.");

  const { data: existing, error: exErr } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("business_id", user.id)
    .maybeSingle();

  if (exErr || !existing) return err("That product couldn’t be found.");

  const nameRaw = formData.get("name");
  const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
  if (!name || name.length > 200) return err("Enter a product name (up to 200 characters).");

  const categoryRaw = formData.get("category");
  const category = typeof categoryRaw === "string" ? categoryRaw.trim().slice(0, 128) : "";

  const cost = parseDecimal(formData.get("cost_price"), "Cost");
  if (typeof cost !== "number") return cost;
  const sell = parseDecimal(formData.get("selling_price"), "Selling price");
  if (typeof sell !== "number") return sell;

  const descRaw = formData.get("description");
  const description =
    typeof descRaw === "string" && descRaw.trim() ? descRaw.trim().slice(0, 4000) : null;

  const low = parseIntBounded(formData.get("low_stock_threshold"), "Low-stock alert", 0, 1_000_000_000);
  if (typeof low !== "number") return low;

  const variants = parseVariantsJSON(formData.get("variants_json"));
  if (!Array.isArray(variants)) return variants;

  const { error: uErr } = await supabase
    .from("products")
    .update({
      name,
      category,
      cost_price: cost,
      selling_price: sell,
      description,
      low_stock_threshold: low,
    })
    .eq("id", productId)
    .eq("business_id", user.id);

  if (uErr) return err("We couldn’t update the product.");

  const { data: prevVariants } = await supabase
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);

  const prevIds = new Set((prevVariants ?? []).map((x) => x.id));
  const keepIds = new Set<string>();

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const attrs = pairsToAttributes(v.pairs);
    if (typeof attrs === "string") return err(attrs);
    const attrsObj = attrs;

    if (v.id && prevIds.has(v.id)) {
      keepIds.add(v.id);
      const { error } = await supabase
        .from("product_variants")
        .update({
          attributes: attrsObj,
          stock_quantity: v.stock,
        })
        .eq("id", v.id)
        .eq("product_id", productId);
      if (error)
        return err(`We couldn’t update variation ${i + 1}. Check your entries.`);
    } else {
      const { error } = await supabase.from("product_variants").insert({
        product_id: productId,
        attributes: attrsObj,
        stock_quantity: v.stock,
      });
      if (error)
        return err(`We couldn’t save a new variation (row ${i + 1}).`);
    }
  }

  const toRemove = Array.from(prevIds).filter((id) => !keepIds.has(id));
  if (toRemove.length > 0) {
    const { error: dErr } = await supabase
      .from("product_variants")
      .delete()
      .eq("product_id", productId)
      .in("id", toRemove);
    if (dErr)
      return err("We couldn’t remove a variation you dropped from the form.");
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath(`/dashboard/inventory/${productId}`);
  return ok({ productId });
}

export async function deleteProductAction(productId: string): Promise<InventoryActionResult> {
  const supabase = createClient();
  const user = await ensureUser(supabase);
  if (!user) return err("Please sign in again.");

  const id = productId.trim();
  if (!id) return err("Something went wrong. Refresh and try again.");

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("business_id", user.id);

  if (error) return err("We couldn’t delete that product. Try again.");

  revalidatePath("/dashboard/inventory");
  return ok();
}

export async function adjustVariantStockAction(formData: FormData): Promise<InventoryActionResult> {
  const supabase = createClient();
  const user = await ensureUser(supabase);
  if (!user) return err("Please sign in again.");

  const variantIdRaw = formData.get("variant_id");
  const variantId = typeof variantIdRaw === "string" ? variantIdRaw.trim() : "";
  if (!variantId) return err("Something went wrong. Refresh the page.");

  const productIdRaw = formData.get("product_id");
  const productId = typeof productIdRaw === "string" ? productIdRaw.trim() : "";
  if (!productId) return err("Something went wrong. Refresh the page.");

  const change = parseIntBounded(formData.get("delta"), "Change", -1_000_000_000, 1_000_000_000);
  if (typeof change !== "number") return change;
  if (change === 0) return err("Enter an amount different from zero.");

  const reasonRaw = formData.get("reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!reason) return err("Add a short reason for this adjustment.");
  if (reason.length > 500)
    return err("Keep the reason under 500 characters.");

  const { data: pv } = await supabase
    .from("product_variants")
    .select("id, product_id")
    .eq("id", variantId)
    .eq("product_id", productId)
    .maybeSingle();

  if (!pv) return err("That item couldn’t be found.");

  const { data: rpcData, error: rpcErr } = await supabase.rpc("adjust_variant_stock", {
    p_variant_id: variantId,
    p_delta: change,
    p_reason: reason,
  });

  if (rpcErr) {
    const m = rpcErr.message?.toLowerCase() ?? "";
    if (m.includes("below zero")) return err("You can’t reduce stock below zero.");
    if (m.includes("not found")) return err("That item couldn’t be found.");
    if (m.includes("reason")) return err("Please add a reason.");
    return err("Something went wrong. Try again.");
  }

  void rpcData;

  revalidatePath("/dashboard/inventory");
  revalidatePath(`/dashboard/inventory/${productId}`);
  return ok({ message: "Stock updated." });
}

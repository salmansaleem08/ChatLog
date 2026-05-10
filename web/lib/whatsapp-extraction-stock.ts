import type { SupabaseClient } from "@supabase/supabase-js";

import { toNumber } from "@/lib/inventory/helpers";

export type ExtractionLineRow = {
  id: string;
  product_variant_id: string | null;
  unresolved: boolean;
  quantity: unknown;
  stock_units_applied: number | null;
};

/** Whole units to reserve for a catalogue-matched line (minimum 1). */
export function unitsReservedForQuantity(qty: unknown): number {
  const n = Math.ceil(toNumber(qty));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000_000_000);
}

/** Units to add back when removing a line (prefers stored applied amount). */
export function unitsToRestoreForLine(line: ExtractionLineRow): number {
  if (line.unresolved || !line.product_variant_id) return 0;
  if (line.stock_units_applied != null && line.stock_units_applied > 0) {
    return line.stock_units_applied;
  }
  return unitsReservedForQuantity(line.quantity);
}

function rpcMessage(err: { message?: string }): string {
  const m = (err.message ?? "").toLowerCase();
  if (m.includes("below zero") || m.includes("cannot go below")) {
    return "Not enough stock on hand for one or more matched items. Update quantities in your catalogue, then try again.";
  }
  if (m.includes("not found")) {
    return "A matched item is no longer in your catalogue. Refresh and try again.";
  }
  return "We couldn’t update inventory for this interpretation. Try again.";
}

const REASON_RESTORE = "Stock restored after removing an interpretation";
export const REASON_RESTORE_BEFORE_REPLACE =
  "Stock restored before replacing an interpretation";
const REASON_DEDUCT = "Reserved from an interpreted chat order";

async function rollbackDeducts(
  supabase: SupabaseClient,
  stack: { variantId: string; units: number }[]
) {
  for (const a of stack.reverse()) {
    await supabase.rpc("adjust_variant_stock", {
      p_variant_id: a.variantId,
      p_delta: a.units,
      p_reason: REASON_RESTORE,
    });
  }
}

/**
 * Adds stock back for each line (what was previously deducted).
 */
export async function restoreInventoryForExtractionLines(
  supabase: SupabaseClient,
  lines: ExtractionLineRow[],
  reason: string = REASON_RESTORE
): Promise<{ error: string | null }> {
  for (const line of lines) {
    const u = unitsToRestoreForLine(line);
    if (u <= 0 || !line.product_variant_id) continue;
    const { error } = await supabase.rpc("adjust_variant_stock", {
      p_variant_id: line.product_variant_id,
      p_delta: u,
      p_reason: reason,
    });
    if (error) {
      return { error: rpcMessage(error) };
    }
  }
  return { error: null };
}

/**
 * Subtracts stock for resolved lines; updates each row's stock_units_applied.
 */
export async function applyInventoryForInsertedLines(
  supabase: SupabaseClient,
  rows: {
    id: string;
    product_variant_id: string | null;
    unresolved: boolean;
    quantity: unknown;
  }[]
): Promise<{ error: string | null }> {
  const deducts: { variantId: string; units: number }[] = [];

  for (const row of rows) {
    if (row.unresolved || !row.product_variant_id) {
      const { error: upErr } = await supabase
        .from("whatsapp_extracted_order_lines")
        .update({ stock_units_applied: null })
        .eq("id", row.id);
      if (upErr) {
        await rollbackDeducts(supabase, deducts);
        return { error: "We couldn’t save inventory details. Try again." };
      }
      continue;
    }

    const units = unitsReservedForQuantity(row.quantity);
    const { error } = await supabase.rpc("adjust_variant_stock", {
      p_variant_id: row.product_variant_id,
      p_delta: -units,
      p_reason: REASON_DEDUCT,
    });

    if (error) {
      await rollbackDeducts(supabase, deducts);
      return { error: rpcMessage(error) };
    }

    deducts.push({ variantId: row.product_variant_id, units });

    const { error: upErr } = await supabase
      .from("whatsapp_extracted_order_lines")
      .update({ stock_units_applied: units })
      .eq("id", row.id);

    if (upErr) {
      await supabase.rpc("adjust_variant_stock", {
        p_variant_id: row.product_variant_id,
        p_delta: units,
        p_reason: REASON_RESTORE,
      });
      deducts.pop();
      await rollbackDeducts(supabase, deducts);
      return { error: "We couldn’t save inventory details. Try again." };
    }
  }

  return { error: null };
}

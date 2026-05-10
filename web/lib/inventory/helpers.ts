import type { VariantDraft } from "@/lib/inventory/types";

export function newClientKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

export function formatVariantSummary(attributes: Record<string, string>): string {
  const entries = Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "Standard";
  return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
}

export function variantDraftFromDb(row: {
  id: string;
  attributes: unknown;
  stock_quantity: number;
}): VariantDraft {
  const raw = row.attributes;
  const attrs =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const pairs: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    pairs.push({ key, value: String(value ?? "") });
  }
  pairs.sort((a, b) => a.key.localeCompare(b.key));
  return {
    clientKey: row.id,
    id: row.id,
    pairs: pairs.length > 0 ? pairs : [{ key: "", value: "" }],
    stock: row.stock_quantity,
  };
}

export function defaultVariantDraft(): VariantDraft {
  return {
    clientKey: newClientKey(),
    pairs: [{ key: "", value: "" }],
    stock: 0,
  };
}

/** Coerce Supabase numeric / string to number. */
export function toNumber(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string") {
    const x = Number.parseFloat(n);
    if (Number.isFinite(x)) return x;
  }
  return 0;
}

/** Row shape from Select with nested variants. */

export type ProductVariantRow = {
  id: string;
  attributes: Record<string, string>;
  stock_quantity: number;
  created_at: string;
  updated_at: string;
};

export type ProductRow = {
  id: string;
  business_id: string;
  name: string;
  category: string;
  cost_price: number;
  selling_price: number;
  description: string | null;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
};

/** Form / wire format for variant editor rows. */
export type VariantDraft = {
  clientKey: string;
  id?: string;
  pairs: { key: string; value: string }[];
  stock: number;
};

export type StockMoveRow = {
  id: string;
  variant_id: string;
  delta: number;
  reason: string;
  created_at: string;
};

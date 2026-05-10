import { InventoryProductForm } from "@/components/dashboard/inventory/inventory-product-form";

export default function NewInventoryProductPage() {
  return (
    <div className="mx-auto max-w-6xl pb-28">
      <div className="mb-10 border-b border-border pb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Add product
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          Describe what you sell, how it differs between variations, and what you
          have on hand — you can tune everything later from the detail page.
        </p>
      </div>
      <InventoryProductForm
        mode="new"
        initial={{
          name: "",
          category: "",
          cost_price: "",
          selling_price: "",
          description: "",
          low_stock_threshold: "5",
          variants: [],
        }}
      />
    </div>
  );
}

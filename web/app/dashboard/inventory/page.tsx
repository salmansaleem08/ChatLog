export default function InventoryPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Inventory
      </h1>
      <p className="max-w-2xl text-muted-foreground">
        Stock and variants will be driven by catalog and order data from your
        chats — not placeholder rows. This screen will populate after those
        features are implemented.
      </p>
      <p className="text-sm text-muted-foreground">No inventory records yet.</p>
    </div>
  );
}

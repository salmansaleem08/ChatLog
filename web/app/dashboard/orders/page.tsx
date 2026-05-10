export default function OrdersPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Orders
      </h1>
      <p className="max-w-2xl text-muted-foreground">
        Orders will appear here when they are extracted and confirmed from your
        WhatsApp conversations. There is no sample data — link WhatsApp in
        Settings, then use this view once the ingestion pipeline is active.
      </p>
      <p className="text-sm text-muted-foreground">No orders yet.</p>
    </div>
  );
}

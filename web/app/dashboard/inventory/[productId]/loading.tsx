export default function InventoryProductLoading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse space-y-10 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-8">
        <div className="space-y-3">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-9 w-64 max-w-full rounded-lg bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
        <div className="h-11 w-32 rounded-lg bg-muted" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="h-40 rounded-xl border border-border bg-card" />
        <div className="h-36 rounded-xl border border-border bg-card" />
      </div>
      <div className="space-y-4">
        <div className="h-8 w-40 rounded-lg bg-muted" />
        {[1, 2].map((k) => (
          <div
            key={k}
            className="h-48 rounded-xl border border-border bg-muted/30"
          />
        ))}
      </div>
    </div>
  );
}

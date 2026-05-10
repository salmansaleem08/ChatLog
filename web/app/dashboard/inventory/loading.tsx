export default function InventoryLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-muted" />
          <div className="h-4 w-full max-w-md rounded-md bg-muted" />
        </div>
        <div className="h-10 w-36 rounded-lg bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="h-5 w-3/5 rounded-md bg-muted" />
            <div className="mt-3 h-4 w-1/4 rounded-md bg-muted" />
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="h-14 rounded-lg bg-muted/80" />
              <div className="h-14 rounded-lg bg-muted/80" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

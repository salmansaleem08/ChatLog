export default function ChatsLoading() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse space-y-8 pb-20">
      <div className="space-y-3 border-b border-border pb-8">
        <div className="h-8 w-40 rounded-lg bg-muted sm:w-48" />
        <div className="h-4 w-full max-w-xl rounded-md bg-muted" />
      </div>
      <div className="h-11 w-full rounded-md bg-muted" />
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex justify-between gap-3">
            <div className="h-5 w-2/5 rounded bg-muted" />
            <div className="h-4 w-14 rounded bg-muted" />
          </div>
          <div className="mt-4 h-12 w-full rounded-md bg-muted/80" />
        </div>
      ))}
    </div>
  );
}

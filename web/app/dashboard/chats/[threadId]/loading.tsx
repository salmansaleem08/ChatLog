export default function ChatThreadLoading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse space-y-8 pb-24">
      <div className="space-y-3 border-b border-border pb-8">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-9 w-2/3 max-w-md rounded-lg bg-muted" />
        <div className="h-4 w-48 rounded bg-muted" />
      </div>
      <div className="h-48 rounded-xl border border-border bg-muted/30" />
    </div>
  );
}

export default function CustomersPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Customers
      </h1>
      <p className="max-w-2xl text-muted-foreground">
        Customer profiles will be built from people who message your linked
        WhatsApp number. No dummy contacts will be shown.
      </p>
      <p className="text-sm text-muted-foreground">No customers yet.</p>
    </div>
  );
}

import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        ChatLog is under active development. Formal terms will be published here
        before general availability. For now, use the product only with test or
        non-production data unless you have a separate agreement with us.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}

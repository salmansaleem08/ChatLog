import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        We take messaging and business data seriously. A full privacy policy will
        be published here describing what we collect, how WhatsApp-linked data is
        processed, retention, and your rights. Until then, contact the team if you
        need details for a pilot or evaluation.
      </p>
      <p className="mt-6 text-sm">
        <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}

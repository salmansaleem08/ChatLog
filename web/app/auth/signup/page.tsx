import { redirect } from "next/navigation";

import { SignUpView } from "@/components/auth/signup-view";

/** If the form fell back to GET, credentials can appear in the query string — strip them. */
const SENSITIVE_PARAM = new Set([
  "password",
  "email",
  "business-name",
  "business_name",
]);

export default function SignUpPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const leaked = Object.keys(searchParams).some((k) =>
    SENSITIVE_PARAM.has(k.toLowerCase())
  );
  if (leaked) {
    redirect("/auth/signup");
  }

  return <SignUpView />;
}

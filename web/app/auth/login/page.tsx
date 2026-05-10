import { redirect } from "next/navigation";

import { LoginView } from "@/components/auth/login-view";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const leaked = Object.keys(searchParams).some((k) =>
    ["password", "email"].includes(k.toLowerCase())
  );
  if (leaked) {
    const sp = new URLSearchParams();
    const next = searchParams.next;
    if (typeof next === "string" && next.startsWith("/")) {
      sp.set("next", next);
    }
    const q = sp.toString();
    redirect(q ? `/auth/login?${q}` : "/auth/login");
  }

  const nextPath =
    typeof searchParams.next === "string" && searchParams.next.startsWith("/")
      ? searchParams.next
      : "/dashboard";

  return <LoginView nextPath={nextPath} />;
}

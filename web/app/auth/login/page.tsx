import { LoginView } from "@/components/auth/login-view";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const nextPath =
    typeof searchParams.next === "string" && searchParams.next.startsWith("/")
      ? searchParams.next
      : "/dashboard";

  return <LoginView nextPath={nextPath} />;
}

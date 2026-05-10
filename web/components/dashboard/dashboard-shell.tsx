"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/chats", label: "Chats" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/inventory", label: "Inventory" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

export function DashboardShell({
  businessName,
  email,
  children,
}: {
  businessName: string;
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-card/85 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-3 px-4 py-3 sm:px-5 md:h-16 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4 md:py-0">
          <div className="flex items-center justify-between md:justify-start">
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 rounded-lg outline-none ring-ring focus-visible:ring-2"
            >
              <Image
                src="/logo.png"
                alt=""
                width={30}
                height={30}
                className="size-7 object-contain sm:size-8"
              />
              <span className="text-sm font-semibold tracking-tight text-foreground">
                ChatLog
              </span>
            </Link>
            <div className="flex items-center gap-0.5 md:hidden">
              <ThemeToggle />
              <SignOutButton
                variant="outline"
                className="h-8 border-border/80 px-2.5 text-xs"
              />
            </div>
          </div>

          <nav
            className="flex items-center justify-center gap-0.5 overflow-x-auto scrollbar-none sm:gap-1"
            aria-label="Main"
          >
            {nav.map(({ href, label }) => {
              const active =
                href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium tracking-wide transition-colors sm:px-4 sm:text-sm",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center justify-end gap-2 md:flex">
            <div className="mr-1 hidden min-w-0 max-w-[200px] text-right lg:block">
              <p className="truncate text-sm font-medium text-foreground">
                {businessName}
              </p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <ThemeToggle />
            <SignOutButton
              variant="outline"
              className="h-9 shrink-0 border-border/80 px-3 text-sm"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

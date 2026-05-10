"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";

import { SignOutButton } from "@/components/dashboard/sign-out-button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingCart },
  { href: "/dashboard/inventory", label: "Inventory", icon: Package },
  { href: "/dashboard/customers", label: "Customers", icon: Users },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
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
      <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-lg supports-[backdrop-filter]:bg-card/80">
        <div className="flex min-h-14 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-0">
          <div className="flex items-center justify-between gap-2 sm:contents">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2 rounded-md outline-none ring-ring focus-visible:ring-2"
            >
              <Image
                src="/logo.png"
                alt=""
                width={28}
                height={28}
                className="size-7 object-contain opacity-95 sm:size-8"
              />
              <span className="text-sm font-semibold tracking-tight">
                ChatLog
              </span>
            </Link>
            <div className="flex items-center gap-1 sm:hidden">
              <span className="max-w-[100px] truncate text-xs text-muted-foreground">
                {businessName}
              </span>
              <SignOutButton
                variant="outline"
                className="h-8 shrink-0 px-2.5 text-xs font-medium"
              />
            </div>
          </div>

          <nav
            className="-mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1 scrollbar-none sm:mx-0 sm:px-0"
            aria-label="Main"
          >
            {nav.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-3 sm:text-sm",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  )}
                >
                  <Icon
                    className="size-3.5 shrink-0 sm:size-4"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="whitespace-nowrap">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="hidden min-w-0 items-center gap-2 sm:flex sm:shrink-0">
            <div className="hidden min-w-0 text-right md:block">
              <p className="truncate text-sm font-medium text-foreground">
                {businessName}
              </p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <SignOutButton
              variant="outline"
              className="h-9 shrink-0 px-3 text-sm font-medium"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

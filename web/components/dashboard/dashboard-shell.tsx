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

import { MobileTabBar } from "@/components/dashboard/mobile-tab-bar";
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
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:bg-secondary lg:text-secondary-foreground">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-secondary-foreground/10 px-4">
          <Image
            src="/logo.png"
            alt=""
            width={32}
            height={32}
            className="size-8 object-contain opacity-95"
          />
          <span className="text-sm font-semibold tracking-tight">ChatLog</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4" aria-label="Main">
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
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary-foreground/10 text-secondary-foreground"
                    : "text-secondary-foreground/65 hover:bg-secondary-foreground/5 hover:text-secondary-foreground"
                )}
              >
                <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 border-t border-secondary-foreground/10 p-4">
          <p className="truncate text-sm font-medium text-secondary-foreground">
            {businessName}
          </p>
          <p className="mt-0.5 truncate text-xs text-secondary-foreground/55">
            {email}
          </p>
          <SignOutButton
            variant="ghost"
            className="mt-3 h-9 w-full justify-start px-2 text-secondary-foreground hover:bg-secondary-foreground/10 hover:text-secondary-foreground"
          />
        </div>
      </aside>

      <div className="lg:pl-64">
        <main className="min-h-screen p-5 pb-24 sm:p-8 lg:pb-8">{children}</main>
      </div>

      <MobileTabBar />
    </div>
  );
}

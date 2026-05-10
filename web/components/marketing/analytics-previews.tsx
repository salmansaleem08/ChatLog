/**
 * Decorative analytics visuals — sample data only, theme-aware via currentColor.
 */

import { cn } from "@/lib/utils";

export function LandingAnalyticsShowcase() {
  return (
    <section
      className="mx-auto max-w-6xl px-4 py-16 sm:px-6"
      aria-labelledby="analytics-preview-heading"
    >
      <div className="mb-10 text-center md:text-left">
        <h2
          id="analytics-preview-heading"
          className="text-3xl font-bold tracking-tight"
        >
          Your numbers, at a glance
        </h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Sample dashboard views — revenue, orders, and fulfillment trends update
          automatically as chats become real orders.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Net revenue
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                PKR 1.24M
              </p>
            </div>
            <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              +18% vs last month
            </span>
          </div>
          <RevenueAreaChart
            className="mt-6 h-32 w-full text-primary"
            gradientId="land-revenue-fill"
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Last 12 weeks · dummy preview
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Orders by week
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                847
              </p>
            </div>
            <span className="rounded-full bg-chart-3/25 px-3 py-1 text-xs font-semibold text-chart-4">
              Peak: Fri
            </span>
          </div>
          <OrdersBarChart className="mt-6 h-32 w-full text-primary" />
          <p className="mt-3 text-xs text-muted-foreground">
            Daily volume · dummy preview
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm lg:col-span-2">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Order pipeline
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">
                Status mix · this week
              </p>
            </div>
            <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row sm:justify-end">
              <PipelineDonut className="h-36 w-36 shrink-0 text-primary" />
              <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:text-left">
                <li className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-primary" />
                  <span className="text-muted-foreground">Confirmed</span>
                  <span className="font-medium tabular-nums text-foreground">
                    42%
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-chart-2" />
                  <span className="text-muted-foreground">Dispatched</span>
                  <span className="font-medium tabular-nums text-foreground">
                    31%
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-chart-4" />
                  <span className="text-muted-foreground">Delivered</span>
                  <span className="font-medium tabular-nums text-foreground">
                    22%
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-muted-foreground/50" />
                  <span className="text-muted-foreground">Returned</span>
                  <span className="font-medium tabular-nums text-foreground">
                    5%
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RevenueAreaChart({
  className,
  gradientId,
}: {
  className?: string;
  gradientId: string;
}) {
  return (
    <svg
      viewBox="0 0 320 120"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path
        d="M0 95 L28 88 L56 92 L84 72 L112 78 L140 55 L168 62 L196 38 L224 48 L252 28 L280 35 L308 22 L320 18 V120 H0 Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M0 95 L28 88 L56 92 L84 72 L112 78 L140 55 L168 62 L196 38 L224 48 L252 28 L280 35 L308 22 L320 18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function OrdersBarChart({ className }: { className?: string }) {
  const heights = [40, 55, 48, 72, 65, 90, 78];
  return (
    <svg
      viewBox="0 0 320 120"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {heights.map((barH, i) => (
        <rect
          key={i}
          x={18 + i * 42}
          y={110 - barH}
          width="28"
          height={barH}
          rx="4"
          fill="currentColor"
          className={i === 5 ? "opacity-100" : "opacity-55"}
        />
      ))}
    </svg>
  );
}

function PipelineDonut({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="currentColor"
        strokeWidth="20"
        strokeDasharray="105 251"
        strokeDashoffset="0"
        className="opacity-90"
      />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth="20"
        strokeDasharray="78 251"
        strokeDashoffset="-105"
        opacity={0.9}
      />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="var(--chart-4)"
        strokeWidth="20"
        strokeDasharray="55 251"
        strokeDashoffset="-183"
        opacity={0.9}
      />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="20"
        strokeDasharray="13 251"
        strokeDashoffset="-238"
        className="opacity-50"
      />
    </svg>
  );
}

/**
 * Single floating “dashboard” card on auth brand panels — reads clearly on ink blue.
 */
export function AuthDashboardPreview({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "mt-8 w-full max-w-md rounded-2xl border border-white/20 bg-background text-card-foreground shadow-[0_24px_60px_-16px_rgba(0,0,0,0.45)] ring-1 ring-black/5 backdrop-blur-md dark:border-white/10 dark:bg-card dark:shadow-[0_24px_60px_-16px_rgba(0,0,0,0.65)]",
        compact ? "p-4" : "p-5 sm:p-6"
      )}
      aria-hidden
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sample dashboard
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums tracking-tight text-foreground sm:text-2xl">
            PKR 386k
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">
              this week
            </span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
          +12%
        </span>
      </div>

      <RevenueAreaChart
        className={compact ? "mt-3 h-24 w-full text-primary" : "mt-4 h-28 w-full text-primary"}
        gradientId="auth-revenue-fill"
      />

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4 sm:gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Orders
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground sm:text-base">
            142
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Avg. ticket
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground sm:text-base">
            2.7k
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Fulfilled
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-chart-2 sm:text-base">
            94%
          </p>
        </div>
      </div>
    </div>
  );
}

export function MiniSparkline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 48" fill="none" className={className}>
      <path
        d="M4 38 L22 32 L40 35 L58 22 L76 26 L94 12 L112 16 L116 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 38 L22 32 L40 35 L58 22 L76 26 L94 12 L112 16 L116 8 V48 H4 Z"
        fill="currentColor"
        fillOpacity={0.12}
      />
    </svg>
  );
}

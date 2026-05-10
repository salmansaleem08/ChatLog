/**
 * Decorative analytics visuals — sample data only, theme-aware via currentColor.
 */

export function LandingAnalyticsShowcase() {
  return (
    <section
      className="border-b border-border/60"
      aria-labelledby="analytics-preview-heading"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="max-w-2xl">
          <h2
            id="analytics-preview-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Numbers that stay honest
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Illustrative views — your real dashboards fill in as orders flow from
            chat into the system.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-7 lg:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Net revenue
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  PKR 1.24M
                </p>
              </div>
              <span className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground">
                +18% vs prior month
              </span>
            </div>
            <RevenueAreaChart
              className="mt-8 h-36 w-full text-primary"
              gradientId="land-revenue-fill"
            />
            <p className="mt-4 text-xs text-muted-foreground">
              Last twelve weeks · sample
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-7 lg:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Orders by day
                </p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  847
                </p>
              </div>
              <span className="rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground">
                Peak · Friday
              </span>
            </div>
            <OrdersBarChart className="mt-8 h-36 w-full text-primary" />
            <p className="mt-4 text-xs text-muted-foreground">
              Rolling week · sample
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-7 lg:col-span-2 lg:flex lg:items-center lg:gap-16 lg:p-10">
            <div className="max-w-sm shrink-0">
              <p className="text-sm font-medium text-muted-foreground">
                Pipeline
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                Status mix · sample week
              </p>
            </div>
            <div className="mt-10 flex flex-1 flex-col items-center gap-8 sm:flex-row sm:justify-between lg:mt-0">
              <PipelineDonut className="h-40 w-40 shrink-0 text-primary" />
              <ul className="grid w-full max-w-sm grid-cols-2 gap-x-10 gap-y-3 text-sm sm:text-left">
                <li className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-primary" />
                  <span className="text-muted-foreground">Confirmed</span>
                  <span className="ml-auto font-medium tabular-nums text-foreground">
                    42%
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-chart-2" />
                  <span className="text-muted-foreground">Dispatched</span>
                  <span className="ml-auto font-medium tabular-nums text-foreground">
                    31%
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-chart-4" />
                  <span className="text-muted-foreground">Delivered</span>
                  <span className="ml-auto font-medium tabular-nums text-foreground">
                    22%
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full bg-muted-foreground/45" />
                  <span className="text-muted-foreground">Returned</span>
                  <span className="ml-auto font-medium tabular-nums text-foreground">
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
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
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
        strokeWidth="2"
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
          className={i === 5 ? "opacity-100" : "opacity-45"}
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
        className="opacity-45"
      />
    </svg>
  );
}

import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const kpis = [
  {
    label: "Orders (30d)",
    value: "1,284",
    trend: "+4.2% vs prior period",
    emphasis: "up" as const,
  },
  {
    label: "Revenue (30d)",
    value: "PKR 2.4M",
    trend: "+8.1% vs prior period",
    emphasis: "up" as const,
  },
  {
    label: "Pending fulfillment",
    value: "23",
    trend: "2 fewer than last week",
    emphasis: "neutral" as const,
  },
  {
    label: "Return rate",
    value: "2.1%",
    trend: "0.4 pts lower than last month",
    emphasis: "neutral" as const,
  },
] as const;

const recentOrders = [
  {
    id: "CHK-2041",
    customer: "Ayesha Khan",
    amount: "PKR 18,200",
    status: "confirmed" as const,
    when: "8 min ago",
  },
  {
    id: "CHK-2040",
    customer: "Omar Traders",
    amount: "PKR 6,450",
    status: "dispatched" as const,
    when: "32 min ago",
  },
  {
    id: "CHK-2039",
    customer: "S. Rahman",
    amount: "PKR 2,100",
    status: "pending" as const,
    when: "1 hr ago",
  },
  {
    id: "CHK-2038",
    customer: "Noor Fabrics",
    amount: "PKR 44,000",
    status: "delivered" as const,
    when: "Yesterday",
  },
  {
    id: "CHK-2037",
    customer: "H. Al-Mansoori",
    amount: "PKR 9,880",
    status: "returned" as const,
    when: "Yesterday",
  },
] as const;

function statusBadge(status: (typeof recentOrders)[number]["status"]) {
  switch (status) {
    case "confirmed":
      return <Badge variant="default">Confirmed</Badge>;
    case "dispatched":
      return <Badge variant="outline">Dispatched</Badge>;
    case "pending":
      return <Badge variant="muted">Pending</Badge>;
    case "delivered":
      return <Badge variant="outline">Delivered</Badge>;
    case "returned":
      return (
        <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
          Returned
        </Badge>
      );
    default:
      return <Badge variant="muted">{status}</Badge>;
  }
}

function TrendLine({
  text,
  emphasis,
}: {
  text: string;
  emphasis: "up" | "neutral";
}) {
  if (emphasis === "up") {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary">
        <ArrowUpRight className="size-3" aria-hidden />
        {text}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

function OrdersSparkline() {
  const points = [
    12, 18, 15, 22, 28, 24, 31, 29, 35, 38, 34, 41, 39, 45, 48, 44, 52, 49, 55,
    58, 54, 61, 59, 64, 62, 68, 71, 67, 73, 76,
  ];
  const w = 320;
  const h = 120;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const pad = 8;
  const path = points
    .map((v, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L ${w - pad} ${h - pad} L ${pad} ${h - pad} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-44 w-full text-primary"
      aria-hidden
    >
      <defs>
        <linearGradient id="dashSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#dashSpark)" />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OverviewPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Overview
        </h1>
        <p className="mt-1 text-muted-foreground">
          Sample data — your live metrics will appear here as orders sync.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm"
          >
            <p className="text-sm font-medium text-muted-foreground">{k.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
              {k.value}
            </p>
            <div className="mt-2">
              <TrendLine text={k.trend} emphasis={k.emphasis} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Orders · last 30 days
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Daily count (illustrative)
              </p>
            </div>
          </div>
          <div className="mt-4">
            <OrdersSparkline />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight">Recent orders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Latest activity (sample)
          </p>
          <ul className="mt-5 divide-y divide-border">
            {recentOrders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {o.customer}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {o.id} · {o.when}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {o.amount}
                  </span>
                  {statusBadge(o.status)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Top product</p>
          <p className="mt-2 text-lg font-semibold">Embroidered kurta · M</p>
          <p className="mt-1 text-sm text-muted-foreground">312 units (30d)</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            Total customers
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums">892</p>
          <p className="mt-1 text-sm text-muted-foreground">+6% vs prior month</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            Avg. order value
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums">PKR 3,720</p>
          <p className="mt-1 text-sm text-muted-foreground">After returns</p>
        </div>
      </div>
    </div>
  );
}

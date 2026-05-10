import Image from "next/image";
import { Check } from "lucide-react";

export function AuthBrandAside() {
  return (
    <div className="relative hidden min-h-[50vh] flex-col justify-between overflow-hidden bg-secondary p-8 text-secondary-foreground lg:flex lg:min-h-0 lg:h-full lg:p-10">
      <div
        className="pointer-events-none absolute -left-24 -top-24 rounded-full bg-primary opacity-10 blur-3xl"
        style={{ width: 480, height: 480 }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-24 rounded-full bg-sky-300/30 opacity-40 blur-3xl dark:bg-sky-400/20"
        style={{ width: 560, height: 560 }}
        aria-hidden
      />

      <div className="relative z-10">
        <Image
          src="/logo.png"
          alt="ChatLog"
          width={40}
          height={40}
          className="h-10 w-auto rounded-md object-contain"
          priority
        />
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center py-12">
        <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight text-gradient-hero">
          Your WhatsApp orders, finally organized.
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-secondary-foreground/85">
          After you sign up, you connect your selling inbox and watch orders
          appear as clean rows instead of buried threads. Inventory, delivery
          statuses, and profit stay in one dashboard you can trust.
        </p>
        <ul className="mt-8 space-y-3">
          {[
            "AI-powered order extraction",
            "Real-time inventory tracking",
            "Automated customer updates",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm font-medium">
              <Check
                className="size-4 shrink-0 text-primary"
                strokeWidth={2.5}
                aria-hidden
              />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 text-xs text-secondary-foreground/70">
        Already used by 500+ sellers
      </p>
    </div>
  );
}

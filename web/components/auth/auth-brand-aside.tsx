import Image from "next/image";
import { Check } from "lucide-react";

const benefits = [
  "Orders extracted from chat — names, SKUs, variants, totals",
  "Inventory and profit that stay accurate without spreadsheets",
  "Customer updates sent when every order moves forward",
] as const;

export function AuthBrandAside() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-secondary px-10 py-12 text-secondary-foreground lg:flex lg:h-full lg:min-h-0 lg:px-14 lg:py-16">
      <div
        className="pointer-events-none absolute -left-32 top-1/2 h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-primary/8 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-24 -right-24 h-[380px] w-[380px] rounded-full bg-primary/6 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10">
        <Image
          src="/logo.png"
          alt="ChatLog"
          width={44}
          height={44}
          className="h-11 w-auto object-contain opacity-95"
          priority
        />
      </div>

      <div className="relative z-10 my-auto flex flex-col justify-center py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-secondary-foreground/55">
          ChatLog
        </p>
        <h1 className="mt-5 max-w-xl text-balance text-4xl font-semibold leading-[1.12] tracking-[-0.03em] text-secondary-foreground lg:text-5xl lg:leading-[1.1]">
          Run your WhatsApp store like it is a real operation — not a chat folder.
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-secondary-foreground/80 lg:text-xl">
          Stop losing revenue in unread threads. One workspace turns messages into
          orders you can fulfill, measure, and stand behind.
        </p>
        <ul className="mt-10 space-y-5">
          {benefits.map((item) => (
            <li
              key={item}
              className="flex gap-3 text-base font-medium leading-snug text-secondary-foreground/95"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 text-sm font-medium text-secondary-foreground/50">
        Trusted by teams selling across Pakistan, the Gulf, and beyond.
      </p>
    </div>
  );
}

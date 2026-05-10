import * as React from "react";

import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "muted";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        variant === "default" &&
          "border-transparent bg-primary/15 text-primary",
        variant === "secondary" &&
          "border-transparent bg-secondary-foreground/10 text-secondary-foreground",
        variant === "outline" && "border-border text-foreground",
        variant === "muted" &&
          "border-transparent bg-muted text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export { Badge };

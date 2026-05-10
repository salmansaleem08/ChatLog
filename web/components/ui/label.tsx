import * as React from "react";

import { cn } from "@/lib/utils";

const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentProps<"label">
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "flex select-none items-center gap-2 text-sm font-medium leading-none peer-disabled:pointer-events-none peer-disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };

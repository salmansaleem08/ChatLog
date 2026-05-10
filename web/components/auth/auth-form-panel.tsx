"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function AuthFormPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <div
      className={cn(
        "transition-opacity duration-500 ease-out",
        visible ? "opacity-100" : "opacity-0",
        className
      )}
    >
      {children}
    </div>
  );
}

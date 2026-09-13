"use client";
import { useEffect, useState } from "react";
import { fmtRelative } from "@/lib/format";

/* Relative timestamps depend on "now", which differs between the server render
   and client hydration a few seconds later — a classic hydration mismatch.
   This isolates that: suppressHydrationWarning covers the initial diff, then it
   ticks live so "12s ago" stays honest. */
export function RelativeTime({
  epochMs,
  prefix,
  className,
}: {
  epochMs: number;
  prefix?: string;
  className?: string;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span suppressHydrationWarning className={className}>
      {prefix}
      {fmtRelative(epochMs)}
    </span>
  );
}

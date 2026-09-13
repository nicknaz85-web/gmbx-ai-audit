"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/* Derives US market session from the clock (NYSE hours in ET, approximated via
   UTC). Purely presentational — a live feed would drive this in production. */
function session(now: Date): { label: string; dot: string } {
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const t = utcH * 60 + utcM;
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return { label: "Closed · Weekend", dot: "bg-faint" };
  // Regular session ~13:30–20:00 UTC; pre 08:00–13:30; post 20:00–24:00
  if (t >= 13 * 60 + 30 && t < 20 * 60) return { label: "Market Open", dot: "bg-pos" };
  if (t >= 8 * 60 && t < 13 * 60 + 30) return { label: "Pre-Market", dot: "bg-warn" };
  if (t >= 20 * 60 || t < 8 * 60) return { label: "After Hours", dot: "bg-warn" };
  return { label: "Market Closed", dot: "bg-faint" };
}

export function MarketStatus() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="h-2 w-2" />;
  const s = session(now);
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      <span className="hidden text-muted lg:inline">{s.label}</span>
      <span className="tnum hidden text-faint xl:inline">{time} ET</span>
    </span>
  );
}

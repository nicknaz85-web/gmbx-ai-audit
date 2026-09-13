import { cn } from "@/lib/cn";
import type { Confidence, DataCoverage, RiskLevel } from "@/types";
import type { ReactNode } from "react";

/* Small shared primitives: badges, disclaimers, tooltips, timestamps. */

export function Disclaimer({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-faint", className)}>
      {children ??
        "AI-generated scenario analysis based on historical and currently available financial information. It is not financial advice and actual outcomes may differ materially."}
    </p>
  );
}

export function Timestamp({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[11px] text-faint tnum">
      {label} <span className="text-muted">{value}</span>
    </span>
  );
}

const RISK_CLS: Record<RiskLevel, string> = {
  Low: "text-pos border-pos/25 bg-pos/10",
  Medium: "text-warn border-warn/25 bg-warn/10",
  High: "text-neg border-neg/25 bg-neg/10",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={cn("inline-flex h-[19px] items-center rounded border px-1.5 text-[11px] font-medium", RISK_CLS[level])}>
      {level}
    </span>
  );
}

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const cls = level === "High" ? "text-pos" : level === "Low" ? "text-neg" : "text-warn";
  const dots = level === "High" ? 3 : level === "Moderate" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <span className="inline-flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("h-2.5 w-[3px] rounded-full", i < dots ? cls.replace("text-", "bg-") : "bg-line-2")} />
        ))}
      </span>
      <span className={cls}>{level}</span>
    </span>
  );
}

export function CoverageBadge({ level }: { level: DataCoverage }) {
  const cls = level === "High" ? "text-pos border-pos/25" : level === "Limited" ? "text-warn border-warn/25" : "text-muted border-line-2";
  return (
    <span className={cn("chip !h-[19px]", cls)} title="How much underlying data was available to build this forecast">
      {level} data coverage
    </span>
  );
}

export function Citation({ label }: { label: string }) {
  return (
    <span className="inline-flex h-[17px] items-center rounded border border-line-2 bg-surface-2 px-1.5 text-[10px] font-medium tracking-wide text-muted">
      {label}
    </span>
  );
}

/* CSS-only tooltip for metric definitions. */
export function Info({ tip }: { tip: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-line-2 text-[9px] leading-none text-faint">
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-52 -translate-x-1/2 rounded-md border border-line-2 bg-surface-3 px-2.5 py-1.5 text-[11px] leading-snug text-muted opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
        {tip}
      </span>
    </span>
  );
}

import { cn } from "@/lib/cn";
import { fmtPct, fmtPrice } from "@/lib/format";

/* Directional value display. Colour carries the sign; an optional hairline
   caret adds emphasis in dense tables without resorting to cartoon arrows. */
export function Delta({
  value,
  pct,
  showAbs = false,
  caret = false,
  className,
  size = "sm",
}: {
  value: number | null | undefined;
  pct?: number | null;
  showAbs?: boolean;
  caret?: boolean;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const v = pct != null ? pct : value;
  const up = (v ?? 0) > 0;
  const flat = v == null || v === 0;
  const color = flat ? "text-muted" : up ? "text-pos" : "text-neg";
  const sizeCls = { xs: "text-[11px]", sm: "text-[13px]", md: "text-sm", lg: "text-base" }[size];

  return (
    <span className={cn("tnum inline-flex items-center gap-1 font-medium", color, sizeCls, className)}>
      {caret && !flat && <span className="text-[0.7em] leading-none">{up ? "▲" : "▼"}</span>}
      <span>
        {showAbs && value != null && (
          <>
            {up ? "+" : value < 0 ? "−" : ""}
            {fmtPrice(Math.abs(value))}
            {pct != null ? " " : ""}
          </>
        )}
        {pct != null && (
          <>
            {showAbs ? "(" : ""}
            {up ? "+" : ""}
            {fmtPct(pct, 2)}
            {showAbs ? ")" : ""}
          </>
        )}
      </span>
    </span>
  );
}

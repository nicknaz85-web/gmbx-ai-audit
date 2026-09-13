import { cn } from "@/lib/cn";

/* A deterministic monogram tile used in place of third-party logos in dev.
   Restrained: a muted brand-ish background with the ticker's leading letters.
   In production this is where a real logo <img> would render. */
export function Monogram({
  ticker,
  bg,
  size = 28,
  className,
}: {
  ticker: string;
  bg: string;
  size?: number;
  className?: string;
}) {
  const letters = ticker.slice(0, 2);
  return (
    <span
      className={cn("inline-flex items-center justify-center font-semibold text-text/90 shrink-0", className)}
      style={{
        width: size,
        height: size,
        background: bg,
        borderRadius: Math.max(5, size * 0.22),
        fontSize: size * 0.42,
        letterSpacing: "-0.02em",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
      aria-hidden
    >
      {letters}
    </span>
  );
}

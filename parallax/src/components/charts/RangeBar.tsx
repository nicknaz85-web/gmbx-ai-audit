import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

/* Horizontal Bear — Current — Base — Bull scenario range.
   Dots sit at true value positions on the track (so spacing is meaningful),
   while the numeric labels live in an evenly-spaced legend row beneath — this
   decouples label layout from value position, so labels can never overlap even
   when scenarios cluster tightly (e.g. low-volatility names). */
export function RangeBar({
  current,
  bear,
  base,
  bull,
}: {
  current: number;
  bear: number;
  base: number;
  bull: number;
}) {
  const lo = Math.min(bear, current);
  const hi = Math.max(bull, current);
  const pad = (hi - lo) * 0.06 || 1;
  const L = lo - pad;
  const H = hi + pad;
  const span = H - L || 1;
  const pos = (v: number) => ((v - L) / span) * 100;

  const markers = [
    { key: "bear", label: "Bear", value: bear, color: "var(--color-neg)", dot: "bg-neg" },
    { key: "current", label: "Current", value: current, color: "var(--color-text)", dot: "bg-text" },
    { key: "base", label: "Base", value: base, color: "var(--color-accent)", dot: "bg-accent" },
    { key: "bull", label: "Bull", value: bull, color: "var(--color-pos)", dot: "bg-pos" },
  ].sort((a, b) => a.value - b.value);

  return (
    <div className="px-1 pb-2 pt-3">
      {/* Track with true-position dots */}
      <div
        className="relative h-2 rounded-full"
        style={{ background: "linear-gradient(90deg, var(--color-neg-soft), var(--color-surface-3) 45%, var(--color-surface-3) 55%, var(--color-pos-soft))" }}
      >
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${pos(bear)}%`,
            width: `${pos(bull) - pos(bear)}%`,
            background: "linear-gradient(90deg, var(--color-neg), var(--color-accent) 55%, var(--color-pos))",
            opacity: 0.28,
          }}
        />
        {markers.map((m) => (
          <div
            key={m.key}
            className={cn("absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg", m.dot)}
            style={{ left: `${pos(m.value)}%` }}
            title={`${m.label}: $${fmtPrice(m.value)}`}
          />
        ))}
      </div>

      {/* Evenly-spaced legend — guaranteed no overlap */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {markers.map((m) => (
          <div key={m.key} className="min-w-0 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", m.dot)} />
              <span className="truncate text-[10px] font-semibold uppercase tracking-wide" style={{ color: m.color }}>{m.label}</span>
            </div>
            <div className="tnum mt-0.5 text-[14px] font-semibold leading-tight">${fmtPrice(m.value)}</div>
            {m.key !== "current" ? (
              <div className={cn("tnum text-[11px]", m.value >= current ? "text-pos" : "text-neg")}>
                {m.value >= current ? "+" : ""}{fmtPct(((m.value - current) / current) * 100, 0)}
              </div>
            ) : (
              <div className="text-[11px] text-faint">today</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

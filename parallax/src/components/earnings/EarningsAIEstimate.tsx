import type { EarningsForecast } from "@/types";
import { Disclaimer } from "@/components/common/bits";
import { fmtPrice, fmtPct, fmtMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/cn";

export function EarningsAIEstimate({ f }: { f: EarningsForecast }) {
  return (
    <div className="p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Estimate comparison */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Next-Quarter Estimate · {f.fiscalPeriod}</div>
          <table className="w-full text-[13px]">
            <tbody>
              <Compare label="EPS — Street" value={f.streetEps != null ? `$${fmtPrice(f.streetEps)}` : "—"} />
              <Compare label="EPS — Parallax AI" value={`$${fmtPrice(f.aiEps)}`} highlight sub={`range $${fmtPrice(f.aiEpsLow)} – $${fmtPrice(f.aiEpsHigh)}`} />
              <Compare label="Revenue — Street" value={f.streetRevenue != null ? fmtMoneyCompact(f.streetRevenue) : "—"} />
              <Compare label="Revenue — Parallax AI" value={fmtMoneyCompact(f.aiRevenue)} highlight />
            </tbody>
          </table>
        </div>

        {/* Probabilities */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Scenario Probabilities</div>
          <ProbBar label="Beat" pct={f.beatProb} tone="pos" />
          <ProbBar label="In line" pct={f.inlineProb} tone="muted" />
          <ProbBar label="Miss" pct={f.missProb} tone="neg" />
          <p className="mt-2 text-[11px] text-faint">Model-generated estimates, not predictions of a specific result.</p>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Key factors</div>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {f.factors.map((x, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" />
              {x}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Possible post-earnings reaction</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {f.reactions.map((r) => {
            const neg = r.high <= 0;
            const tone = neg ? "neg" : r.low < 0 ? "warn" : "pos";
            return (
              <div key={r.scenario} className="rounded-md border border-line bg-surface-2 p-3">
                <div className="text-[12px] font-medium">{r.scenario}</div>
                <div className={cn("tnum mt-1 text-[15px] font-semibold", tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-warn")}>
                  {r.low >= 0 ? "+" : ""}{r.low}% to {r.high >= 0 ? "+" : ""}{r.high}%
                </div>
                <div className="mt-0.5 text-[11px] text-faint">{r.note}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-faint">Reaction ranges are estimated from historical volatility and typical earnings gaps. They are scenarios, not predictions or guarantees.</p>
      </div>

      <div className="mt-3">
        <Disclaimer />
      </div>
    </div>
  );
}

function Compare({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 text-muted">{label}</td>
      <td className="py-2 text-right">
        <span className={cn("tnum font-semibold", highlight && "text-accent")}>{value}</span>
        {sub && <div className="tnum text-[11px] text-faint">{sub}</div>}
      </td>
    </tr>
  );
}

function ProbBar({ label, pct, tone }: { label: string; pct: number; tone: "pos" | "neg" | "muted" }) {
  const color = tone === "pos" ? "bg-pos" : tone === "neg" ? "bg-neg" : "bg-faint";
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="tnum font-medium">{fmtPct(pct * 100, 0)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

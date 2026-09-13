import type { AnalystConsensus, AnalystAction } from "@/types";
import { EmptyState } from "@/components/common/Panel";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

const DIST: { key: keyof AnalystConsensus["distribution"]; label: string; color: string }[] = [
  { key: "strongBuy", label: "Strong Buy", color: "bg-pos" },
  { key: "buy", label: "Buy", color: "bg-pos/60" },
  { key: "hold", label: "Hold", color: "bg-faint" },
  { key: "sell", label: "Sell", color: "bg-neg/60" },
  { key: "strongSell", label: "Strong Sell", color: "bg-neg" },
];

export function AnalystPanel({
  data,
  price,
}: {
  data: { consensus: AnalystConsensus; actions: AnalystAction[] } | null;
  price: number;
}) {
  if (!data) {
    return <EmptyState title="No analyst estimates available" hint="This company currently has no sell-side coverage. Forecasts for uncovered names carry higher uncertainty." />;
  }
  const c = data.consensus;
  const total = Object.values(c.distribution).reduce((a, b) => a + b, 0);
  const upside = ((c.priceTargetAvg - price) / price) * 100;

  return (
    <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:divide-x md:divide-line">
      {/* Consensus + distribution */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-faint">Consensus</div>
            <div className="text-lg font-semibold">{c.rating}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-faint">{total} analysts</div>
            <div className="tnum text-[12px] text-muted">score {c.score.toFixed(2)} / 5</div>
          </div>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full">
          {DIST.map((d) => {
            const w = (c.distribution[d.key] / total) * 100;
            return w > 0 ? <div key={d.key} className={d.color} style={{ width: `${w}%` }} /> : null;
          })}
        </div>
        <div className="mt-3 space-y-1">
          {DIST.map((d) => (
            <div key={d.key} className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-2 text-muted"><span className={cn("h-2 w-2 rounded-sm", d.color)} />{d.label}</span>
              <span className="tnum">{c.distribution[d.key]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Price targets */}
      <div className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-faint">Price Target (12M)</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="tnum text-2xl font-semibold">${fmtPrice(c.priceTargetAvg)}</span>
          <span className={cn("tnum text-[13px] font-medium", upside >= 0 ? "text-pos" : "text-neg")}>
            {upside >= 0 ? "+" : ""}{fmtPct(upside, 1)} vs ${fmtPrice(price)}
          </span>
        </div>
        <div className="relative mt-5 h-1 rounded-full bg-surface-3">
          {(() => {
            const lo = Math.min(c.priceTargetLow, price);
            const hi = Math.max(c.priceTargetHigh, price);
            const span = hi - lo || 1;
            const p = (v: number) => ((v - lo) / span) * 100;
            return (
              <>
                <div className="absolute -top-1 h-3 w-0.5 bg-muted" style={{ left: `${p(price)}%` }} title="Current" />
                <div className="absolute -top-1.5 h-4 w-1 rounded bg-accent" style={{ left: `${p(c.priceTargetAvg)}%` }} title="Average target" />
              </>
            );
          })()}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <TargetCell label="Low" value={c.priceTargetLow} price={price} />
          <TargetCell label="Average" value={c.priceTargetAvg} price={price} />
          <TargetCell label="High" value={c.priceTargetHigh} price={price} />
        </div>
        <div className="mt-2 text-[11px] text-faint">Estimates updated {c.updated}</div>
      </div>

      {/* Recent actions */}
      <div className="col-span-full border-t border-line">
        <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Recent Analyst Actions</div>
        <div className="overflow-x-auto">
          <table className="ftable min-w-[560px]">
            <thead>
              <tr><th>Date</th><th>Firm</th><th>Action</th><th>Rating</th><th className="!text-right">Target</th></tr>
            </thead>
            <tbody>
              {data.actions.map((a, i) => (
                <tr key={i}>
                  <td className="tnum text-muted">{a.date}</td>
                  <td>{a.firm}</td>
                  <td>
                    <span className={cn("text-[12px] font-medium",
                      a.action.includes("Raise") || a.action === "Upgrade" ? "text-pos" :
                      a.action.includes("Cut") || a.action === "Downgrade" ? "text-neg" : "text-muted")}>
                      {a.action}
                    </span>
                  </td>
                  <td className="text-muted">{a.ratingFrom ? `${a.ratingFrom} → ` : ""}{a.ratingTo}</td>
                  <td className="tnum">
                    {a.targetFrom != null && <span className="text-faint">${fmtPrice(a.targetFrom)} → </span>}
                    {a.targetTo != null ? `$${fmtPrice(a.targetTo)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TargetCell({ label, value, price }: { label: string; value: number; price: number }) {
  const d = ((value - price) / price) * 100;
  return (
    <div className="rounded-md border border-line bg-surface-2 py-2">
      <div className="text-[10px] uppercase text-faint">{label}</div>
      <div className="tnum text-[15px] font-semibold">${fmtPrice(value)}</div>
      <div className={cn("tnum text-[10px]", d >= 0 ? "text-pos" : "text-neg")}>{d >= 0 ? "+" : ""}{fmtPct(d, 0)}</div>
    </div>
  );
}

import type { ScenarioForecast } from "@/types";
import { RangeBar } from "@/components/charts/RangeBar";
import { Panel } from "@/components/common/Panel";
import { ConfidenceBadge, CoverageBadge, Disclaimer } from "@/components/common/bits";
import { fmtPrice, fmtPct, fmtMult } from "@/lib/format";
import { cn } from "@/lib/cn";

function ScenarioCard({ label, s, current, tone }: { label: string; s: ScenarioForecast["baseCase"]; current: number; tone: "neg" | "accent" | "pos" }) {
  const upside = ((s.priceTarget - current) / current) * 100;
  const toneCls = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-accent";
  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex items-center justify-between">
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", toneCls)}>{label}</span>
        <span className="text-[11px] text-faint">{fmtPct(s.probability * 100, 0)} weight</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="tnum text-xl font-semibold">${fmtPrice(s.priceTarget)}</span>
        <span className={cn("tnum text-[13px] font-medium", upside >= 0 ? "text-pos" : "text-neg")}>
          {upside >= 0 ? "+" : ""}{fmtPct(upside, 0)}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-1 border-y border-line py-2 text-center">
        <div><dt className="text-[10px] text-faint">Rev gr.</dt><dd className="tnum text-[12px]">{fmtPct(s.revenueGrowth, 0)}</dd></div>
        <div><dt className="text-[10px] text-faint">EPS</dt><dd className="tnum text-[12px]">${fmtPrice(s.epsEstimate)}</dd></div>
        <div><dt className="text-[10px] text-faint">Fwd P/E</dt><dd className="tnum text-[12px]">{fmtMult(s.forwardPE)}</dd></div>
      </dl>
      <p className="text-[12px] leading-relaxed text-muted">{s.thesis}</p>
    </div>
  );
}

export function AIOutlook({ forecast }: { forecast: ScenarioForecast }) {
  const f = forecast;
  return (
    <Panel
      title={
        <div className="flex items-center gap-2.5">
          <h2 className="panel-title">AI Outlook · 12-Month Scenarios</h2>
          <CoverageBadge level={f.coverage} />
        </div>
      }
      action={<ConfidenceBadge level={f.confidence} />}
    >
      <div className="px-4">
        <RangeBar current={f.currentPrice} bear={f.bearCase.priceTarget} base={f.baseCase.priceTarget} bull={f.bullCase.priceTarget} />
      </div>
      <div className="grid grid-cols-1 divide-y divide-line border-t border-line md:grid-cols-3 md:divide-x md:divide-y-0">
        <ScenarioCard label="Bear" s={f.bearCase} current={f.currentPrice} tone="neg" />
        <ScenarioCard label="Base" s={f.baseCase} current={f.currentPrice} tone="accent" />
        <ScenarioCard label="Bull" s={f.bullCase} current={f.currentPrice} tone="pos" />
      </div>
      <div className="border-t border-line px-4 py-3">
        <p className="text-[13px] leading-relaxed text-muted">{f.summary}</p>
        <div className="mt-2.5">
          <Disclaimer />
        </div>
      </div>
    </Panel>
  );
}

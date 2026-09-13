import type { InvestmentThesis, ScenarioForecast } from "@/types";
import { RiskBadge } from "@/components/common/bits";
import { fmtDateShort } from "@/lib/format";

export function ThesisView({ thesis }: { thesis: InvestmentThesis }) {
  return (
    <div className="grid grid-cols-1 gap-0 md:grid-cols-2 md:divide-x md:divide-line">
      <Column title="Why investors are bullish" tone="pos" items={thesis.bull} />
      <Column title="Why investors are bearish" tone="neg" items={thesis.bear} />
      <div className="col-span-full border-t border-line p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Valuation summary</Label>
            <p className="text-[13px] leading-relaxed text-muted">{thesis.valuationSummary}</p>
          </div>
          <div>
            <Label>What matters most next</Label>
            <p className="text-[13px] leading-relaxed text-muted">{thesis.whatMattersNext}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({ title, tone, items }: { title: string; tone: "pos" | "neg"; items: string[] }) {
  return (
    <div className="p-4">
      <div className={`mb-2.5 text-[12px] font-semibold ${tone === "pos" ? "text-pos" : "text-neg"}`}>{title}</div>
      <ul className="space-y-2.5">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === "pos" ? "bg-pos" : "bg-neg"}`} />
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RiskList({ risks }: { risks: ScenarioForecast["risks"] }) {
  return (
    <div className="divide-y divide-line">
      {risks.map((r) => (
        <div key={r.category} className="flex items-start gap-3 px-4 py-3">
          <div className="w-32 shrink-0">
            <div className="text-[13px] font-medium">{r.category}</div>
            <div className="mt-1"><RiskBadge level={r.level} /></div>
          </div>
          <p className="flex-1 text-[13px] leading-relaxed text-muted">{r.note}</p>
        </div>
      ))}
      <p className="px-4 py-2 text-[11px] text-faint">AI-assessed risk levels based on available data. These are interpretive, not objective ratings.</p>
    </div>
  );
}

export function CatalystList({ catalysts }: { catalysts: ScenarioForecast["catalysts"] }) {
  return (
    <ol className="relative divide-y divide-line">
      {catalysts.map((c, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="flex w-16 shrink-0 flex-col items-center rounded-md border border-line bg-surface-2 py-1.5">
            <span className="tnum text-[15px] font-semibold leading-none">{new Date(c.date).getDate()}</span>
            <span className="text-[10px] uppercase text-faint">{fmtDateShort(c.date).split(" ")[0]}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{c.title}</div>
            <div className="text-[11px] text-faint">{c.kind}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</div>;
}

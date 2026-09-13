import type { EarningsRow, UpcomingEarnings } from "@/types";
import { fmtPrice, fmtPct, fmtMoneyCompact, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";

export function NextEarnings({ e }: { e: UpcomingEarnings }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
      <Field label="Expected Date" value={fmtDate(e.date)} sub={e.time === "BMO" ? "Before open" : e.time === "AMC" ? "After close" : "Time TBD"} />
      <Field label="Fiscal Period" value={e.fiscalPeriod} sub={`${e.analystCount} analysts`} />
      <Field label="EPS Estimate" value={e.epsEstimate != null ? `$${fmtPrice(e.epsEstimate)}` : "—"} sub="Consensus" />
      <Field label="Revenue Estimate" value={e.revEstimate != null ? fmtMoneyCompact(e.revEstimate) : "—"} sub="Consensus" />
    </div>
  );
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="tnum mt-0.5 text-[17px] font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function EarningsHistory({ rows }: { rows: EarningsRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="ftable min-w-[720px]">
        <thead>
          <tr>
            <th>Quarter</th>
            <th>Report Date</th>
            <th>EPS Est.</th>
            <th>EPS Act.</th>
            <th>Surprise</th>
            <th>Rev Est.</th>
            <th>Rev Act.</th>
            <th>Rev Surp.</th>
            <th className="!text-right">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const beat = (r.epsSurprisePct ?? 0) >= 0;
            return (
              <tr key={r.period}>
                <td className="font-medium">{r.period}</td>
                <td className="tnum text-muted">{r.reportDate}</td>
                <td className="tnum text-muted">${fmtPrice(r.epsEstimate ?? 0)}</td>
                <td className="tnum">${fmtPrice(r.epsActual ?? 0)}</td>
                <td className={cn("tnum font-medium", beat ? "text-pos" : "text-neg")}>{fmtPct(r.epsSurprisePct ?? 0, 1, true)}</td>
                <td className="tnum text-muted">{fmtMoneyCompact(r.revEstimate ?? 0)}</td>
                <td className="tnum">{fmtMoneyCompact(r.revActual ?? 0)}</td>
                <td className={cn("tnum", (r.revSurprisePct ?? 0) >= 0 ? "text-pos" : "text-neg")}>{fmtPct(r.revSurprisePct ?? 0, 1, true)}</td>
                <td>
                  <span className={cn("inline-flex h-[19px] items-center rounded border px-1.5 text-[11px] font-medium", beat ? "border-pos/25 bg-pos/10 text-pos" : "border-neg/25 bg-neg/10 text-neg")}>
                    {beat ? "Beat" : "Miss"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

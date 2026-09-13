import Link from "next/link";
import type { InsiderTx, Institution, Peer } from "@/types";
import { Monogram } from "@/components/common/Monogram";
import { EmptyState } from "@/components/common/Panel";
import { fmtCompact, fmtMoneyCompact, fmtPrice, fmtPct, fmtMult } from "@/lib/format";
import { cn } from "@/lib/cn";

export function InsiderTable({ rows }: { rows: InsiderTx[] }) {
  if (!rows.length) return <EmptyState title="No recent insider transactions" />;
  return (
    <div className="overflow-x-auto">
      <table className="ftable min-w-[620px]">
        <thead>
          <tr><th>Insider</th><th>Role</th><th>Type</th><th>Shares</th><th>Price</th><th>Value</th><th className="!text-right">Date</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-medium">{r.name}</td>
              <td className="text-[12px] text-muted">{r.role}</td>
              <td>
                <span className={cn("inline-flex h-[19px] items-center rounded border px-1.5 text-[11px] font-medium", r.type === "Buy" ? "border-pos/25 bg-pos/10 text-pos" : "border-line-2 bg-surface-2 text-muted")}>
                  {r.type}
                </span>
              </td>
              <td className="tnum">{fmtCompact(r.shares, 1)}</td>
              <td className="tnum text-muted">${fmtPrice(r.price)}</td>
              <td className="tnum">{fmtMoneyCompact(r.value)}</td>
              <td className="tnum text-muted">{r.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-faint">Insider selling is often routine (compensation, diversification) and is not inherently bearish.</p>
    </div>
  );
}

export function InstitutionTable({ rows }: { rows: Institution[] }) {
  if (!rows.length) return <EmptyState title="No institutional holdings data" />;
  return (
    <div className="overflow-x-auto">
      <table className="ftable min-w-[560px]">
        <thead>
          <tr><th>Institution</th><th>Shares</th><th>Value</th><th>Chg (QoQ)</th><th className="!text-right">% of Portfolio</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-medium">{r.name}</td>
              <td className="tnum">{fmtCompact(r.shares, 1)}</td>
              <td className="tnum">{fmtMoneyCompact(r.value)}</td>
              <td className={cn("tnum", r.changePct >= 0 ? "text-pos" : "text-neg")}>{fmtPct(r.changePct, 1, true)}</td>
              <td className="tnum text-muted">{fmtPct(r.portfolioPct, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PeerTable({ rows }: { rows: Peer[] }) {
  if (!rows.length) return <EmptyState title="No comparable peers identified" />;
  return (
    <div className="overflow-x-auto">
      <table className="ftable min-w-[760px]">
        <thead>
          <tr>
            <th>Company</th><th>Mkt Cap</th><th>Rev Gr.</th><th>EPS Gr.</th><th>P/E</th><th>Fwd P/E</th><th>Gross M.</th><th>Net M.</th><th className="!text-right">1Y</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.ticker}>
              <td>
                <Link href={`/stocks/${p.ticker}`} className="flex items-center gap-2.5">
                  <Monogram ticker={p.ticker} bg={p.logoBg} size={22} />
                  <span className="link-ticker text-[13px]">{p.ticker}</span>
                </Link>
              </td>
              <td className="tnum text-muted">{fmtMoneyCompact(p.marketCap)}</td>
              <td className={cn("tnum", p.revenueGrowth >= 0 ? "text-pos" : "text-neg")}>{fmtPct(p.revenueGrowth, 0)}</td>
              <td className={cn("tnum", p.epsGrowth >= 0 ? "text-pos" : "text-neg")}>{fmtPct(p.epsGrowth, 0)}</td>
              <td className="tnum text-muted">{p.pe ? fmtMult(p.pe) : "—"}</td>
              <td className="tnum text-muted">{p.peForward ? fmtMult(p.peForward) : "—"}</td>
              <td className="tnum text-muted">{fmtPct(p.grossMargin, 0)}</td>
              <td className="tnum text-muted">{fmtPct(p.netMargin, 0)}</td>
              <td className={cn("tnum", p.perf1Y >= 0 ? "text-pos" : "text-neg")}>{fmtPct(p.perf1Y, 0, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

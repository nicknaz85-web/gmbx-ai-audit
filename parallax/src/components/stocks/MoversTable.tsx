import Link from "next/link";
import type { Mover } from "@/types";
import { Monogram } from "@/components/common/Monogram";
import { Sparkline } from "@/components/common/Sparkline";
import { fmtPrice, fmtPct, fmtMoneyCompact, fmtCompact, fmtMult } from "@/lib/format";
import { cn } from "@/lib/cn";

/* Compact movers list used on the home page (variant="compact") and a fuller
   table used on the movers/screener pages (variant="full"). */
export function MoversTable({
  rows,
  variant = "compact",
  showSector = false,
}: {
  rows: Mover[];
  variant?: "compact" | "full";
  showSector?: boolean;
}) {
  if (variant === "compact") {
    return (
      <div className="divide-y divide-line">
        {rows.map((m) => (
          <Link key={m.ticker} href={`/stocks/${m.ticker}`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2">
            <Monogram ticker={m.ticker} bg={m.logoBg} size={26} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold leading-tight">{m.ticker}</div>
              <div className="truncate text-[11px] text-faint">{m.name}</div>
            </div>
            <Sparkline data={m.spark} width={52} height={22} />
            <div className="w-[74px] text-right">
              <div className="tnum text-[13px] leading-tight">${fmtPrice(m.price)}</div>
              <div className={cn("tnum text-[11px] font-medium", m.changePercent >= 0 ? "text-pos" : "text-neg")}>
                {m.changePercent >= 0 ? "+" : ""}{fmtPct(m.changePercent, 2)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="ftable min-w-[720px]">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Chg %</th>
            <th>Chg $</th>
            <th>Volume</th>
            <th>Avg Vol</th>
            <th>Rel Vol</th>
            <th>Mkt Cap</th>
            <th>P/E</th>
            {showSector && <th>Sector</th>}
            <th className="!text-right">30D</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const rvol = m.volume / Math.max(1, m.avgVolume);
            return (
              <tr key={m.ticker}>
                <td>
                  <Link href={`/stocks/${m.ticker}`} className="flex items-center gap-2.5">
                    <Monogram ticker={m.ticker} bg={m.logoBg} size={24} />
                    <span>
                      <span className="link-ticker text-[13px]">{m.ticker}</span>
                      <span className="block max-w-[150px] truncate text-[11px] text-faint">{m.name}</span>
                    </span>
                  </Link>
                </td>
                <td className="tnum">${fmtPrice(m.price)}</td>
                <td className={cn("tnum font-medium", m.changePercent >= 0 ? "text-pos" : "text-neg")}>
                  {m.changePercent >= 0 ? "+" : ""}{fmtPct(m.changePercent, 2)}
                </td>
                <td className={cn("tnum", m.change >= 0 ? "text-pos" : "text-neg")}>
                  {m.change >= 0 ? "+" : "−"}{fmtPrice(Math.abs(m.change))}
                </td>
                <td className="tnum text-muted">{fmtCompact(m.volume, 1)}</td>
                <td className="tnum text-muted">{fmtCompact(m.avgVolume, 1)}</td>
                <td className={cn("tnum", rvol >= 1.5 ? "text-warn" : "text-muted")}>{rvol.toFixed(2)}×</td>
                <td className="tnum text-muted">{fmtMoneyCompact(m.marketCap)}</td>
                <td className="tnum text-muted">{m.pe ? fmtMult(m.pe) : "—"}</td>
                {showSector && <td className="text-[12px] text-muted">{m.sector}</td>}
                <td>
                  <div className="flex justify-end"><Sparkline data={m.spark} width={64} height={22} /></div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

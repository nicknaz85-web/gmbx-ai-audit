"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWatchlist } from "@/hooks/useWatchlist";
import { Monogram } from "@/components/common/Monogram";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { fmtPrice, fmtPct, fmtMoneyCompact, fmtDateShort } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Row {
  ticker: string; name: string; logoBg: string; price: number; changePercent: number;
  marketCap: number; nextEarnings: string | null; baseTarget: number; baseUpside: number;
}

const SUGGEST = ["NVDA", "AAPL", "PLTR", "TSLA", "IONQ", "HIMS"];

export default function WatchlistPage() {
  const { tickers, ready, remove, add, has } = useWatchlist();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (tickers.length === 0) { setRows([]); return; }
    setLoading(true);
    fetch(`/api/watchlist?tickers=${tickers.join(",")}`)
      .then((r) => r.json())
      .then((data: Row[]) => {
        // preserve watchlist order
        const map = new Map(data.map((d) => [d.ticker, d]));
        setRows(tickers.map((t) => map.get(t)).filter(Boolean) as Row[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [tickers, ready]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Watchlist</h1>
          <p className="text-[13px] text-muted">{tickers.length} {tickers.length === 1 ? "stock" : "stocks"} tracked · saved locally on this device</p>
        </div>
        <div className="w-full max-w-xs"><GlobalSearch /></div>
      </div>

      {ready && tickers.length === 0 ? (
        <div className="panel px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-line-2 text-warn">★</div>
          <h2 className="mt-3 text-base font-semibold">Your watchlist is empty</h2>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">Search for a stock or add one of these to start tracking price, earnings and the AI outlook.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {SUGGEST.map((t) => (
              <button key={t} onClick={() => add(t)} className="chip hover:!text-text hover:!border-line-2" disabled={has(t)}>+ {t}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className={cn("panel overflow-hidden transition-opacity", loading && rows.length === 0 && "opacity-50")}>
          <div className="overflow-x-auto">
            <table className="ftable min-w-[760px]">
              <thead>
                <tr>
                  <th>Symbol</th><th>Price</th><th>Chg %</th><th>Mkt Cap</th><th>Next Earnings</th><th>AI Base</th><th className="!text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ticker}>
                    <td>
                      <Link href={`/stocks/${r.ticker}`} className="flex items-center gap-2.5">
                        <Monogram ticker={r.ticker} bg={r.logoBg} size={26} />
                        <span>
                          <span className="link-ticker text-[13px]">{r.ticker}</span>
                          <span className="block max-w-[180px] truncate text-[11px] text-faint">{r.name}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="tnum">${fmtPrice(r.price)}</td>
                    <td className={cn("tnum font-medium", r.changePercent >= 0 ? "text-pos" : "text-neg")}>
                      {r.changePercent >= 0 ? "+" : ""}{fmtPct(r.changePercent, 2)}
                    </td>
                    <td className="tnum text-muted">{fmtMoneyCompact(r.marketCap)}</td>
                    <td className="tnum text-muted">{r.nextEarnings ? fmtDateShort(r.nextEarnings) : "—"}</td>
                    <td className="tnum">
                      <span className="text-muted">${fmtPrice(r.baseTarget)}</span>{" "}
                      <span className={cn("text-[11px]", r.baseUpside >= 0 ? "text-pos" : "text-neg")}>
                        ({r.baseUpside >= 0 ? "+" : ""}{fmtPct(r.baseUpside, 0)})
                      </span>
                    </td>
                    <td className="!text-right">
                      <button onClick={() => remove(r.ticker)} className="text-faint hover:text-neg" title="Remove" aria-label={`Remove ${r.ticker}`}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

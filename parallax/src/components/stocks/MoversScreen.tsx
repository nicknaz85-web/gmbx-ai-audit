"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Mover } from "@/types";
import type { MoversBundle } from "@/lib/api/mock/market";
import { Monogram } from "@/components/common/Monogram";
import { Sparkline } from "@/components/common/Sparkline";
import { fmtPrice, fmtPct, fmtMoneyCompact, fmtCompact, fmtMult } from "@/lib/format";
import { cn } from "@/lib/cn";

type Cat = "gainers" | "losers" | "active" | "unusualVolume";
type SortKey = "changePercent" | "price" | "volume" | "marketCap" | "rvol" | "ticker";

const CATS: { key: Cat; label: string }[] = [
  { key: "gainers", label: "Top Gainers" },
  { key: "losers", label: "Top Losers" },
  { key: "active", label: "Most Active" },
  { key: "unusualVolume", label: "Unusual Volume" },
];

const COLS: { key: SortKey; label: string; align?: "left" }[] = [
  { key: "ticker", label: "Symbol", align: "left" },
  { key: "price", label: "Price" },
  { key: "changePercent", label: "Chg %" },
  { key: "volume", label: "Volume" },
  { key: "rvol", label: "Rel Vol" },
  { key: "marketCap", label: "Mkt Cap" },
];

export function MoversScreen({ bundle }: { bundle: MoversBundle }) {
  const [cat, setCat] = useState<Cat>("gainers");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "changePercent", dir: -1 });

  const rows = useMemo(() => {
    const list = [...bundle[cat]];
    const val = (m: Mover, k: SortKey) =>
      k === "rvol" ? m.volume / Math.max(1, m.avgVolume) : k === "ticker" ? m.ticker : (m[k as keyof Mover] as number);
    list.sort((a, b) => {
      const av = val(a, sort.key), bv = val(b, sort.key);
      if (typeof av === "string") return (av as string).localeCompare(bv as string) * sort.dir;
      return ((av as number) - (bv as number)) * sort.dir;
    });
    return list;
  }, [bundle, cat, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "ticker" ? 1 : -1 }));

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-2">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => { setCat(c.key); setSort({ key: c.key === "unusualVolume" ? "rvol" : c.key === "active" ? "volume" : "changePercent", dir: -1 }); }}
            className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", cat === c.key ? "bg-surface-2 text-text" : "text-muted hover:text-text")}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="ftable min-w-[760px]">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={cn("cursor-pointer select-none hover:text-muted", c.align === "left" && "!text-left")} onClick={() => toggleSort(c.key)}>
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort.key === c.key && <span className="text-[9px]">{sort.dir === -1 ? "▼" : "▲"}</span>}
                  </span>
                </th>
              ))}
              <th>Sector</th>
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
                        <span className="block max-w-[160px] truncate text-[11px] text-faint">{m.name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="tnum">${fmtPrice(m.price)}</td>
                  <td className={cn("tnum font-medium", m.changePercent >= 0 ? "text-pos" : "text-neg")}>
                    {m.changePercent >= 0 ? "+" : ""}{fmtPct(m.changePercent, 2)}
                  </td>
                  <td className="tnum text-muted">{fmtCompact(m.volume, 1)}</td>
                  <td className={cn("tnum", rvol >= 1.5 ? "text-warn" : "text-muted")}>{rvol.toFixed(2)}×</td>
                  <td className="tnum text-muted">{fmtMoneyCompact(m.marketCap)}</td>
                  <td className="text-[12px] text-muted">{m.sector}</td>
                  <td><div className="flex justify-end"><Sparkline data={m.spark} width={64} height={22} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

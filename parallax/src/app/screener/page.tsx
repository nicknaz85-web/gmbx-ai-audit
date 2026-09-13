"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ScreenerRow } from "@/app/api/screener/route";
import { Monogram } from "@/components/common/Monogram";
import { fmtPrice, fmtPct, fmtMoneyCompact, fmtMult, fmtCompact } from "@/lib/format";
import { cn } from "@/lib/cn";

type Cap = "all" | "mega" | "large" | "mid" | "small" | "micro";
type SortKey = "marketCap" | "changePercent" | "revenueGrowth" | "epsGrowth" | "pe" | "relVolume";

interface Filters {
  cap: Cap; sector: string; minRevGrowth: number; maxPe: number | null;
  minRelVol: number; profitableOnly: boolean; tag: string | null;
}

const DEFAULT: Filters = { cap: "all", sector: "all", minRevGrowth: 0, maxPe: null, minRelVol: 0, profitableOnly: false, tag: null };

const CAP_BANDS: Record<Cap, [number, number]> = {
  all: [0, Infinity], mega: [2e11, Infinity], large: [1e10, 2e11], mid: [2e9, 1e10], small: [3e8, 2e9], micro: [0, 3e8],
};

const PRESETS: { label: string; f: Partial<Filters> }[] = [
  { label: "Fastest-Growing Small Caps", f: { cap: "small", minRevGrowth: 25 } },
  { label: "Profitable Small Caps", f: { cap: "small", profitableOnly: true } },
  { label: "High Revenue Growth", f: { minRevGrowth: 30 } },
  { label: "Unusual Volume", f: { minRelVol: 1.3 } },
  { label: "AI / Technology", f: { tag: "ai" } },
  { label: "Biotech & Healthcare", f: { sector: "Healthcare" } },
];

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [filters, setFilters] = useState<Filters>(DEFAULT);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "marketCap", dir: -1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/screener").then((r) => r.json()).then((d: ScreenerRow[]) => { setRows(d); setLoading(false); });
  }, []);

  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector))).sort(), [rows]);

  const filtered = useMemo(() => {
    const [lo, hi] = CAP_BANDS[filters.cap];
    const out = rows.filter((r) =>
      r.marketCap >= lo && r.marketCap < hi &&
      (filters.sector === "all" || r.sector === filters.sector) &&
      r.revenueGrowth >= filters.minRevGrowth &&
      (filters.maxPe == null || (r.peForward != null && r.peForward <= filters.maxPe)) &&
      r.relVolume >= filters.minRelVol &&
      (!filters.profitableOnly || r.profitable) &&
      (!filters.tag || r.tags.includes(filters.tag))
    );
    out.sort((a, b) => {
      const av = a[sort.key] ?? -Infinity, bv = b[sort.key] ?? -Infinity;
      return ((av as number) - (bv as number)) * sort.dir;
    });
    return out;
  }, [rows, filters, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Screener &amp; Discover</h1>
        <p className="text-[13px] text-muted">Filter the universe by size, growth, valuation and volume. Presets surface small-cap ideas.</p>
      </div>

      {/* Discovery presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setFilters({ ...DEFAULT, ...p.f })} className="chip hover:!text-text hover:!border-line-2">{p.label}</button>
        ))}
        <button onClick={() => setFilters(DEFAULT)} className="chip !text-faint hover:!text-text">Reset</button>
      </div>

      {/* Filter bar */}
      <div className="panel grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Market Cap">
          <Select value={filters.cap} onChange={(v) => set("cap", v as Cap)} options={[["all", "Any"], ["mega", "Mega >$200B"], ["large", "Large"], ["mid", "Mid"], ["small", "Small"], ["micro", "Micro <$300M"]]} />
        </Field>
        <Field label="Sector">
          <Select value={filters.sector} onChange={(v) => set("sector", v)} options={[["all", "All sectors"], ...sectors.map((s) => [s, s] as [string, string])]} />
        </Field>
        <Field label="Min Rev Growth">
          <Select value={String(filters.minRevGrowth)} onChange={(v) => set("minRevGrowth", Number(v))} options={[["0", "Any"], ["10", "10%+"], ["20", "20%+"], ["30", "30%+"], ["50", "50%+"]]} />
        </Field>
        <Field label="Max Fwd P/E">
          <Select value={filters.maxPe == null ? "any" : String(filters.maxPe)} onChange={(v) => set("maxPe", v === "any" ? null : Number(v))} options={[["any", "Any"], ["20", "≤ 20"], ["30", "≤ 30"], ["50", "≤ 50"]]} />
        </Field>
        <Field label="Rel Volume">
          <Select value={String(filters.minRelVol)} onChange={(v) => set("minRelVol", Number(v))} options={[["0", "Any"], ["1.2", "1.2×+"], ["1.5", "1.5×+"], ["2", "2×+"]]} />
        </Field>
        <Field label="Profitability">
          <button onClick={() => set("profitableOnly", !filters.profitableOnly)} className={cn("h-8 w-full rounded-md border text-[13px]", filters.profitableOnly ? "border-pos/40 bg-pos/10 text-pos" : "border-line-2 bg-surface-2 text-muted")}>
            {filters.profitableOnly ? "Profitable only" : "All"}
          </button>
        </Field>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
          <span>{loading ? "Loading…" : `${filtered.length} matches`}</span>
          <span className="text-faint">Click a column to sort</span>
        </div>
        <div className="overflow-x-auto">
          <table className="ftable min-w-[820px]">
            <thead>
              <tr>
                <th className="!text-left">Symbol</th>
                <Th k="marketCap" sort={sort} on={toggleSort}>Mkt Cap</Th>
                <th>Price</th>
                <Th k="changePercent" sort={sort} on={toggleSort}>Chg %</Th>
                <Th k="revenueGrowth" sort={sort} on={toggleSort}>Rev Gr.</Th>
                <Th k="epsGrowth" sort={sort} on={toggleSort}>EPS Gr.</Th>
                <Th k="pe" sort={sort} on={toggleSort}>P/E</Th>
                <th>Gr. Mgn</th>
                <Th k="relVolume" sort={sort} on={toggleSort}>Rel Vol</Th>
                <th className="!text-right">Sector</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.ticker}>
                  <td>
                    <Link href={`/stocks/${r.ticker}`} className="flex items-center gap-2.5">
                      <Monogram ticker={r.ticker} bg={r.logoBg} size={24} />
                      <span>
                        <span className="link-ticker text-[13px]">{r.ticker}</span>
                        <span className="block max-w-[160px] truncate text-[11px] text-faint">{r.name}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="tnum text-muted">{fmtMoneyCompact(r.marketCap)}</td>
                  <td className="tnum">${fmtPrice(r.price)}</td>
                  <td className={cn("tnum", r.changePercent >= 0 ? "text-pos" : "text-neg")}>{r.changePercent >= 0 ? "+" : ""}{fmtPct(r.changePercent, 2)}</td>
                  <td className={cn("tnum", r.revenueGrowth >= 0 ? "text-pos" : "text-neg")}>{fmtPct(r.revenueGrowth, 0)}</td>
                  <td className={cn("tnum", r.epsGrowth >= 0 ? "text-pos" : "text-neg")}>{fmtPct(r.epsGrowth, 0)}</td>
                  <td className="tnum text-muted">{r.pe ? fmtMult(r.pe) : "—"}</td>
                  <td className="tnum text-muted">{fmtPct(r.grossMargin, 0)}</td>
                  <td className={cn("tnum", r.relVolume >= 1.5 ? "text-warn" : "text-muted")}>{r.relVolume.toFixed(2)}×</td>
                  <td className="text-[12px] text-muted">{r.sector}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="!text-center text-muted">No stocks match these filters. Try widening the criteria.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-faint">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border border-line-2 bg-surface-2 px-2 text-[13px] text-text outline-none focus:border-accent/50">
      {options.map(([v, l]) => <option key={v} value={v} className="bg-surface">{l}</option>)}
    </select>
  );
}

function Th({ k, sort, on, children }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; on: (k: SortKey) => void; children: React.ReactNode }) {
  return (
    <th className="cursor-pointer select-none hover:text-muted" onClick={() => on(k)}>
      <span className="inline-flex items-center gap-1">{children}{sort.key === k && <span className="text-[9px]">{sort.dir === -1 ? "▼" : "▲"}</span>}</span>
    </th>
  );
}

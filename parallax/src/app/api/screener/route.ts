import { NextResponse } from "next/server";
import { UNIVERSE } from "@/lib/api/mock/universe";
import { getModel } from "@/lib/api/mock/model";
import { genQuote, genKeyStats } from "@/lib/api/mock/generators";

export const runtime = "nodejs";

export interface ScreenerRow {
  ticker: string; name: string; logoBg: string; sector: string; industry: string; exchange: string;
  price: number; changePercent: number; marketCap: number; volume: number; relVolume: number;
  pe: number | null; peForward: number | null; revenueGrowth: number; epsGrowth: number;
  grossMargin: number; netMargin: number; debtToEquity: number; fcf: number; dividendYield: number | null;
  profitable: boolean; tags: string[];
}

// GET /api/screener → ScreenerRow[] (whole tracked universe with screening metrics)
export async function GET() {
  const rows: ScreenerRow[] = UNIVERSE.map((u) => {
    const m = getModel(u);
    const q = genQuote(u);
    const s = genKeyStats(u);
    const equity = s.marketCap / (s.priceToBook || 3);
    return {
      ticker: u.ticker, name: u.name, logoBg: u.logoBg, sector: u.sector, industry: u.industry, exchange: u.exchange,
      price: q.price, changePercent: q.changePercent, marketCap: s.marketCap,
      volume: q.volume, relVolume: q.volume / Math.max(1, q.avgVolume),
      pe: s.peTTM ? +s.peTTM.toFixed(1) : null, peForward: s.peForward ? +s.peForward.toFixed(1) : null,
      revenueGrowth: +m.revenueGrowth.toFixed(1), epsGrowth: +m.epsGrowth.toFixed(1),
      grossMargin: +m.grossMargin.toFixed(1), netMargin: +m.netMargin.toFixed(1),
      debtToEquity: +(s.totalDebt / Math.max(1, equity)).toFixed(2),
      fcf: s.freeCashFlow ?? 0, dividendYield: s.dividendYield,
      profitable: u.profitable, tags: u.tags,
    };
  });
  return NextResponse.json(rows);
}

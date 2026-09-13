import { NextRequest, NextResponse } from "next/server";
import { provider } from "@/lib/api";
import { generateScenarioForecast } from "@/lib/forecasting/generateScenarioForecast";
import { findEntry } from "@/lib/api/mock/universe";

export const runtime = "nodejs";

/* GET /api/watchlist?tickers=AAPL,NVDA
   Returns enriched rows for the watchlist table: quote + profile essentials +
   next earnings + the AI base-case outlook. Batched so the client makes one
   request regardless of list size. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") || "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 50);

  const rows = await Promise.all(
    tickers.map(async (t) => {
      const entry = findEntry(t);
      if (!entry) return null;
      const [quote, stats, profile, earnings] = await Promise.all([
        provider.quote(t), provider.keyStats(t), provider.profile(t), provider.upcomingEarnings(t),
      ]);
      if (!quote || !stats || !profile) return null;
      const fc = generateScenarioForecast(entry);
      return {
        ticker: t,
        name: profile.name,
        logoBg: profile.logoBg,
        price: quote.price,
        changePercent: quote.changePercent,
        extendedChangePercent: quote.extendedChangePercent ?? null,
        marketCap: stats.marketCap,
        nextEarnings: earnings?.date ?? null,
        baseTarget: fc.baseCase.priceTarget,
        baseUpside: ((fc.baseCase.priceTarget - quote.price) / quote.price) * 100,
      };
    })
  );
  return NextResponse.json(rows.filter(Boolean));
}

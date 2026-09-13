import { NextRequest, NextResponse } from "next/server";
import { findEntry } from "@/lib/api/mock/universe";
import {
  generateScenarioForecast, generateEarningsForecast,
} from "@/lib/forecasting/generateScenarioForecast";

export const runtime = "nodejs";

/* GET /api/ai/forecast?ticker=AAPL
   Returns the deterministic structured forecast + next-earnings estimate.
   The scenario numbers come entirely from the forecasting engine; the AI layer
   only rewrites prose (see the chat route), never the figures. */

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") || "").toUpperCase();
  const entry = findEntry(ticker);
  if (!entry) {
    return NextResponse.json({ error: `Unknown ticker ${ticker}` }, { status: 404 });
  }
  const forecast = generateScenarioForecast(entry);
  const earnings = generateEarningsForecast(entry);
  return NextResponse.json({ forecast, earnings });
}

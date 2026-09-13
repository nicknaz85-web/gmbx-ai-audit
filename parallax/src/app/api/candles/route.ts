import { NextRequest, NextResponse } from "next/server";
import { provider } from "@/lib/api";
import type { ChartRange } from "@/types";

export const runtime = "nodejs";

const RANGES: ChartRange[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"];

// GET /api/candles?ticker=AAPL&range=1M → Candle[]
export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") || "").toUpperCase();
  const rangeParam = (req.nextUrl.searchParams.get("range") || "1M") as ChartRange;
  const range = RANGES.includes(rangeParam) ? rangeParam : "1M";
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  const candles = await provider.candles(ticker, range);
  return NextResponse.json(candles);
}

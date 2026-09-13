import { NextRequest, NextResponse } from "next/server";
import { provider } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/quote?tickers=AAPL,NVDA,PLTR  → Record<ticker, Quote>
// Used by the watchlist and any client component that needs a lightweight refresh.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") || "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 40);
  const entries = await Promise.all(
    tickers.map(async (t) => [t, await provider.quote(t)] as const)
  );
  const out: Record<string, unknown> = {};
  for (const [t, q] of entries) if (q) out[t] = q;
  return NextResponse.json(out);
}

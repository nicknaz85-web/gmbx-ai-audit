import { NextRequest, NextResponse } from "next/server";
import { provider } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/news?category=Markets&ticker=AAPL&limit=30
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category") || undefined;
  const ticker = sp.get("ticker") || undefined;
  const limit = Math.min(60, Number(sp.get("limit") || 30));
  const items = await provider.news({ category, ticker, limit });
  return NextResponse.json(items);
}

import { NextRequest, NextResponse } from "next/server";
import { provider } from "@/lib/api";

export const runtime = "nodejs";

// GET /api/search?q=app  → SearchResult[]
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  if (q.trim().length === 0) return NextResponse.json([]);
  const results = await provider.search(q);
  return NextResponse.json(results);
}

import { NextRequest, NextResponse } from "next/server";
import { buildAIContext } from "@/lib/ai/context";
import { SYSTEM_PROMPT, buildUserTurn } from "@/lib/ai/systemPrompt";
import { localAnswer } from "@/lib/ai/localAnswer";
import type { ChatMessage } from "@/types";

export const runtime = "nodejs";

/* POST /api/ai/chat
   Body: { ticker: string, message: string, history?: ChatMessage[] }
   Uses Anthropic when ANTHROPIC_API_KEY is set; otherwise the deterministic
   local answerer produces a grounded response from the same structured data. */

export async function POST(req: NextRequest) {
  let body: { ticker?: string; message?: string; history?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ticker = (body.ticker || "").toUpperCase();
  const message = (body.message || "").trim();
  if (!ticker || !message) {
    return NextResponse.json({ error: "ticker and message are required" }, { status: 400 });
  }

  const ctx = await buildAIContext(ticker);
  if (!ctx) {
    return NextResponse.json(
      { content: `I don't have data for ${ticker}. Try a supported ticker such as AAPL, NVDA or PLTR.`, citations: [], source: "system" },
      { status: 200 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
      const priorTurns = (body.history || []).slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [...priorTurns, { role: "user", content: buildUserTurn(ctx.text, message) }],
        }),
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}`);
      const data = await resp.json();
      const content = (data.content || []).map((c: { text?: string }) => c.text || "").join("");
      return NextResponse.json({ content, citations: [], source: "anthropic" });
    } catch (err) {
      // Fall through to the local answerer so the surface never hard-fails.
      console.error("AI provider error, using local answerer:", err);
    }
  }

  const local = await localAnswer(ticker, message);
  return NextResponse.json({
    content: local?.content ?? `I couldn't analyse that question for ${ticker}.`,
    citations: local?.citations ?? [],
    source: "local",
  });
}

import type { IndexQuote, Mover, NewsArticle, SearchResult } from "@/types";
import { UNIVERSE, findEntry } from "./universe";
import { getModel } from "./model";
import { genQuote, spark, genKeyStats } from "./generators";
import { Rng, todayKey } from "./rng";

/* --------------------------------------------------------------- indices */
const INDICES = [
  { symbol: "SPX", name: "S&P 500", base: 5710 },
  { symbol: "IXIC", name: "Nasdaq Composite", base: 18100 },
  { symbol: "DJI", name: "Dow Jones", base: 42300 },
  { symbol: "RUT", name: "Russell 2000", base: 2210 },
  { symbol: "VIX", name: "Volatility (VIX)", base: 15.4 },
  { symbol: "BTC", name: "Bitcoin", base: 96200 },
  { symbol: "GOLD", name: "Gold", base: 2680 },
  { symbol: "WTI", name: "Crude Oil (WTI)", base: 71.2 },
  { symbol: "US10Y", name: "10-Yr Treasury", base: 4.21 },
];

export function genIndices(): IndexQuote[] {
  return INDICES.map((idx) => {
    const day = new Rng(`idx:${idx.symbol}:${todayKey()}`);
    const changePercent = day.normal(0, idx.symbol === "VIX" ? 5 : idx.symbol === "BTC" ? 3 : 0.9);
    const price = idx.base * (1 + changePercent / 100);
    const change = price - idx.base;
    const sp: number[] = [];
    let v = idx.base * (1 - changePercent / 100 / 2);
    const sr = new Rng(`idxsp:${idx.symbol}:${todayKey()}`);
    for (let i = 0; i < 30; i++) { v *= 1 + sr.normal(changePercent / 3000, 0.004); sp.push(v); }
    sp[sp.length - 1] = price;
    return {
      symbol: idx.symbol, name: idx.name,
      price: idx.symbol === "US10Y" ? +price.toFixed(2) : price,
      change, changePercent, spark: sp,
    };
  });
}

export function genIndexHistory(symbol = "SPX", points = 120): number[] {
  const idx = INDICES.find((i) => i.symbol === symbol) ?? INDICES[0];
  const r = new Rng(`idxhist:${symbol}:${todayKey()}`);
  const out: number[] = [];
  let v = idx.base * (1 - r.range(0.03, 0.11)); // start below current, trend up-ish
  for (let i = 0; i < points; i++) {
    v *= 1 + r.normal(0.0006, 0.0075);
    out.push(v);
  }
  out[out.length - 1] = idx.base * (1 + new Rng(`idx:${symbol}:${todayKey()}`).normal(0, 0.9) / 100);
  return out;
}

/* ----------------------------------------------------------------- movers */
function moverFor(ticker: string): Mover {
  const entry = findEntry(ticker)!;
  const q = genQuote(entry);
  const stats = genKeyStats(entry);
  return {
    ticker: entry.ticker, name: entry.name, price: q.price,
    change: q.change, changePercent: q.changePercent,
    marketCap: stats.marketCap, volume: q.volume, avgVolume: q.avgVolume,
    pe: stats.peTTM ? +stats.peTTM.toFixed(1) : null, sector: entry.sector,
    spark: spark(entry, 20), logoBg: entry.logoBg,
  };
}

export interface MoversBundle {
  gainers: Mover[];
  losers: Mover[];
  active: Mover[];
  unusualVolume: Mover[];
}

export function genMovers(): MoversBundle {
  const all = UNIVERSE.map((u) => moverFor(u.ticker));
  const gainers = [...all].sort((a, b) => b.changePercent - a.changePercent).slice(0, 12);
  const losers = [...all].sort((a, b) => a.changePercent - b.changePercent).slice(0, 12);
  const active = [...all].sort((a, b) => b.volume * b.price - a.volume * a.price).slice(0, 12);
  const unusualVolume = [...all]
    .map((m) => ({ m, rvol: m.volume / Math.max(1, m.avgVolume) }))
    .sort((a, b) => b.rvol - a.rvol)
    .slice(0, 12)
    .map((x) => x.m);
  return { gainers, losers, active, unusualVolume };
}

export function genTrending(): Mover[] {
  const picks = UNIVERSE.filter((u) => u.tags.includes("trending")).map((u) => moverFor(u.ticker));
  return picks.length ? picks : UNIVERSE.slice(0, 6).map((u) => moverFor(u.ticker));
}

/* -------------------------------------------------------------------- news */
const SOURCES = ["Reuters", "Bloomberg", "The Wall Street Journal", "CNBC", "Barron's", "MarketWatch", "Financial Times", "Associated Press", "Seeking Alpha"];
const CATEGORIES = ["Markets", "Stocks", "Technology", "AI", "Earnings", "Economy", "Crypto"];

interface Template {
  cat: string;
  head: (t: string, n: string) => string;
  body: (t: string, n: string) => string;
  sentiment: NewsArticle["sentiment"];
}

const TEMPLATES: Template[] = [
  { cat: "Earnings", sentiment: "positive", head: (t, n) => `${n} tops quarterly estimates as revenue accelerates`, body: (t, n) => `${n} (${t}) reported quarterly results ahead of Wall Street expectations, with management pointing to stronger demand and improving operating leverage. Analysts are reassessing forward estimates following the print.` },
  { cat: "Earnings", sentiment: "negative", head: (t, n) => `${n} slips after cautious guidance overshadows in-line quarter`, body: (t, n) => `Shares of ${n} (${t}) fell as forward guidance came in below consensus, offsetting an otherwise in-line quarter. Executives cited macro uncertainty and a more measured spending environment.` },
  { cat: "AI", sentiment: "positive", head: (t, n) => `${n} expands AI roadmap, targets new enterprise workloads`, body: (t, n) => `${n} (${t}) outlined an expanded artificial-intelligence strategy aimed at capturing enterprise workloads, a move analysts say could open incremental total addressable market over the next several years.` },
  { cat: "Technology", sentiment: "neutral", head: (t, n) => `${n} unveils product refresh at annual showcase`, body: (t, n) => `${n} (${t}) introduced updated products at its annual event, emphasising performance and efficiency gains. The market reaction was muted as investors focus on the upcoming earnings cycle.` },
  { cat: "Stocks", sentiment: "positive", head: (t, n) => `Analysts raise ${t} price target on improving fundamentals`, body: (t, n) => `Several sell-side analysts lifted price targets on ${n} (${t}), citing margin expansion and a healthier demand backdrop. The consensus rating remains constructive heading into the next report.` },
  { cat: "Stocks", sentiment: "negative", head: (t, n) => `${n} downgraded on valuation after strong run`, body: (t, n) => `A brokerage downgraded ${n} (${t}) to a neutral rating, arguing the risk/reward looks balanced after a sharp move higher. The firm kept its long-term thesis intact but flagged near-term valuation.` },
  { cat: "Markets", sentiment: "neutral", head: () => `Stocks steady as investors weigh rate path and earnings`, body: (t, n) => `Major averages traded in a narrow range as markets digested the latest economic data and positioned ahead of a busy earnings week. ${n} (${t}) was among the names in focus.` },
  { cat: "Economy", sentiment: "neutral", head: () => `Inflation data keeps Fed on a cautious footing`, body: () => `The latest inflation reading landed broadly in line with forecasts, reinforcing expectations that policymakers will move deliberately. Rate-sensitive sectors saw modest repositioning.` },
  { cat: "Crypto", sentiment: "positive", head: () => `Bitcoin firms as risk appetite improves`, body: (t, n) => `Digital assets moved higher alongside equities as risk appetite improved. Crypto-linked equities including ${n} (${t}) tracked the move.` },
];

export function genNews(opts: { ticker?: string; category?: string; limit?: number } = {}): NewsArticle[] {
  const limit = opts.limit ?? 30;
  const pool = opts.ticker ? [findEntry(opts.ticker)!].filter(Boolean) : UNIVERSE;
  const r = new Rng(`news:${opts.ticker ?? "all"}:${opts.category ?? "all"}:${todayKey()}`);
  const items: NewsArticle[] = [];
  const now = Date.now();
  const count = opts.ticker ? Math.min(limit, 10) : limit;
  for (let i = 0; i < count; i++) {
    const entry = opts.ticker ? pool[0] : r.pick(pool);
    let tpl = r.pick(TEMPLATES);
    if (opts.category && opts.category !== "For You") {
      const matches = TEMPLATES.filter((t) => t.cat === opts.category);
      if (matches.length) tpl = matches[r.int(0, matches.length - 1)];
    }
    const model = getModel(entry);
    const ago = Math.round((i * i * 0.7 + r.range(1, 40)) * 60000 + i * 3_600_000);
    items.push({
      id: `${entry.ticker}-${i}-${todayKey()}`,
      headline: tpl.head(entry.ticker, entry.name),
      summary: tpl.body(entry.ticker, entry.name),
      source: r.pick(SOURCES),
      url: "#",
      publishedAt: now - ago,
      category: tpl.cat,
      tickers: dedupeTickers(entry.ticker, r),
      sentiment: model.drift < -0.05 && tpl.sentiment === "positive" ? "neutral" : tpl.sentiment,
      imageColor: entry.logoBg,
    });
  }
  return items.sort((a, b) => b.publishedAt - a.publishedAt);
}

function dedupeTickers(primary: string, r: Rng): string[] {
  const out = [primary];
  if (r.bool(0.4)) {
    const other = r.pick(UNIVERSE).ticker;
    if (other !== primary) out.push(other);
  }
  return out;
}

/* ------------------------------------------------------------------ search */
export function searchUniverse(query: string, limit = 8): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = UNIVERSE.map((u) => {
    const t = u.ticker.toLowerCase();
    const n = u.name.toLowerCase();
    let score = -1;
    if (t === q) score = 100;
    else if (t.startsWith(q)) score = 90 - (t.length - q.length);
    else if (n.startsWith(q)) score = 70 - (n.length - q.length) * 0.1;
    else if (t.includes(q)) score = 50;
    else if (n.includes(q)) score = 40;
    return { u, score };
  }).filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || b.u.cap - a.u.cap)
    .slice(0, limit);

  return scored.map(({ u }) => {
    const q2 = genQuote(u);
    return {
      ticker: u.ticker, name: u.name, exchange: u.exchange,
      price: q2.price, changePercent: q2.changePercent, logoBg: u.logoBg,
    };
  });
}

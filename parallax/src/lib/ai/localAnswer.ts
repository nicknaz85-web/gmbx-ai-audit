import { provider } from "@/lib/api";
import { findEntry } from "@/lib/api/mock/universe";
import { computeDrivers } from "@/lib/forecasting/drivers";
import {
  generateScenarioForecast, generateEarningsForecast, generateThesis,
} from "@/lib/forecasting/generateScenarioForecast";
import { fmtMoneyCompact, fmtMult, fmtPct, fmtPrice } from "@/lib/format";

/* Deterministic, grounded answerer used when no ANTHROPIC_API_KEY is present.
   It routes the question to an intent and answers from the SAME structured data
   the live model would receive — so the AI surface is genuinely functional in
   development rather than a fake text box. Every figure is real (from the data
   layer); interpretation is clearly framed and never gives buy/sell advice. */

export interface LocalAnswer {
  content: string;
  citations: string[];
}

export async function localAnswer(ticker: string, question: string): Promise<LocalAnswer | null> {
  const entry = findEntry(ticker);
  if (!entry) return null;
  const q = question.toLowerCase();

  const [profile, quote, stats, analyst] = await Promise.all([
    provider.profile(ticker), provider.quote(ticker), provider.keyStats(ticker), provider.analyst(ticker),
  ]);
  if (!profile || !quote || !stats) return null;
  const d = computeDrivers(entry);
  const name = profile.name;

  const has = (...k: string[]) => k.some((w) => q.includes(w));

  // --- reach a specific price target ---
  const priceMatch = q.match(/\$?\s?(\d{2,5})(?:\s|\?|$)/);
  if (has("reach", "hit", "get to", "$") && priceMatch && has("reach", "hit", "get to", "would", "for")) {
    const target = parseFloat(priceMatch[1]);
    if (target > 5 && target < 100000) return reachTarget(name, ticker, quote.price, target, stats, d);
  }

  if (has("overvalu", "undervalu", "valuation", "expensive", "cheap", "p/e", "multiple"))
    return valuation(name, ticker, stats, d);
  if (has("earnings", "last quarter", "beat", "reported") && !has("next", "predict", "will"))
    return await lastEarnings(ticker, name);
  if (has("next earnings", "predict", "will it beat", "beat next", "how likely"))
    return nextEarnings(entry, name, ticker);
  if (has("grow", "revenue growth", "accelerat"))
    return growth(name, ticker, stats, d);
  if (has("risk", "downside", "fall", "drop", "concern"))
    return risks(entry, name, ticker);
  if (has("bull", "bear", "thesis", "case"))
    return thesis(entry, name, ticker);
  if (has("dilut", "share count", "shares out"))
    return dilution(name, ticker, stats, d);
  if (has("cash", "runway", "burn", "balance sheet", "debt"))
    return balanceSheet(name, ticker, stats, d);
  if (has("news", "happening", "latest", "recent"))
    return await newsSummary(ticker, name);
  if (has("analyst", "target", "rating", "price target"))
    return analystView(name, ticker, quote.price, analyst, d);

  return overview(entry, name, ticker, quote, stats, d);
}

/* --------------------------------------------------------------- intents -- */

function valuation(name: string, t: string, stats: any, d: any): LocalAnswer {
  const vs = d.peVs5yMedianPct;
  const read = vs == null ? "There is limited valuation history to compare against."
    : vs > 20 ? `That is a meaningful premium — the market is pricing in continued execution.`
    : vs > 5 ? `That is modestly above its own history.`
    : vs < -10 ? `That is a discount to its own history, which can reflect either caution or opportunity.`
    : `That is roughly in line with its own history.`;
  return {
    content:
`**Valuation — ${name} (${t})**

- Forward P/E: **${stats.peForward ? fmtMult(stats.peForward) : "n/a (unprofitable)"}**, trailing P/E ${stats.peTTM ? fmtMult(stats.peTTM) : "n/a"} [Valuation]
- Price/Sales **${fmtMult(stats.priceToSales)}**, PEG ${stats.pegRatio ?? "n/a"} [Valuation]
- 5-year median P/E: ${d.historicalPE ? fmtMult(d.historicalPE) : "n/a"} — current forward is ${vs != null ? `**${fmtPct(vs, 0, true)}** versus that median` : "not comparable"} [Valuation]

**Interpretation:** ${read} With ~${fmtPct(d.revenueCagr3y ?? 0, 0)} revenue growth and a ${fmtPct(stats.netMargin ?? 0, 0)} net margin, the multiple is ${vs != null && vs > 15 ? "asking the business to keep compounding" : "broadly supported by the growth profile"}. Whether it is "overvalued" depends on your assumed growth durability — the bull case needs that growth to persist; the bear case assumes it fades.`,
    citations: ["Valuation", "Fundamentals"],
  };
}

async function lastEarnings(t: string, name: string): Promise<LocalAnswer> {
  const hist = await provider.earningsHistory(t);
  const last = hist[0];
  if (!last) return { content: `No recent earnings data is available for ${name} (${t}).`, citations: [] };
  const beat = (last.epsSurprisePct ?? 0) >= 0;
  return {
    content:
`**Latest earnings — ${name} (${t}), ${last.period}** (reported ${last.reportDate})

- EPS: est **$${fmtPrice(last.epsEstimate ?? 0)}** → actual **$${fmtPrice(last.epsActual ?? 0)}** → surprise **${fmtPct(last.epsSurprisePct ?? 0, 1, true)}** (${beat ? "beat" : "miss"}) [Earnings]
- Revenue: est ${fmtMoneyCompact(last.revEstimate ?? 0)} → actual ${fmtMoneyCompact(last.revActual ?? 0)} → ${fmtPct(last.revSurprisePct ?? 0, 1, true)} [Earnings]

**Interpretation:** ${beat ? "The quarter came in ahead of consensus on the bottom line" : "The quarter fell short of consensus EPS"}, and revenue ${((last.revSurprisePct ?? 0) >= 0) ? "beat" : "missed"}. Over the last 8 quarters the company has a ${fmtPct((hist.filter(h => (h.epsSurprisePct ?? 0) >= 0).length / hist.length) * 100, 0)} beat rate on EPS. The market reaction typically depends as much on forward guidance as on the printed numbers.`,
    citations: ["Earnings"],
  };
}

function nextEarnings(entry: any, name: string, t: string): LocalAnswer {
  const f = generateEarningsForecast(entry);
  return {
    content:
`**Next earnings estimate — ${name} (${t}), ${f.fiscalPeriod}**

- Street EPS estimate: **$${fmtPrice(f.streetEps ?? 0)}** [Analysts]
- Parallax model EPS: **$${fmtPrice(f.aiEps)}** (range $${fmtPrice(f.aiEpsLow)}–$${fmtPrice(f.aiEpsHigh)}) [Forecast]
- Scenario probabilities: Beat **${fmtPct(f.beatProb * 100, 0)}** · In-line **${fmtPct(f.inlineProb * 100, 0)}** · Miss **${fmtPct(f.missProb * 100, 0)}** [Forecast]

**Why:**
${f.factors.map((x) => `- ${x}`).join("\n")}

These are model-generated estimates, not predictions of a specific result. The single biggest swing factor is usually guidance rather than the reported quarter.`,
    citations: ["Forecast", "Earnings", "Analysts"],
  };
}

function growth(name: string, t: string, stats: any, d: any): LocalAnswer {
  const accel = (d.momentum6m ?? 0) > 0;
  return {
    content:
`**Growth — ${name} (${t})**

- Revenue (TTM): **${fmtMoneyCompact(stats.revenueTTM)}**, ~**${fmtPct(d.revenueCagr3y ?? 0, 0)}** on a 3-year basis [Fundamentals]
- EPS growth: ~**${fmtPct(d.epsCagr3y ?? 0, 0)}** [Fundamentals]
- Margins: gross ${fmtPct(stats.grossMargin ?? 0, 0)}, operating ${fmtPct(stats.operatingMargin ?? 0, 0)}, net ${fmtPct(stats.netMargin ?? 0, 0)} [Fundamentals]

**Interpretation:** Top-line growth of ~${fmtPct(d.revenueCagr3y ?? 0, 0)} is ${(d.revenueCagr3y ?? 0) > 25 ? "high" : (d.revenueCagr3y ?? 0) > 12 ? "solid" : "moderate"}. With EPS growing ${Math.abs(d.epsCagr3y ?? 0) > Math.abs(d.revenueCagr3y ?? 0) ? "faster than revenue — a sign of operating leverage" : "roughly in line with revenue"}, the model reads underlying momentum as ${accel ? "constructive" : "cooling"} based on 6-month price action of ${fmtPct(d.momentum6m ?? 0, 0, true)}.`,
    citations: ["Fundamentals"],
  };
}

function risks(entry: any, name: string, t: string): LocalAnswer {
  const fc = generateScenarioForecast(entry);
  return {
    content:
`**Key risks — ${name} (${t})** *(AI-assessed, not objective truth)*

${fc.risks.map((r) => `- **${r.category} — ${r.level}:** ${r.note}`).join("\n")}

**What could make the stock fall:** a multiple de-rating (bear case forward P/E ${fmtMult(fc.bearCase.forwardPE)}), growth decelerating toward ${fmtPct(fc.bearCase.revenueGrowth, 0)}, or a guidance cut at the next report. The bear scenario maps to roughly **$${fmtPrice(fc.bearCase.priceTarget)}** over 12 months (${fmtPct(((fc.bearCase.priceTarget - fc.currentPrice) / fc.currentPrice) * 100, 0, true)}).`,
    citations: ["Forecast", "Valuation"],
  };
}

function thesis(entry: any, name: string, t: string): LocalAnswer {
  const th = generateThesis(entry);
  return {
    content:
`**Bull vs bear — ${name} (${t})**

**Bull case**
${th.bull.map((x) => `- ${x}`).join("\n")}

**Bear case**
${th.bear.map((x) => `- ${x}`).join("\n")}

**Valuation:** ${th.valuationSummary}

**What matters next:** ${th.whatMattersNext}`,
    citations: ["Forecast", "Valuation", "Fundamentals"],
  };
}

function dilution(name: string, t: string, stats: any, d: any): LocalAnswer {
  const dil = stats.sharesOutstandingYoY ?? 0;
  const concern = dil > 8;
  return {
    content:
`**Share dilution — ${name} (${t})**

- Shares outstanding: **${fmtPct(dil, 1, true)} YoY** [Fundamentals]
- Short interest: ${fmtPct(stats.shortInterestPct ?? 0, 1)}, insider ownership ${fmtPct(stats.insiderOwnPct ?? 0, 1)} [Ownership]

**Interpretation:** ${concern
  ? `Share count is rising meaningfully (${fmtPct(dil, 1, true)}), which dilutes existing holders and raises the bar for per-share growth — common for cash-consuming companies funding operations via equity.`
  : dil > 3 ? `Modest dilution (${fmtPct(dil, 1, true)}), typical of stock-based compensation.`
  : dil < -1 ? `The share count is actually shrinking (buybacks), which supports per-share metrics.`
  : `Share count is roughly stable, so dilution is not a material factor here.`}`,
    citations: ["Fundamentals", "Ownership"],
  };
}

function balanceSheet(name: string, t: string, stats: any, d: any): LocalAnswer {
  const runway = d.cashRunwayMonths;
  return {
    content:
`**Balance sheet — ${name} (${t})**

- Cash & equivalents: **${fmtMoneyCompact(stats.cash)}** [Fundamentals]
- Total debt: ${fmtMoneyCompact(stats.totalDebt)}, net debt/EBITDA ${d.netDebtToEbitda != null ? d.netDebtToEbitda.toFixed(1) + "x" : "n/a"} [Fundamentals]
- Free cash flow (TTM): ${fmtMoneyCompact(stats.freeCashFlow ?? 0)} [Fundamentals]
${runway != null ? `- **Estimated cash runway: ~${runway} months** at the current burn rate [Forecast]` : ""}

**Interpretation:** ${runway != null
  ? `With FCF negative, the simplified runway estimate (cash ÷ burn) is ~${runway} months. That makes access to capital and the path to breakeven central to the story — watch for raises or ATM issuance.`
  : `The company is free-cash-flow generative, so financing risk is low and it can self-fund growth, buybacks or dividends.`} *Runway is a simplified estimate and ignores changes in burn.*`,
    citations: ["Fundamentals", "Forecast"],
  };
}

async function newsSummary(t: string, name: string): Promise<LocalAnswer> {
  const news = await provider.news({ ticker: t, limit: 5 });
  if (!news.length) return { content: `No recent news is available for ${name} (${t}).`, citations: [] };
  return {
    content:
`**Recent news — ${name} (${t})**

${news.map((a) => `- **${a.headline}** — ${a.source} (${a.sentiment}) [News]`).join("\n")}

**Read:** Coverage skews ${skew(news)} in tone. Headlines are a sentiment signal, not a fundamental input — weigh them against the earnings and valuation picture.`,
    citations: ["News"],
  };
}

function analystView(name: string, t: string, price: number, analyst: any, d: any): LocalAnswer {
  if (!analyst) return { content: `No sell-side analyst coverage is available for ${name} (${t}). For smaller companies this is common and means forecasts carry higher uncertainty.`, citations: [] };
  const c = analyst.consensus;
  return {
    content:
`**Analyst view — ${name} (${t})**

- Consensus rating: **${c.rating}** — ${c.distribution.strongBuy} strong buy / ${c.distribution.buy} buy / ${c.distribution.hold} hold / ${c.distribution.sell} sell / ${c.distribution.strongSell} strong sell [Analysts]
- Price targets: low $${fmtPrice(c.priceTargetLow)} · avg **$${fmtPrice(c.priceTargetAvg)}** · high $${fmtPrice(c.priceTargetHigh)} [Analysts]
- Average target implies **${fmtPct(d.analystUpsidePct ?? 0, 0, true)}** from $${fmtPrice(price)} [Analysts]

**Interpretation:** The Street leans ${c.score >= 4 ? "bullish" : c.score >= 3.2 ? "constructive" : "cautious"}. Targets are a useful anchor but tend to cluster and lag the price — treat the range, not the point estimate, as the signal.`,
    citations: ["Analysts"],
  };
}

function reachTarget(name: string, t: string, price: number, target: number, stats: any, d: any): LocalAnswer {
  const upside = ((target - price) / price) * 100;
  const ratio = target / price;
  const profitable = (stats.epsForward ?? 0) > 0 && stats.peForward;

  let paths: string;
  if (profitable) {
    const fwdPE = stats.peForward as number;
    const impliedEps = stats.epsForward as number;
    const epsNeeded = impliedEps * ratio;
    const peNeeded = ratio * fwdPE;
    paths =
`- **Hold the multiple (${fmtMult(fwdPE)} fwd P/E), grow earnings:** forward EPS would need to reach ~**$${fmtPrice(epsNeeded)}** (from $${fmtPrice(impliedEps)}), i.e. ${fmtPct(((epsNeeded - impliedEps) / impliedEps) * 100, 0, true)} EPS growth.
- **Hold EPS, re-rate the multiple:** the forward P/E would need to expand to ~**${fmtMult(peNeeded)}**.`;
  } else {
    // Pre-profit: frame on the revenue multiple rather than P/E.
    const psNow = stats.priceToSales as number;
    const psNeeded = psNow * ratio;
    paths =
`Since the company isn't yet profitable, valuation runs off revenue rather than earnings [Valuation]:

- **Hold the P/S multiple (${fmtMult(psNow)}), grow revenue:** revenue would need to rise ~**${fmtPct(upside, 0, true)}** from today's ${fmtMoneyCompact(stats.revenueTTM)} base.
- **Hold revenue, re-rate the multiple:** price/sales would need to expand to ~**${fmtMult(psNeeded)}**.`;
  }

  return {
    content:
`**What would ${name} (${t}) need to reach $${fmtPrice(target)}?**

From $${fmtPrice(price)}, that is **${fmtPct(upside, 0, true)}**. Two simple paths [Forecast]:

${paths}

Realistically it is a blend of the two. For context, the base-case 12-month value from the Parallax engine assumes ~${fmtPct(d.revenueCagr3y ?? 0, 0)} revenue growth. $${fmtPrice(target)} is ${upside > 40 ? "an aggressive bull outcome requiring both faster growth and multiple expansion" : upside > 0 ? "within a plausible bull path" : "below the current price"}. This is scenario math, not a prediction.`,
    citations: ["Forecast", "Valuation"],
  };
}

function overview(entry: any, name: string, t: string, quote: any, stats: any, d: any): LocalAnswer {
  const fc = generateScenarioForecast(entry);
  return {
    content:
`**${name} (${t}) — snapshot**

- Price **$${fmtPrice(quote.price)}** (${fmtPct(quote.changePercent, 2, true)} today) · market cap ${fmtMoneyCompact(stats.marketCap)} [Quote]
- Revenue ${fmtMoneyCompact(stats.revenueTTM)}, growth ~${fmtPct(d.revenueCagr3y ?? 0, 0)}, net margin ${fmtPct(stats.netMargin ?? 0, 0)} [Fundamentals]
- Forward P/E ${stats.peForward ? fmtMult(stats.peForward) : "n/a"} [Valuation]
- 12-month scenarios: bear **$${fmtPrice(fc.bearCase.priceTarget)}** · base **$${fmtPrice(fc.baseCase.priceTarget)}** · bull **$${fmtPrice(fc.bullCase.priceTarget)}** [Forecast]

Ask me about valuation, the latest earnings, the bull/bear case, risks, dilution, cash runway, or the next earnings estimate.`,
    citations: ["Quote", "Fundamentals", "Forecast"],
  };
}

function skew(news: any[]): string {
  const pos = news.filter((n) => n.sentiment === "positive").length;
  const neg = news.filter((n) => n.sentiment === "negative").length;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

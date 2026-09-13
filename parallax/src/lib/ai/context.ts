import { provider } from "@/lib/api";
import { findEntry } from "@/lib/api/mock/universe";
import { computeDrivers } from "@/lib/forecasting/drivers";
import { generateScenarioForecast } from "@/lib/forecasting/generateScenarioForecast";
import {
  fmtMoneyCompact, fmtMult, fmtPct, fmtPrice, fmtCompact,
} from "@/lib/format";

/* Assembles the structured, factual context the AI is allowed to reason over.
   The model receives ONLY this — current quote, valuation, fundamentals,
   earnings history, analyst view, deterministic forecast drivers and recent
   news headlines — so answers are grounded in the same numbers the UI shows. */

export interface AIContext {
  ticker: string;
  name: string;
  text: string; // compact, model-ready brief
  suggestions: string[];
}

export async function buildAIContext(ticker: string): Promise<AIContext | null> {
  const entry = findEntry(ticker);
  if (!entry) return null;

  const [profile, quote, stats, history, upcoming, analyst, news] = await Promise.all([
    provider.profile(ticker),
    provider.quote(ticker),
    provider.keyStats(ticker),
    provider.earningsHistory(ticker),
    provider.upcomingEarnings(ticker),
    provider.analyst(ticker),
    provider.news({ ticker, limit: 5 }),
  ]);
  if (!profile || !quote || !stats) return null;

  const drivers = computeDrivers(entry);
  const forecast = generateScenarioForecast(entry);

  const lines: string[] = [];
  lines.push(`COMPANY: ${profile.name} (${profile.exchange}: ${ticker})`);
  lines.push(`Sector: ${profile.sector} | Industry: ${profile.industry} | HQ: ${profile.headquarters} | Employees: ${profile.employees.toLocaleString()}`);
  lines.push("");
  lines.push(`QUOTE (as of now): $${fmtPrice(quote.price)}, ${fmtPct(quote.changePercent, 2, true)} today. 52w range $${fmtPrice(stats.low52)}–$${fmtPrice(stats.high52)}.`);
  lines.push("");
  lines.push("VALUATION:");
  lines.push(`- Market cap ${fmtMoneyCompact(stats.marketCap)}, EV ${fmtMoneyCompact(stats.enterpriseValue)}`);
  lines.push(`- P/E (TTM) ${stats.peTTM ? fmtMult(stats.peTTM) : "n/a (unprofitable)"}, Forward P/E ${stats.peForward ? fmtMult(stats.peForward) : "n/a"}`);
  lines.push(`- P/S ${fmtMult(stats.priceToSales)}, PEG ${stats.pegRatio ?? "n/a"}`);
  lines.push(`- Historical 5y median P/E ${drivers.historicalPE ? fmtMult(drivers.historicalPE) : "n/a"} (current forward is ${drivers.peVs5yMedianPct != null ? fmtPct(drivers.peVs5yMedianPct, 0, true) : "n/a"} vs median)`);
  lines.push("");
  lines.push("FUNDAMENTALS (TTM):");
  lines.push(`- Revenue ${fmtMoneyCompact(stats.revenueTTM)}, growth ~${fmtPct(drivers.revenueCagr3y ?? 0, 0)} (3y)`);
  lines.push(`- EPS ${stats.epsTTM != null ? "$" + fmtPrice(stats.epsTTM) : "n/a"}, EPS growth ~${fmtPct(drivers.epsCagr3y ?? 0, 0)}`);
  lines.push(`- Gross margin ${fmtPct(stats.grossMargin ?? 0, 0)}, Operating ${fmtPct(stats.operatingMargin ?? 0, 0)}, Net ${fmtPct(stats.netMargin ?? 0, 0)}`);
  lines.push(`- Free cash flow ${fmtMoneyCompact(stats.freeCashFlow ?? 0)}, Cash ${fmtMoneyCompact(stats.cash)}, Total debt ${fmtMoneyCompact(stats.totalDebt)}`);
  lines.push(`- Shares out ${fmtCompact(stats.sharesOutstanding)} (${fmtPct(stats.sharesOutstandingYoY ?? 0, 1, true)} YoY dilution)`);
  if (drivers.cashRunwayMonths != null) lines.push(`- Est. cash runway ~${drivers.cashRunwayMonths} months (FCF negative)`);
  lines.push(`- Short interest ${fmtPct(stats.shortInterestPct ?? 0, 1)}, Institutional own ${fmtPct(stats.institutionOwnPct ?? 0, 0)}, Insider ${fmtPct(stats.insiderOwnPct ?? 0, 1)}`);
  lines.push("");
  lines.push("EARNINGS (last 8 quarters, EPS est → actual):");
  for (const h of history.slice(0, 8)) {
    lines.push(`- ${h.period} (${h.reportDate}): est $${fmtPrice(h.epsEstimate ?? 0)} → act $${fmtPrice(h.epsActual ?? 0)} (${fmtPct(h.epsSurprisePct ?? 0, 1, true)})`);
  }
  lines.push(`Beat rate: ${fmtPct((drivers.beatRate ?? 0) * 100, 0)} of last 8.`);
  if (upcoming) lines.push(`NEXT EARNINGS: ${upcoming.fiscalPeriod} on ${upcoming.date} (${upcoming.time}). Street EPS est $${fmtPrice(upcoming.epsEstimate ?? 0)}, ${upcoming.analystCount} analysts.`);
  lines.push("");
  if (analyst) {
    const c = analyst.consensus;
    lines.push(`ANALYSTS: consensus ${c.rating} (${c.distribution.strongBuy} strong buy / ${c.distribution.buy} buy / ${c.distribution.hold} hold / ${c.distribution.sell} sell / ${c.distribution.strongSell} strong sell).`);
    lines.push(`Price targets: low $${fmtPrice(c.priceTargetLow)}, avg $${fmtPrice(c.priceTargetAvg)}, high $${fmtPrice(c.priceTargetHigh)} (avg implies ${fmtPct(drivers.analystUpsidePct ?? 0, 0, true)}).`);
  } else {
    lines.push("ANALYSTS: no sell-side coverage available.");
  }
  lines.push("");
  lines.push(`PRICE ACTION: 6-month momentum ${fmtPct(drivers.momentum6m ?? 0, 0, true)}, annualised volatility ${fmtPct(drivers.annualisedVol ?? 0, 0)}, beta ${stats.beta}.`);
  lines.push("");
  lines.push(`DETERMINISTIC 12-MONTH FORECAST (Parallax engine, ${forecast.confidence} confidence, ${forecast.coverage} coverage):`);
  lines.push(`- Bear $${fmtPrice(forecast.bearCase.priceTarget)} | Base $${fmtPrice(forecast.baseCase.priceTarget)} | Bull $${fmtPrice(forecast.bullCase.priceTarget)}`);
  lines.push(`- Base assumptions: revenue +${fmtPct(forecast.baseCase.revenueGrowth, 0)}, EPS $${fmtPrice(forecast.baseCase.epsEstimate)}, forward P/E ${fmtMult(forecast.baseCase.forwardPE)}`);
  lines.push("");
  lines.push("RECENT NEWS HEADLINES:");
  for (const a of news) lines.push(`- [${a.source}] ${a.headline}`);

  return {
    ticker,
    name: profile.name,
    text: lines.join("\n"),
    suggestions: buildSuggestions(entry.tags, !!analyst, drivers),
  };
}

function buildSuggestions(tags: string[], hasAnalyst: boolean, d: ReturnType<typeof computeDrivers>): string[] {
  const s = [
    "Analyse the current valuation",
    "Explain the latest earnings",
    "Bull vs bear case",
    "What could move the stock next?",
  ];
  if (d.sharesDilutionYoY != null && d.sharesDilutionYoY > 5) s.push("Is dilution a concern here?");
  if (d.cashRunwayMonths != null) s.push("How long is the cash runway?");
  if (hasAnalyst) s.push("How likely is a beat next quarter?");
  s.push("What are the biggest risks?");
  return s.slice(0, 6);
}

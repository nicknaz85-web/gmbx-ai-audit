import type {
  ScenarioForecast, ForecastScenario, DataCoverage, Confidence, RiskLevel,
  EarningsForecast, InvestmentThesis,
} from "@/types";
import type { UniverseEntry } from "@/lib/api/mock/universe";
import { getModel } from "@/lib/api/mock/model";
import { genQuote, genUpcomingEarnings, genAnalyst } from "@/lib/api/mock/generators";
import { computeDrivers } from "./drivers";
import { fmtMult, fmtPct } from "@/lib/format";

export const MODEL_VERSION = "parallax-forecast-1.0";

/* Structured forecast pipeline.
   1. Compute deterministic drivers.
   2. Assess data coverage & confidence from what's actually available.
   3. Build bear/base/bull scenarios by projecting revenue → EPS → applying a
      forward multiple, anchored to the company's own valuation history and the
      analyst target range.
   4. Produce thesis/risks/catalysts.
   The AI layer (server route) may rewrite the prose theses, but the numbers
   below are the source of truth and are shown to the user for transparency. */

export function generateScenarioForecast(entry: UniverseEntry): ScenarioForecast {
  const m = getModel(entry);
  const q = genQuote(entry);
  const price = q.price;
  const drivers = computeDrivers(entry);
  const analyst = genAnalyst(entry);

  const coverage = assessCoverage(entry, !!analyst);
  const baseGrowth = drivers.revenueCagr3y ?? m.revenueGrowth;
  const currentFwdPE = drivers.currentForwardPE ?? m.peForward ?? 22;
  const histPE = drivers.historicalPE ?? currentFwdPE;

  // Dispersion widens for higher volatility / lower coverage.
  const volFactor = Math.min(0.6, (drivers.annualisedVol ?? 45) / 100);
  const disp = Math.min(0.42, 0.14 + volFactor * 0.5 + (coverage === "Limited" ? 0.12 : coverage === "Moderate" ? 0.05 : 0));

  const profitable = m.epsForward > 0;

  function scenario(kind: "bear" | "base" | "bull"): ForecastScenario {
    // Growth: bull accelerates, bear decelerates harder (demand cycle / competition).
    const gAdj = kind === "bull" ? 1 + disp : kind === "bear" ? 1 - disp * 1.4 : 1;
    const revenueGrowth = baseGrowth * gAdj;
    // EPS one year out grows off the current NTM estimate at the kind's rate.
    const epsGrowth = (drivers.epsCagr3y ?? revenueGrowth) * gAdj;
    const epsEstimate = m.epsForward * (1 + epsGrowth / 100);
    // Exit multiple anchor: blend today's forward P/E, the 5y median, and a
    // PEG-fair multiple (~1.6× growth). The fair-value pull makes rich multiples
    // mean-revert so mega-caps don't imply +50% base cases. Bull re-rates, bear
    // compresses hard (the dominant driver of downside for high-multiple names).
    const fairPE = clamp(1.6 * Math.max(baseGrowth, 4), 11, 55);
    const peBlend = 0.5 * currentFwdPE + 0.3 * histPE + 0.2 * fairPE;
    // Growth fade: fast growers rarely sustain their multiple over 12 months, so
    // the exit multiple compresses more the higher the growth rate. Keeps base
    // returns realistic instead of simply equalling the EPS growth rate.
    const peFade = 1 - clamp((baseGrowth - 12) * 0.007, 0, 0.34);
    const forwardPE =
      (kind === "bull" ? peBlend * (1 + disp * 0.9) :
       kind === "bear" ? peBlend * (1 - disp * 1.6) :
       peBlend * (1 - disp * 0.12)) * peFade;

    let priceTarget: number;
    if (profitable) {
      priceTarget = epsEstimate * forwardPE;
    } else {
      // Pre-profit: value off revenue multiple instead of P/E.
      const psNow = getModel(entry).price * m.shares / m.revenueTTM;
      const psAdj = kind === "bull" ? psNow * (1 + disp) : kind === "bear" ? psNow * (1 - disp) : psNow;
      const fwdRev = m.revenueTTM * (1 + revenueGrowth / 100);
      priceTarget = (fwdRev * psAdj) / m.shares;
    }
    // Blend a portion of the analyst target range to keep targets grounded,
    // but let the model's own scenario dominate so the bear case retains its
    // downside rather than being anchored back up to the low target.
    if (analyst) {
      const anchor = kind === "bull" ? analyst.consensus.priceTargetHigh
        : kind === "bear" ? analyst.consensus.priceTargetLow
        : analyst.consensus.priceTargetAvg;
      priceTarget = priceTarget * 0.78 + anchor * 0.22;
    }
    return {
      priceTarget: round2(priceTarget),
      probability: kind === "base" ? 0.5 : 0.25,
      revenueGrowth: round1(revenueGrowth),
      epsEstimate: round2(epsEstimate),
      forwardPE: round1(forwardPE),
      thesis: thesisFor(kind, entry, revenueGrowth, forwardPE, drivers),
    };
  }

  const bearCase = scenario("bear");
  const baseCase = scenario("base");
  const bullCase = scenario("bull");

  const confidence: Confidence =
    coverage === "High" && (drivers.annualisedVol ?? 99) < 40 ? "High"
      : coverage === "Limited" || (drivers.annualisedVol ?? 0) > 65 ? "Low"
      : "Moderate";

  return {
    ticker: entry.ticker,
    generatedAt: Date.now(),
    currentPrice: round2(price),
    timeHorizonMonths: 12,
    coverage,
    confidence,
    bearCase, baseCase, bullCase,
    risks: buildRisks(entry, drivers),
    catalysts: buildCatalysts(entry),
    summary: buildSummary(entry, baseCase, bullCase, bearCase, drivers),
    drivers,
    modelVersion: MODEL_VERSION,
  };
}

function assessCoverage(entry: UniverseEntry, hasAnalyst: boolean): DataCoverage {
  if (!hasAnalyst) return "Limited";
  if (entry.tags.includes("microcap")) return "Limited";
  if (entry.tags.includes("small")) return "Moderate";
  if (!entry.profitable) return "Moderate";
  return "High";
}

function thesisFor(kind: string, entry: UniverseEntry, g: number, pe: number, d: ReturnType<typeof computeDrivers>): string {
  if (kind === "bull") {
    return `Revenue compounds near ${fmtPct(g, 0)} as ${entry.name.split(" ")[0]} extends its position; the market awards a ${fmtMult(pe)} forward multiple on accelerating growth and margin gains.`;
  }
  if (kind === "bear") {
    return `Growth decelerates toward ${fmtPct(g, 0)} amid competition or a softer demand cycle, and the multiple compresses to ${fmtMult(pe)} as sentiment normalises.`;
  }
  return `Revenue grows ~${fmtPct(g, 0)} in line with the 3-year trend; the multiple settles near ${fmtMult(pe)}, between today's level and the company's historical median.`;
}

function buildRisks(entry: UniverseEntry, d: ReturnType<typeof computeDrivers>): ScenarioForecast["risks"] {
  const risks: ScenarioForecast["risks"] = [];
  const lvl = (v: boolean, hi: RiskLevel = "High", lo: RiskLevel = "Low"): RiskLevel => (v ? hi : lo);

  risks.push({
    category: "Valuation",
    level: (d.peVs5yMedianPct ?? 0) > 25 ? "High" : (d.peVs5yMedianPct ?? 0) > 5 ? "Medium" : "Low",
    note: d.peVs5yMedianPct != null
      ? `Forward multiple sits ${fmtPct(d.peVs5yMedianPct, 0)} vs the company's own 5-yr median.`
      : "Limited valuation history available.",
  });
  risks.push({
    category: "Dilution",
    level: (d.sharesDilutionYoY ?? 0) > 10 ? "High" : (d.sharesDilutionYoY ?? 0) > 3 ? "Medium" : "Low",
    note: `Shares outstanding changed ${fmtPct(d.sharesDilutionYoY ?? 0, 1, true)} YoY.`,
  });
  risks.push({
    category: "Balance Sheet",
    level: d.cashRunwayMonths != null && d.cashRunwayMonths < 18 ? "High" : (d.netDebtToEbitda ?? 0) > 3 ? "Medium" : "Low",
    note: d.cashRunwayMonths != null
      ? `Estimated cash runway ~${d.cashRunwayMonths} months at the current burn rate.`
      : `Net debt / EBITDA of ${d.netDebtToEbitda != null ? d.netDebtToEbitda.toFixed(1) + "x" : "n/a"}.`,
  });
  risks.push({
    category: "Volatility",
    level: (d.annualisedVol ?? 0) > 55 ? "High" : (d.annualisedVol ?? 0) > 35 ? "Medium" : "Low",
    note: `Annualised volatility ~${fmtPct(d.annualisedVol ?? 0, 0)}.`,
  });
  risks.push({
    category: "Competition",
    level: lvl(entry.sector === "Technology" || entry.tags.includes("semis"), "Medium", "Low"),
    note: `Operates in the ${entry.industry.toLowerCase()} market where competitive intensity is a persistent factor.`,
  });
  return risks;
}

function buildCatalysts(entry: UniverseEntry): ScenarioForecast["catalysts"] {
  const upc = genUpcomingEarnings(entry);
  const cats: ScenarioForecast["catalysts"] = [
    { date: upc.date, title: `${upc.fiscalPeriod} earnings report`, kind: "Earnings" },
  ];
  const now = Date.now();
  const day = 86400000;
  cats.push({ date: new Date(now + 40 * day).toISOString().slice(0, 10), title: "Industry conference / product event", kind: "Event" });
  if (entry.sector === "Healthcare") cats.push({ date: new Date(now + 75 * day).toISOString().slice(0, 10), title: "Clinical / regulatory milestone", kind: "Regulatory" });
  if (entry.sector === "Technology") cats.push({ date: new Date(now + 90 * day).toISOString().slice(0, 10), title: "Product cycle / capacity update", kind: "Product" });
  cats.push({ date: new Date(now + 30 * day).toISOString().slice(0, 10), title: "Macro: CPI & Fed decision", kind: "Macro" });
  return cats.sort((a, b) => a.date.localeCompare(b.date));
}

function buildSummary(entry: UniverseEntry, base: ForecastScenario, bull: ForecastScenario, bear: ForecastScenario, d: ReturnType<typeof computeDrivers>): string {
  const up = ((base.priceTarget - getModel(entry).price) / getModel(entry).price) * 100;
  return `Base case implies ${fmtPct(up, 0, true)} over 12 months, driven by ~${fmtPct(base.revenueGrowth, 0)} revenue growth and a ${fmtMult(base.forwardPE)} forward multiple. The bull/bear spread (${fmtMult(bull.priceTarget / bear.priceTarget, 1)} range) reflects ${(d.annualisedVol ?? 0) > 50 ? "elevated" : "moderate"} volatility and ${d.analystUpsidePct != null ? "sell-side coverage" : "limited external coverage"}.`;
}

/* ------------------------------------------------- earnings AI estimate --- */
export function generateEarningsForecast(entry: UniverseEntry): EarningsForecast {
  const m = getModel(entry);
  const upc = genUpcomingEarnings(entry);
  const d = computeDrivers(entry);
  const beatRate = d.beatRate ?? 0.5;

  const street = upc.epsEstimate;
  // AI estimate nudges the street number by historical surprise tendency.
  const surpriseBias = (beatRate - 0.5) * 0.06; // up to ±3%
  const aiEps = street != null ? street * (1 + surpriseBias) : m.epsForward / 4;
  const spread = Math.abs(aiEps) * (0.03 + (d.annualisedVol ?? 40) / 1000);

  const beatProb = clamp(0.34 + (beatRate - 0.5) * 0.7 + (d.momentum6m ?? 0) / 800, 0.12, 0.72);
  const missProb = clamp(0.5 - (beatRate - 0.5) * 0.6 - (d.momentum6m ?? 0) / 900, 0.1, 0.6);
  const inlineProb = clamp(1 - beatProb - missProb, 0.08, 0.6);
  const norm = beatProb + inlineProb + missProb;

  const vol = d.annualisedVol ?? 45;
  const moveBase = vol / Math.sqrt(252) * 3.2; // ~post-earnings gap magnitude %

  return {
    fiscalPeriod: upc.fiscalPeriod,
    streetEps: street,
    aiEps: round2(aiEps),
    aiEpsLow: round2(aiEps - spread),
    aiEpsHigh: round2(aiEps + spread),
    streetRevenue: upc.revEstimate,
    aiRevenue: (upc.revEstimate ?? m.revenueTTM / 4) * (1 + surpriseBias * 0.5),
    beatProb: round2(beatProb / norm),
    inlineProb: round2(inlineProb / norm),
    missProb: round2(missProb / norm),
    factors: [
      `Beat ${Math.round(beatRate * 8)} of the last 8 quarters (${fmtPct(beatRate * 100, 0)} rate).`,
      `6-month price momentum ${fmtPct(d.momentum6m ?? 0, 0, true)}.`,
      d.sharesDilutionYoY != null ? `Share count ${fmtPct(d.sharesDilutionYoY, 1, true)} YoY affects per-share figures.` : "Stable share count.",
      `Revenue trend ~${fmtPct(d.revenueCagr3y ?? 0, 0)} supports the top-line estimate.`,
    ],
    reactions: [
      { scenario: "Strong Beat", low: round1(moveBase * 1.2), high: round1(moveBase * 2.6), note: "Beat + raised guidance" },
      { scenario: "In Line", low: round1(-moveBase), high: round1(moveBase * 1.1), note: "Result near consensus" },
      { scenario: "Miss", low: round1(-moveBase * 2.8), high: round1(-moveBase * 1.1), note: "Miss or softer guidance" },
    ],
  };
}

/* ------------------------------------------------------ investment thesis -- */
export function generateThesis(entry: UniverseEntry): InvestmentThesis {
  const m = getModel(entry);
  const d = computeDrivers(entry);
  const first = entry.name.split(/[ ,]/)[0];
  return {
    bull: [
      `Revenue growing ~${fmtPct(d.revenueCagr3y ?? 0, 0)} on a 3-year basis with ${m.grossMargin > 55 ? "high" : "improving"} gross margins (${fmtPct(m.grossMargin, 0)}).`,
      `${d.analystUpsidePct != null && d.analystUpsidePct > 0 ? `Sell-side sees ${fmtPct(d.analystUpsidePct, 0)} upside to the average target.` : "Operating leverage could expand margins as scale builds."}`,
      m.fcfMargin > 0 ? `Free-cash-flow generative (${fmtPct(m.fcfMargin, 0)} FCF margin), funding buybacks or reinvestment.` : `Path to profitability as the model scales toward breakeven.`,
    ],
    bear: [
      d.peVs5yMedianPct != null && d.peVs5yMedianPct > 15 ? `Valuation stretched: forward multiple ${fmtPct(d.peVs5yMedianPct, 0)} above the 5-yr median.` : `Multiple leaves limited margin for execution error.`,
      d.sharesDilutionYoY != null && d.sharesDilutionYoY > 5 ? `Dilution of ${fmtPct(d.sharesDilutionYoY, 1, true)} YoY erodes per-share value.` : `Competitive intensity in ${entry.industry.toLowerCase()} could pressure share and pricing.`,
      d.cashRunwayMonths != null ? `Cash runway ~${d.cashRunwayMonths} months requires disciplined spending or further capital.` : `Cyclical demand swings can compress near-term estimates.`,
    ],
    catalysts: [`${first}'s next earnings report`, "Product / capacity announcements", "Analyst revisions", "Macro: rate path & CPI"],
    risks: ["Valuation", "Competition", d.sharesDilutionYoY && d.sharesDilutionYoY > 5 ? "Dilution" : "Execution", d.annualisedVol && d.annualisedVol > 55 ? "Volatility" : "Macro"],
    whatMattersNext: `The next print and guidance are the key swing factor — the market is focused on whether ${fmtPct(d.revenueCagr3y ?? 0, 0)} growth is sustaining and whether margins are inflecting.`,
    valuationSummary: d.peVs5yMedianPct != null
      ? `Forward P/E of ${fmtMult(m.peForward ?? 0)} is ${fmtPct(d.peVs5yMedianPct, 0)} versus the company's 5-year median of ${fmtMult(d.historicalPE ?? 0)}.`
      : `Valued on a revenue multiple given pre-profit status; price/sales of ${fmtMult((getModel(entry).price * m.shares) / m.revenueTTM)}.`,
  };
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function round1(v: number) { return Math.round(v * 10) / 10; }
function round2(v: number) { return Math.round(v * 100) / 100; }

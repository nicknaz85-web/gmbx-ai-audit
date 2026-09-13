import type { UniverseEntry } from "./universe";
import { Rng } from "./rng";

/* A single derived financial model per company. Everything downstream — quote,
   statements, earnings, valuation, forecast drivers — reads from this so the
   numbers reconcile (market cap = price × shares, EPS = net income / shares,
   P/E = price / EPS, and so on). This is what makes the mock feel like a real
   company rather than a bag of unrelated random figures. */

export interface CompanyModel {
  entry: UniverseEntry;
  shares: number; // basic/diluted shares outstanding
  sharesYoY: number; // dilution %, positive = more shares
  price: number; // anchor (previous close basis)
  revenueTTM: number;
  revenueGrowth: number; // yoy %
  revenueCagr3y: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  fcfMargin: number;
  netIncomeTTM: number;
  epsTTM: number;
  epsGrowth: number;
  peTTM: number | null;
  peForward: number | null;
  epsForward: number;
  revenueFwdGrowth: number;
  cash: number;
  totalDebt: number;
  ebitda: number;
  fcfTTM: number;
  dividendYield: number | null;
  beta: number;
  annualVol: number; // annualised volatility (fraction)
  drift: number; // annual expected drift for price history
  beatRate: number; // fraction of quarters historically beaten
  historicalPE: number | null; // 5y median P/E
}

function marginsFor(entry: UniverseEntry, r: Rng) {
  const sec = entry.sector;
  let gm: number, om: number, nm: number, fcfm: number;
  if (entry.tags.includes("semis")) {
    gm = r.range(45, 68); om = r.range(20, 42); nm = r.range(15, 35); fcfm = r.range(12, 30);
  } else if (sec === "Technology" || sec === "Communication Services") {
    gm = r.range(58, 82); om = r.range(18, 40); nm = r.range(14, 33); fcfm = r.range(14, 32);
  } else if (sec === "Financial Services") {
    gm = r.range(55, 90); om = r.range(30, 55); nm = r.range(22, 40); fcfm = r.range(18, 36);
  } else if (sec === "Healthcare") {
    gm = r.range(55, 80); om = r.range(15, 34); nm = r.range(12, 26); fcfm = r.range(10, 24);
  } else if (sec === "Energy") {
    gm = r.range(28, 44); om = r.range(12, 22); nm = r.range(8, 16); fcfm = r.range(8, 18);
  } else if (sec === "Consumer Defensive") {
    gm = r.range(30, 55); om = r.range(12, 24); nm = r.range(8, 18); fcfm = r.range(8, 16);
  } else {
    gm = r.range(24, 46); om = r.range(6, 18); nm = r.range(4, 13); fcfm = r.range(4, 14);
  }
  return { gm, om, nm, fcfm };
}

export function buildModel(entry: UniverseEntry): CompanyModel {
  const r = new Rng("model:" + entry.ticker);
  const price = entry.base;
  const shares = entry.cap / price;

  // Growth profile
  const hot = entry.tags.some((t) => ["ai", "quantum", "space", "crypto"].includes(t));
  const small = entry.tags.some((t) => ["small", "microcap", "mid"].includes(t));
  let revenueGrowth: number;
  if (!entry.profitable && (hot || small)) revenueGrowth = r.range(28, 120);
  else if (hot) revenueGrowth = r.range(18, 55);
  else if (entry.tags.includes("tech")) revenueGrowth = r.range(8, 26);
  else if (entry.sector === "Energy") revenueGrowth = r.range(-8, 10);
  else revenueGrowth = r.range(2, 14);

  const m = marginsFor(entry, r);
  let netMargin = entry.profitable ? m.nm : -r.range(8, 65);
  let fcfMargin = entry.profitable ? m.fcfm : -r.range(5, 55);

  // Price/Sales anchors valuation → revenue
  let ps: number;
  if (!entry.profitable) ps = r.range(4, 22);
  else if (hot) ps = r.range(9, 26);
  else if (entry.sector === "Technology") ps = r.range(5, 14);
  else if (entry.sector === "Financial Services") ps = r.range(3, 9);
  else if (entry.sector === "Energy") ps = r.range(0.8, 2.2);
  else ps = r.range(1.5, 6);
  const revenueTTM = entry.cap / ps;

  const netIncomeTTM = revenueTTM * (netMargin / 100);
  const epsTTM = netIncomeTTM / shares;
  const peTTM = epsTTM > 0 ? price / epsTTM : null;

  const epsGrowth = entry.profitable ? revenueGrowth * r.range(0.9, 1.5) : r.range(-30, 60);
  const revenueFwdGrowth = revenueGrowth * r.range(0.7, 1.0);
  const epsForward = entry.profitable
    ? epsTTM * (1 + epsGrowth / 100)
    : epsTTM * (1 - r.range(0.1, 0.4)); // losses narrowing
  const peForward = epsForward > 0 ? price / epsForward : null;

  const ebitda = revenueTTM * (m.om / 100) + revenueTTM * 0.05; // rough
  const fcfTTM = revenueTTM * (fcfMargin / 100);
  const cash = revenueTTM * r.range(0.08, 0.55) + (entry.profitable ? 0 : entry.cap * r.range(0.05, 0.25));
  const totalDebt = entry.sector === "Financial Services"
    ? revenueTTM * r.range(0.4, 1.2)
    : revenueTTM * r.range(0.0, 0.6);

  const sharesYoY = !entry.profitable
    ? r.range(2, 28) // dilution common in cash-burning names
    : r.range(-3.5, 3.5);

  const dividendYield = entry.profitable && !hot && r.bool(0.5)
    ? r.range(0.4, 3.6)
    : null;

  const beta = hot || !entry.profitable ? r.range(1.4, 2.7) : r.range(0.6, 1.4);
  const annualVol = Math.min(0.95, 0.18 + beta * r.range(0.08, 0.16) + (!entry.profitable ? 0.2 : 0));
  const drift = entry.profitable ? r.range(-0.05, 0.28) : r.range(-0.25, 0.4);
  const beatRate = r.range(0.45, 0.9);
  const historicalPE = peTTM ? peTTM * r.range(0.7, 1.25) : null;

  // 3y CAGR near current growth, decayed
  const revenueCagr3y = revenueGrowth * r.range(0.7, 1.15);

  return {
    entry, shares, sharesYoY, price, revenueTTM, revenueGrowth, revenueCagr3y,
    grossMargin: m.gm, operatingMargin: m.om, netMargin, fcfMargin,
    netIncomeTTM, epsTTM, epsGrowth, peTTM, peForward, epsForward, revenueFwdGrowth,
    cash, totalDebt, ebitda, fcfTTM, dividendYield, beta, annualVol, drift,
    beatRate, historicalPE,
  };
}

// Small module-level cache — models are pure functions of the ticker.
const cache = new Map<string, CompanyModel>();
export function getModel(entry: UniverseEntry): CompanyModel {
  let m = cache.get(entry.ticker);
  if (!m) {
    m = buildModel(entry);
    cache.set(entry.ticker, m);
  }
  return m;
}

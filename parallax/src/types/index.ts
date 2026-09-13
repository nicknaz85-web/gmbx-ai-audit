/* ===========================================================================
   Domain types for Parallax.
   These describe the shape returned by the data-access layer (src/lib/api) and
   consumed by components. Providers (mock, Finnhub, FMP, …) map their raw
   responses into these types so the UI never depends on a specific vendor.
   =========================================================================== */

export type MarketState = "open" | "closed" | "pre" | "post";
export type Exchange = "NASDAQ" | "NYSE" | "NYSEAMERICAN" | "OTC";
export type Rating = "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
export type Confidence = "Low" | "Moderate" | "High";
export type DataCoverage = "High" | "Moderate" | "Limited";
export type RiskLevel = "Low" | "Medium" | "High";

export interface Quote {
  ticker: string;
  price: number;
  change: number; // absolute, vs previous close
  changePercent: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  avgVolume: number;
  marketState: MarketState;
  extendedPrice?: number; // pre/post-market last
  extendedChange?: number;
  extendedChangePercent?: number;
  asOf: number; // epoch ms
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  exchange: Exchange;
  currency: string;
  sector: string;
  industry: string;
  country: string;
  headquarters: string;
  employees: number;
  ceo: string;
  founded: number;
  website: string;
  description: string;
  logoBg: string; // brand-ish color for the monogram tile
}

export interface KeyStats {
  marketCap: number;
  enterpriseValue: number;
  peTTM: number | null;
  peForward: number | null;
  pegRatio: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  epsTTM: number | null;
  epsForward: number | null;
  revenueTTM: number;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  freeCashFlow: number | null;
  dividendYield: number | null;
  beta: number | null;
  sharesOutstanding: number;
  sharesOutstandingYoY: number | null; // % change — dilution signal
  floatShares: number | null;
  cash: number;
  totalDebt: number;
  ttmFcf: number; // for cash-runway calc
  high52: number;
  low52: number;
  shortInterestPct: number | null;
  insiderOwnPct: number | null;
  institutionOwnPct: number | null;
}

export interface Candle {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type ChartRange = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";

export interface SearchResult {
  ticker: string;
  name: string;
  exchange: Exchange;
  price: number;
  changePercent: number;
  logoBg: string;
}

export interface Mover {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap: number;
  volume: number;
  avgVolume: number;
  pe: number | null;
  sector: string;
  spark: number[];
  logoBg: string;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  spark: number[];
}

export interface EarningsRow {
  period: string; // "Q2 2026"
  reportDate: string; // ISO date
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  revEstimate: number | null; // absolute
  revActual: number | null;
  revSurprisePct: number | null;
}

export interface UpcomingEarnings {
  date: string; // ISO
  time: "BMO" | "AMC" | "TBD";
  epsEstimate: number | null;
  revEstimate: number | null;
  analystCount: number;
  fiscalPeriod: string; // "Q3 2026"
}

export interface StatementLine {
  label: string;
  key: string;
  values: (number | null)[]; // aligned to periods
  emphasis?: "total" | "subtotal" | "normal";
  percent?: boolean; // render as % (margins)
}

export interface FinancialStatements {
  periods: string[]; // column headers, most recent first
  income: StatementLine[];
  balance: StatementLine[];
  cashflow: StatementLine[];
}

export interface AnalystConsensus {
  rating: Rating;
  score: number; // 1 (strong sell) .. 5 (strong buy)
  distribution: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };
  priceTargetHigh: number;
  priceTargetAvg: number;
  priceTargetLow: number;
  updated: string; // ISO
}

export interface AnalystAction {
  date: string;
  firm: string;
  action: "Upgrade" | "Downgrade" | "Initiate" | "Maintain" | "Target Raise" | "Target Cut";
  ratingFrom?: string;
  ratingTo: string;
  targetFrom?: number | null;
  targetTo: number | null;
}

export interface NewsArticle {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: number; // epoch ms
  category: string;
  tickers: string[];
  sentiment: "positive" | "neutral" | "negative";
  imageColor: string; // deterministic placeholder tint
}

export interface InsiderTx {
  name: string;
  role: string;
  type: "Buy" | "Sell";
  shares: number;
  price: number;
  value: number;
  date: string;
}

export interface Institution {
  name: string;
  shares: number;
  value: number;
  changePct: number; // qoq
  portfolioPct: number;
}

export interface Peer {
  ticker: string;
  name: string;
  marketCap: number;
  revenueGrowth: number;
  epsGrowth: number;
  pe: number | null;
  peForward: number | null;
  grossMargin: number;
  netMargin: number;
  perf1Y: number;
  logoBg: string;
}

export interface Filing {
  type: string; // 10-K, 10-Q, 8-K, Form 4 …
  title: string;
  date: string;
  url: string;
}

// -------- Forecasting (deterministic layer + AI interpretation) --------

export interface ForecastScenario {
  priceTarget: number;
  probability: number;
  revenueGrowth: number; // %
  epsEstimate: number;
  forwardPE: number;
  thesis: string;
}

export interface ScenarioForecast {
  ticker: string;
  generatedAt: number;
  currentPrice: number;
  timeHorizonMonths: number;
  coverage: DataCoverage;
  confidence: Confidence;
  bearCase: ForecastScenario;
  baseCase: ForecastScenario;
  bullCase: ForecastScenario;
  risks: { category: string; level: RiskLevel; note: string }[];
  catalysts: { date: string; title: string; kind: string }[];
  summary: string;
  drivers: ForecastDrivers; // deterministic inputs, surfaced for transparency
  modelVersion: string;
}

export interface ForecastDrivers {
  revenueCagr3y: number | null;
  epsCagr3y: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  historicalPE: number | null;
  currentForwardPE: number | null;
  peVs5yMedianPct: number | null;
  momentum6m: number | null;
  annualisedVol: number | null;
  analystUpsidePct: number | null;
  beatRate: number | null; // fraction of last 8 quarters beaten
  netDebtToEbitda: number | null;
  cashRunwayMonths: number | null;
  sharesDilutionYoY: number | null;
}

export interface EarningsForecast {
  fiscalPeriod: string;
  streetEps: number | null;
  aiEps: number;
  aiEpsLow: number;
  aiEpsHigh: number;
  streetRevenue: number | null;
  aiRevenue: number;
  beatProb: number;
  inlineProb: number;
  missProb: number;
  factors: string[];
  reactions: { scenario: string; low: number; high: number; note: string }[];
}

export interface InvestmentThesis {
  bull: string[];
  bear: string[];
  catalysts: string[];
  risks: string[];
  whatMattersNext: string;
  valuationSummary: string;
}

// -------- AI chat --------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: string[];
}

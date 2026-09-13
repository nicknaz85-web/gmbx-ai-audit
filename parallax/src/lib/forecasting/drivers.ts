import type { ForecastDrivers, EarningsRow } from "@/types";
import type { UniverseEntry } from "@/lib/api/mock/universe";
import { getModel } from "@/lib/api/mock/model";
import { genKeyStats, genEarningsHistory, genCandles, genAnalyst } from "@/lib/api/mock/generators";

/* Deterministic driver computation.
   These are ordinary financial calculations — no model involved. The AI layer
   receives these numbers and is asked only to interpret them into scenarios; it
   never manufactures the underlying figures. */

export function computeDrivers(entry: UniverseEntry): ForecastDrivers {
  const m = getModel(entry);
  const stats = genKeyStats(entry);
  const history = genEarningsHistory(entry);
  const analyst = genAnalyst(entry);

  // Momentum: 6-month total return from the daily series.
  const candles = genCandles(entry, "6M");
  const first = candles[0]?.c ?? m.price;
  const last = candles[candles.length - 1]?.c ?? m.price;
  const momentum6m = ((last - first) / first) * 100;

  // Realised volatility (annualised) from daily log returns.
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) rets.push(Math.log(candles[i].c / candles[i - 1].c));
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
  const annualisedVol = Math.sqrt(variance) * Math.sqrt(252) * 100;

  const beatRate = computeBeatRate(history);

  const analystUpsidePct = analyst
    ? ((analyst.consensus.priceTargetAvg - m.price) / m.price) * 100
    : null;

  const netDebt = stats.totalDebt - stats.cash;
  const netDebtToEbitda = m.ebitda > 0 ? netDebt / m.ebitda : null;

  // Cash runway (only meaningful when FCF is negative).
  const cashRunwayMonths = m.fcfTTM < 0 ? (stats.cash / -m.fcfTTM) * 12 : null;

  const peVs5yMedianPct =
    m.peTTM && m.historicalPE ? ((m.peTTM - m.historicalPE) / m.historicalPE) * 100 : null;

  return {
    revenueCagr3y: round(m.revenueCagr3y),
    epsCagr3y: round(m.epsGrowth),
    grossMargin: round(m.grossMargin),
    netMargin: round(m.netMargin),
    fcfMargin: round(m.fcfMargin),
    historicalPE: m.historicalPE ? round(m.historicalPE) : null,
    currentForwardPE: m.peForward ? round(m.peForward) : null,
    peVs5yMedianPct: peVs5yMedianPct != null ? round(peVs5yMedianPct) : null,
    momentum6m: round(momentum6m),
    annualisedVol: round(annualisedVol),
    analystUpsidePct: analystUpsidePct != null ? round(analystUpsidePct) : null,
    beatRate: round(beatRate, 2),
    netDebtToEbitda: netDebtToEbitda != null ? round(netDebtToEbitda, 2) : null,
    cashRunwayMonths: cashRunwayMonths != null ? Math.round(cashRunwayMonths) : null,
    sharesDilutionYoY: stats.sharesOutstandingYoY,
  };
}

export function computeBeatRate(history: EarningsRow[]): number {
  const withActual = history.filter((h) => h.epsActual != null && h.epsEstimate != null);
  if (!withActual.length) return 0.5;
  const beats = withActual.filter((h) => (h.epsActual as number) >= (h.epsEstimate as number)).length;
  return beats / withActual.length;
}

function round(v: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

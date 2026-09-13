import type { KeyStats } from "@/types";
import { Info } from "@/components/common/bits";
import { fmtMoneyCompact, fmtMult, fmtPct, fmtPrice, fmtCompact } from "@/lib/format";
import { cn } from "@/lib/cn";

type Row = { label: string; value: string; tip?: string; tone?: "pos" | "neg" | "warn" };

export function KeyMetrics({ stats }: { stats: KeyStats }) {
  const dil = stats.sharesOutstandingYoY;
  const rows: Row[] = [
    { label: "Market Cap", value: fmtMoneyCompact(stats.marketCap) },
    { label: "Enterprise Value", value: fmtMoneyCompact(stats.enterpriseValue), tip: "Market cap plus total debt minus cash — the cost to acquire the whole business." },
    { label: "P/E (TTM)", value: stats.peTTM ? fmtMult(stats.peTTM) : "—", tip: "Price divided by trailing twelve-month earnings per share." },
    { label: "Forward P/E", value: stats.peForward ? fmtMult(stats.peForward) : "—", tip: "Price divided by expected next-twelve-month EPS." },
    { label: "PEG Ratio", value: stats.pegRatio != null ? stats.pegRatio.toFixed(2) : "—", tip: "Forward P/E divided by expected earnings growth. Below 1 can indicate growth is cheap." },
    { label: "Price / Sales", value: fmtMult(stats.priceToSales) },
    { label: "Price / Book", value: stats.priceToBook ? fmtMult(stats.priceToBook) : "—" },
    { label: "EPS (TTM)", value: stats.epsTTM != null ? `$${fmtPrice(stats.epsTTM)}` : "—" },
    { label: "Forward EPS", value: stats.epsForward != null ? `$${fmtPrice(stats.epsForward)}` : "—" },
    { label: "Revenue (TTM)", value: fmtMoneyCompact(stats.revenueTTM) },
    { label: "Gross Margin", value: stats.grossMargin != null ? fmtPct(stats.grossMargin, 1) : "—" },
    { label: "Operating Margin", value: stats.operatingMargin != null ? fmtPct(stats.operatingMargin, 1) : "—" },
    { label: "Net Margin", value: stats.netMargin != null ? fmtPct(stats.netMargin, 1) : "—", tone: (stats.netMargin ?? 0) < 0 ? "neg" : undefined },
    { label: "Free Cash Flow", value: fmtMoneyCompact(stats.freeCashFlow ?? 0), tone: (stats.freeCashFlow ?? 0) < 0 ? "neg" : undefined },
    { label: "Dividend Yield", value: stats.dividendYield != null ? fmtPct(stats.dividendYield, 2) : "—" },
    { label: "Beta", value: stats.beta != null ? stats.beta.toFixed(2) : "—", tip: "Sensitivity to broad market moves. Above 1 is more volatile than the market." },
    { label: "Shares Out.", value: fmtCompact(stats.sharesOutstanding) },
    { label: "Shares YoY", value: fmtPct(dil ?? 0, 1, true), tip: "Change in share count year-over-year. Positive = dilution.", tone: (dil ?? 0) > 8 ? "warn" : (dil ?? 0) < 0 ? "pos" : undefined },
    { label: "Avg Volume", value: fmtCompact(stats.floatShares ? stats.floatShares * 0.01 : 0, 1) },
    { label: "52W High", value: `$${fmtPrice(stats.high52)}` },
    { label: "52W Low", value: `$${fmtPrice(stats.low52)}` },
    { label: "Short Interest", value: stats.shortInterestPct != null ? fmtPct(stats.shortInterestPct, 1) : "—", tone: (stats.shortInterestPct ?? 0) > 15 ? "warn" : undefined },
    { label: "Inst. Own", value: stats.institutionOwnPct != null ? fmtPct(stats.institutionOwnPct, 0) : "—" },
    { label: "Insider Own", value: stats.insiderOwnPct != null ? fmtPct(stats.insiderOwnPct, 1) : "—" },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0 sm:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between border-b border-line py-2">
          <span className="flex items-center text-[12px] text-muted">
            {r.label}
            {r.tip && <Info tip={r.tip} />}
          </span>
          <span className={cn("tnum text-[13px] font-medium", r.tone === "pos" && "text-pos", r.tone === "neg" && "text-neg", r.tone === "warn" && "text-warn")}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

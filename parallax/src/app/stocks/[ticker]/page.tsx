import { notFound } from "next/navigation";
import Link from "next/link";
import { provider } from "@/lib/api";
import { findEntry } from "@/lib/api/mock/universe";
import {
  generateScenarioForecast, generateEarningsForecast, generateThesis,
} from "@/lib/forecasting/generateScenarioForecast";
import type { ForecastDrivers } from "@/types";

import { StockHeader } from "@/components/stocks/StockHeader";
import { StockTabs, type TabDef } from "@/components/stocks/StockTabs";
import { PriceChart } from "@/components/charts/PriceChart";
import { AIOutlook } from "@/components/ai/AIOutlook";
import { AIPanel, AskAILink } from "@/components/ai/AIPanel";
import { KeyMetrics } from "@/components/stocks/KeyMetrics";
import { CompanyOverview } from "@/components/stocks/CompanyOverview";
import { AnalystPanel } from "@/components/stocks/AnalystPanel";
import { FinancialsSection } from "@/components/financials/FinancialsSection";
import { FundamentalTrends } from "@/components/financials/FundamentalTrends";
import { EarningsHistory, NextEarnings } from "@/components/earnings/EarningsHistory";
import { EarningsBars } from "@/components/earnings/EarningsBars";
import { EarningsAIEstimate } from "@/components/earnings/EarningsAIEstimate";
import { InsiderTable, InstitutionTable, PeerTable } from "@/components/stocks/Ownership";
import { FilingsList } from "@/components/stocks/Filings";
import { ThesisView, RiskList, CatalystList } from "@/components/ai/ThesisView";
import { NewsList } from "@/components/news/NewsList";
import { Panel, EmptyState } from "@/components/common/Panel";
import { fmtPct, fmtMult } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  const entry = findEntry(ticker);
  if (!entry) notFound();

  const [profile, quote, candles, stats, finAnnual, finQuarterly, earnings, upcoming, analyst, insiders, institutions, peers, filings, news] =
    await Promise.all([
      provider.profile(ticker),
      provider.quote(ticker),
      provider.candles(ticker, "1M"),
      provider.keyStats(ticker),
      provider.financials(ticker, true),
      provider.financials(ticker, false),
      provider.earningsHistory(ticker),
      provider.upcomingEarnings(ticker),
      provider.analyst(ticker),
      provider.insiders(ticker),
      provider.institutions(ticker),
      provider.peers(ticker),
      provider.filings(ticker),
      provider.news({ ticker, limit: 10 }),
    ]);

  if (!profile || !quote || !stats || !finAnnual || !finQuarterly) notFound();

  const forecast = generateScenarioForecast(entry);
  const thesis = generateThesis(entry);
  const earningsForecast = generateEarningsForecast(entry);

  const suggestions = [
    "Analyse the current valuation",
    "Explain the latest earnings",
    "Bull vs bear case",
    "What could move the stock next?",
    analyst ? "How likely is a beat next quarter?" : "What are the biggest risks?",
    (stats.sharesOutstandingYoY ?? 0) > 5 ? "Is dilution a concern here?" : "Summarise the latest news",
  ];

  const tabs: TabDef[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-8">
            <Panel title="Key Statistics" bodyClassName="px-4 pt-1 pb-1">
              <KeyMetrics stats={stats} />
            </Panel>
            <Panel title="About">
              <CompanyOverview profile={profile} />
            </Panel>
            <Panel title="Latest News" action={<Link href="/news" className="text-[11px] text-muted hover:text-text">More →</Link>}>
              <NewsList items={news.slice(0, 5)} variant="compact" />
            </Panel>
          </div>
          <div className="space-y-5 lg:col-span-4">
            <Panel title="Next Earnings">
              {upcoming ? <NextEarnings e={upcoming} /> : <EmptyState title="No scheduled earnings" />}
            </Panel>
            <Panel title="Analyst Target">
              <AnalystPanel data={analyst} price={quote.price} />
            </Panel>
            <Panel title="Peers">
              <PeerTable rows={peers} />
            </Panel>
          </div>
        </div>
      ),
    },
    {
      id: "financials",
      label: "Financials",
      content: (
        <div className="space-y-5">
          <Panel title="Fundamental Trends" bodyClassName="">
            <FundamentalTrends annual={finAnnual} />
          </Panel>
          <Panel title="Financial Statements" bodyClassName="">
            <FinancialsSection annual={finAnnual} quarterly={finQuarterly} />
          </Panel>
        </div>
      ),
    },
    {
      id: "earnings",
      label: "Earnings",
      content: (
        <div className="space-y-5">
          {upcoming && (
            <Panel title="Next Earnings">
              <NextEarnings e={upcoming} />
            </Panel>
          )}
          <Panel title="Earnings vs Estimates">
            <div className="p-4"><EarningsBars rows={earnings} /></div>
          </Panel>
          <Panel title="Quarterly Earnings History">
            <EarningsHistory rows={earnings} />
          </Panel>
          <Panel
            title={<h2 className="panel-title">AI Earnings Estimate</h2>}
          >
            <EarningsAIEstimate f={earningsForecast} />
          </Panel>
        </div>
      ),
    },
    {
      id: "forecast",
      label: "Forecast",
      content: (
        <div className="space-y-5">
          <AIOutlook forecast={forecast} />
          <Panel title="Deterministic Drivers" action={<span className="text-[11px] text-faint">Computed before AI interpretation</span>}>
            <DriversTable d={forecast.drivers} />
          </Panel>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="AI-Assessed Risks"><RiskList risks={forecast.risks} /></Panel>
            <Panel title="Upcoming Catalysts"><CatalystList catalysts={forecast.catalysts} /></Panel>
          </div>
        </div>
      ),
    },
    {
      id: "news",
      label: "News",
      content: (
        <Panel title={`News · ${ticker}`}>
          {news.length ? <NewsList items={news} /> : <EmptyState title="No recent news" />}
        </Panel>
      ),
    },
    {
      id: "ownership",
      label: "Ownership",
      content: (
        <div className="space-y-5">
          <Panel title="Institutional Ownership" action={<span className="text-[11px] text-faint">{fmtPct(stats.institutionOwnPct ?? 0, 0)} of shares</span>}>
            <InstitutionTable rows={institutions} />
          </Panel>
          <Panel title="Insider Activity" action={<span className="text-[11px] text-faint">{fmtPct(stats.insiderOwnPct ?? 0, 1)} insider owned</span>}>
            <InsiderTable rows={insiders} />
          </Panel>
        </div>
      ),
    },
    {
      id: "filings",
      label: "Filings",
      content: (
        <Panel title="SEC Filings" action={<span className="text-[11px] text-faint">via EDGAR</span>}>
          <FilingsList filings={filings} />
        </Panel>
      ),
    },
    {
      id: "ai",
      label: "AI Analysis",
      content: (
        <div className="space-y-5">
          <Panel
            title="Investment Thesis"
            action={<AskAILink />}
          >
            <ThesisView thesis={thesis} />
          </Panel>
          <AIOutlook forecast={forecast} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-[12px] text-faint">
        <Link href="/" className="hover:text-text">Markets</Link>
        <span>/</span>
        <span className="text-muted">{profile.sector}</span>
        <span>/</span>
        <span className="text-text">{ticker}</span>
      </nav>

      <StockHeader profile={profile} quote={quote} />

      <Panel bodyClassName="p-3 sm:p-4">
        <PriceChart ticker={ticker} initial={candles} initialRange="1M" />
      </Panel>

      <AIOutlook forecast={forecast} />

      <StockTabs tabs={tabs} />

      <AIPanel ticker={ticker} name={profile.name} suggestions={suggestions} />
    </div>
  );
}

function DriversTable({ d }: { d: ForecastDrivers }) {
  const rows: [string, string][] = [
    ["Revenue CAGR (3y)", d.revenueCagr3y != null ? fmtPct(d.revenueCagr3y, 1) : "—"],
    ["EPS growth", d.epsCagr3y != null ? fmtPct(d.epsCagr3y, 1) : "—"],
    ["Gross margin", d.grossMargin != null ? fmtPct(d.grossMargin, 1) : "—"],
    ["Net margin", d.netMargin != null ? fmtPct(d.netMargin, 1) : "—"],
    ["FCF margin", d.fcfMargin != null ? fmtPct(d.fcfMargin, 1) : "—"],
    ["Forward P/E", d.currentForwardPE != null ? fmtMult(d.currentForwardPE) : "—"],
    ["5y median P/E", d.historicalPE != null ? fmtMult(d.historicalPE) : "—"],
    ["P/E vs 5y median", d.peVs5yMedianPct != null ? fmtPct(d.peVs5yMedianPct, 0, true) : "—"],
    ["6-month momentum", d.momentum6m != null ? fmtPct(d.momentum6m, 0, true) : "—"],
    ["Annualised volatility", d.annualisedVol != null ? fmtPct(d.annualisedVol, 0) : "—"],
    ["Analyst upside", d.analystUpsidePct != null ? fmtPct(d.analystUpsidePct, 0, true) : "—"],
    ["EPS beat rate (8q)", d.beatRate != null ? fmtPct(d.beatRate * 100, 0) : "—"],
    ["Net debt / EBITDA", d.netDebtToEbitda != null ? fmtMult(d.netDebtToEbitda) : "—"],
    ["Cash runway", d.cashRunwayMonths != null ? `${d.cashRunwayMonths} mo` : "n/a (FCF+)"],
    ["Dilution (YoY)", d.sharesDilutionYoY != null ? fmtPct(d.sharesDilutionYoY, 1, true) : "—"],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0 px-4 py-1 sm:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-line py-2">
          <span className="text-[12px] text-muted">{k}</span>
          <span className="tnum text-[13px] font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

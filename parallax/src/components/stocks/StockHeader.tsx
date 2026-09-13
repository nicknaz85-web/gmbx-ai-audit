"use client";
import type { CompanyProfile, Quote } from "@/types";
import { Monogram } from "@/components/common/Monogram";
import { useWatchlist } from "@/hooks/useWatchlist";
import { openAIPanel } from "@/components/ai/AIPanel";
import { RelativeTime } from "@/components/common/RelativeTime";
import { fmtPrice, fmtPct, marketStateLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

export function StockHeader({ profile, quote }: { profile: CompanyProfile; quote: Quote }) {
  const { has, toggle, ready } = useWatchlist();
  const saved = ready && has(profile.ticker);
  const up = quote.change >= 0;
  const stateTone = quote.marketState === "open" ? "text-pos" : quote.marketState === "closed" ? "text-faint" : "text-warn";

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3.5">
        <Monogram ticker={profile.ticker} bg={profile.logoBg} size={44} />
        <div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-xl font-semibold leading-none tracking-[-0.01em]">{profile.name}</h1>
            <span className="rounded border border-line-2 bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">{profile.exchange}: {profile.ticker}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="tnum text-[32px] font-semibold leading-none">${fmtPrice(quote.price)}</span>
            <span className={cn("tnum mb-0.5 text-[15px] font-medium", up ? "text-pos" : "text-neg")}>
              {up ? "+" : "−"}{fmtPrice(Math.abs(quote.change))} ({up ? "+" : ""}{fmtPct(quote.changePercent, 2)})
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className={cn("inline-flex items-center gap-1.5", stateTone)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", quote.marketState === "open" ? "bg-pos" : quote.marketState === "closed" ? "bg-faint" : "bg-warn")} />
              {marketStateLabel(quote.marketState)}
            </span>
            {quote.extendedPrice != null && quote.extendedChangePercent != null && (
              <span className="text-muted">
                {quote.marketState === "post" ? "After hours" : "Pre-market"}: <span className="tnum text-text">${fmtPrice(quote.extendedPrice)}</span>{" "}
                <span className={cn("tnum", quote.extendedChangePercent >= 0 ? "text-pos" : "text-neg")}>
                  ({quote.extendedChangePercent >= 0 ? "+" : ""}{fmtPct(quote.extendedChangePercent, 2)})
                </span>
              </span>
            )}
            <RelativeTime epochMs={quote.asOf} prefix="Updated " className="tnum text-faint" />
          </div>
        </div>
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <button
          onClick={() => toggle(profile.ticker)}
          className={cn("btn flex-1 sm:flex-none", saved && "!border-warn/40 !text-warn")}
          title={saved ? "Remove from watchlist" : "Add to watchlist"}
        >
          <span className="text-[13px]">{saved ? "★" : "☆"}</span>
          {saved ? "Watching" : "Watchlist"}
        </button>
        <button className="btn flex-1 sm:flex-none" title="Price & event alerts (coming soon)">
          <BellIcon /> Alerts
        </button>
        <button onClick={openAIPanel} className="btn btn-primary flex-1 sm:flex-none">
          <span className="text-[11px] font-bold">AI</span> Ask AI
        </button>
      </div>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

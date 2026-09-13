import Link from "next/link";
import { provider } from "@/lib/api";
import { genIndexHistory } from "@/lib/api/mock/market";
import { IndexStrip } from "@/components/stocks/IndexStrip";
import { MoversTable } from "@/components/stocks/MoversTable";
import { NewsList } from "@/components/news/NewsList";
import { MiniArea } from "@/components/charts/MiniArea";
import { Panel } from "@/components/common/Panel";
import { Monogram } from "@/components/common/Monogram";
import { fmtPrice, fmtPct, fmtMoneyCompact, fmtDateShort } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const EARNINGS_SOON = ["NVDA", "TSLA", "PLTR", "CRWD", "SOFI", "IONQ", "ASTS"];

export default async function HomePage() {
  const [indices, movers, news, trending] = await Promise.all([
    provider.indices(),
    provider.movers(),
    provider.news({ limit: 7 }),
    provider.trending(),
  ]);
  const spxHistory = genIndexHistory("SPX", 120);
  const spx = indices.find((i) => i.symbol === "SPX")!;

  const earningsSoon = (
    await Promise.all(
      EARNINGS_SOON.map(async (t) => {
        const [e, p] = await Promise.all([provider.upcomingEarnings(t), provider.profile(t)]);
        return e && p ? { ticker: t, name: p.name, logoBg: p.logoBg, e } : null;
      })
    )
  )
    .filter(Boolean)
    .sort((a, b) => a!.e.date.localeCompare(b!.e.date))
    .slice(0, 6) as { ticker: string; name: string; logoBg: string; e: NonNullable<Awaited<ReturnType<typeof provider.upcomingEarnings>>> }[];

  return (
    <div className="space-y-5">
      <IndexStrip indices={indices} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Main column */}
        <div className="space-y-5 lg:col-span-8">
          <Panel
            title="Market Overview"
            action={
              <div className="flex items-center gap-2">
                <span className="tnum text-sm font-semibold">{fmtPrice(spx.price, 0)}</span>
                <span className={cn("tnum text-xs font-medium", spx.changePercent >= 0 ? "text-pos" : "text-neg")}>
                  {spx.changePercent >= 0 ? "+" : ""}{fmtPct(spx.changePercent, 2)}
                </span>
                <span className="text-[11px] text-faint">S&amp;P 500 · 6M</span>
              </div>
            }
            bodyClassName="px-2 pb-2 pt-1"
          >
            <MiniArea data={spxHistory} height={190} positive={spx.changePercent >= 0} />
          </Panel>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Panel
              title="Top Gainers"
              action={<Link href="/movers" className="text-[11px] text-muted hover:text-text">View all →</Link>}
            >
              <MoversTable rows={movers.gainers.slice(0, 6)} />
            </Panel>
            <Panel
              title="Top Losers"
              action={<Link href="/movers" className="text-[11px] text-muted hover:text-text">View all →</Link>}
            >
              <MoversTable rows={movers.losers.slice(0, 6)} />
            </Panel>
          </div>

          <Panel
            title="Most Active"
            action={<Link href="/movers" className="text-[11px] text-muted hover:text-text">All movers →</Link>}
          >
            <MoversTable rows={movers.active.slice(0, 8)} variant="full" showSector />
          </Panel>
        </div>

        {/* Sidebar */}
        <div className="space-y-5 lg:col-span-4">
          <Panel title="Trending">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-md bg-line">
              {trending.slice(0, 6).map((m) => (
                <Link key={m.ticker} href={`/stocks/${m.ticker}`} className="flex flex-col gap-1 bg-surface px-3 py-2.5 hover:bg-surface-2">
                  <div className="flex items-center gap-2">
                    <Monogram ticker={m.ticker} bg={m.logoBg} size={22} />
                    <span className="text-[13px] font-semibold">{m.ticker}</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="tnum text-xs text-muted">${fmtPrice(m.price)}</span>
                    <span className={cn("tnum text-[11px] font-medium", m.changePercent >= 0 ? "text-pos" : "text-neg")}>
                      {m.changePercent >= 0 ? "+" : ""}{fmtPct(m.changePercent, 2)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel
            title="Earnings Coming Up"
            action={<Link href="/movers" className="text-[11px] text-muted hover:text-text">Calendar →</Link>}
          >
            <div className="divide-y divide-line">
              {earningsSoon.map(({ ticker, name, logoBg, e }) => (
                <Link key={ticker} href={`/stocks/${ticker}`} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2">
                  <Monogram ticker={ticker} bg={logoBg} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold leading-tight">{ticker}</div>
                    <div className="truncate text-[11px] text-faint">{name}</div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-[12px]">{fmtDateShort(e.date)}</div>
                    <div className="text-[11px] text-faint">
                      {e.time} · est ${fmtPrice(e.epsEstimate ?? 0)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel
            title="Breaking News"
            action={<Link href="/news" className="text-[11px] text-muted hover:text-text">All news →</Link>}
          >
            <NewsList items={news} variant="compact" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { NewsArticle } from "@/types";
import { RelativeTime } from "@/components/common/RelativeTime";
import { cn } from "@/lib/cn";

const SENT: Record<NewsArticle["sentiment"], string> = {
  positive: "bg-pos",
  neutral: "bg-faint",
  negative: "bg-neg",
};

export function NewsList({ items, variant = "list" }: { items: NewsArticle[]; variant?: "list" | "compact" }) {
  if (variant === "compact") {
    return (
      <div className="divide-y divide-line">
        {items.map((a) => (
          <article key={a.id} className="px-3 py-2.5">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-faint">
              <span className="font-medium text-muted">{a.source}</span>
              <span>·</span>
              <RelativeTime epochMs={a.publishedAt} className="tnum" />
            </div>
            <a href={a.url} className="block text-[13px] font-medium leading-snug text-text hover:text-accent">
              {a.headline}
            </a>
            {a.tickers.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {a.tickers.map((t) => (
                  <Link key={t} href={`/stocks/${t}`} className="chip !h-[18px] hover:!text-accent">{t}</Link>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y divide-line">
      {items.map((a) => (
        <article key={a.id} className="flex gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2/50">
          <div
            className="hidden h-[76px] w-[112px] shrink-0 overflow-hidden rounded-md sm:block"
            style={{ background: `linear-gradient(135deg, ${a.imageColor}, var(--color-surface-3))` }}
            aria-hidden
          >
            <div className="flex h-full items-end p-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text/60">{a.category}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-[11px]">
              <span className={cn("h-1.5 w-1.5 rounded-full", SENT[a.sentiment])} />
              <span className="font-medium text-muted">{a.source}</span>
              <span className="text-faint">·</span>
              <RelativeTime epochMs={a.publishedAt} className="tnum text-faint" />
              <span className="text-faint">·</span>
              <span className="text-faint">{a.category}</span>
            </div>
            <a href={a.url} className="block text-[15px] font-semibold leading-snug text-text hover:text-accent">
              {a.headline}
            </a>
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">{a.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {a.tickers.map((t) => (
                <Link key={t} href={`/stocks/${t}`} className="chip hover:!text-accent hover:!border-accent/40">{t}</Link>
              ))}
              <span className="ml-auto text-[11px] text-faint">Read at {a.source} →</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

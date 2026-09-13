import type { Filing } from "@/types";
import { EmptyState } from "@/components/common/Panel";
import { fmtDate } from "@/lib/format";

const KIND_TONE: Record<string, string> = {
  "10-K": "text-accent", "20-F": "text-accent",
  "10-Q": "text-pos", "6-K": "text-pos",
  "8-K": "text-warn",
  "Form 4": "text-muted", "SC 13G": "text-muted", "SC 13D": "text-muted",
};

export function FilingsList({ filings }: { filings: Filing[] }) {
  if (!filings.length) return <EmptyState title="No filings available" hint="SEC filings are available for US-listed companies." />;
  return (
    <div className="divide-y divide-line">
      {filings.map((f, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <span className={`w-16 shrink-0 text-[13px] font-semibold ${KIND_TONE[f.type] ?? "text-muted"}`}>{f.type}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]">{f.title}</div>
            <div className="tnum text-[11px] text-faint">{fmtDate(f.date)}</div>
          </div>
          <button className="btn btn-ghost !h-7 !px-2 text-[11px] text-muted" title="AI summary (opens AI panel)">AI Summary</button>
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="btn !h-7 !px-2 text-[11px]">Open ↗</a>
        </div>
      ))}
    </div>
  );
}

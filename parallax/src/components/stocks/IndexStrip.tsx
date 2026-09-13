import type { IndexQuote } from "@/types";
import { Sparkline } from "@/components/common/Sparkline";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

export function IndexStrip({ indices }: { indices: IndexQuote[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
      {indices.map((idx) => {
        const up = idx.changePercent >= 0;
        return (
          <div key={idx.symbol} className="flex flex-col gap-1 bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-muted">{idx.name}</span>
            </div>
            <div className="flex items-end justify-between gap-1">
              <div>
                <div className="tnum text-[15px] font-semibold leading-tight">
                  {idx.symbol === "US10Y" ? `${fmtPrice(idx.price, 2)}%` : fmtPrice(idx.price, idx.price > 1000 ? 0 : 2)}
                </div>
                <div className={cn("tnum text-[11px] font-medium", up ? "text-pos" : "text-neg")}>
                  {up ? "+" : ""}{fmtPct(idx.changePercent, 2)}
                </div>
              </div>
              <Sparkline data={idx.spark} width={54} height={26} fill={false} strokeWidth={1.1} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from "recharts";
import type { EarningsRow } from "@/types";
import { fmtPrice, fmtCompact, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

type Metric = "eps" | "revenue" | "epsGrowth" | "revGrowth";

const AXIS = { fontSize: 11, fill: "var(--color-faint)" };

export function EarningsBars({ rows }: { rows: EarningsRow[] }) {
  const [metric, setMetric] = useState<Metric>("eps");
  const ordered = useMemo(() => [...rows].reverse(), [rows]); // oldest → newest

  const data = useMemo(() => {
    return ordered.map((r, i) => {
      const prev = ordered[i - 4]; // YoY (4 quarters back)
      const epsGrowth = prev?.epsActual ? ((r.epsActual! - prev.epsActual) / Math.abs(prev.epsActual)) * 100 : null;
      const revGrowth = prev?.revActual ? ((r.revActual! - prev.revActual) / prev.revActual) * 100 : null;
      return {
        period: r.period.replace(" ", "'").replace("20", ""),
        estimate: r.epsEstimate,
        actual: r.epsActual,
        revEstimate: r.revEstimate,
        revActual: r.revActual,
        epsGrowth,
        revGrowth,
        beat: (r.epsSurprisePct ?? 0) >= 0,
      };
    });
  }, [ordered]);

  const isGrowth = metric === "epsGrowth" || metric === "revGrowth";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg">
          <button data-active={metric === "eps"} onClick={() => setMetric("eps")}>EPS</button>
          <button data-active={metric === "revenue"} onClick={() => setMetric("revenue")}>Revenue</button>
          <button data-active={metric === "epsGrowth"} onClick={() => setMetric("epsGrowth")}>EPS Growth</button>
          <button data-active={metric === "revGrowth"} onClick={() => setMetric("revGrowth")}>Rev Growth</button>
        </div>
        {!isGrowth && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-line-2" /> Estimate</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-pos" /> Actual</span>
          </div>
        )}
      </div>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="period" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => (metric === "eps" ? `$${v.toFixed(1)}` : isGrowth ? `${v.toFixed(0)}%` : fmtCompact(v, 0))}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-2)" }}
              contentStyle={{ background: "var(--color-surface-3)", border: "1px solid var(--color-line-2)", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "var(--color-muted)" }}
              formatter={(value: number, name: string) => {
                if (metric === "eps") return [`$${fmtPrice(value)}`, name === "estimate" ? "Estimate" : "Actual"];
                if (metric === "revenue") return [fmtCompact(value, 2), name === "revEstimate" ? "Estimate" : "Actual"];
                return [fmtPct(value, 1, true), "YoY"];
              }}
            />
            {metric === "eps" && (
              <>
                <Bar dataKey="estimate" fill="var(--color-line-2)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" radius={[2, 2, 0, 0]}>
                  {data.map((d, i) => <Cell key={i} fill={d.beat ? "var(--color-pos)" : "var(--color-neg)"} />)}
                </Bar>
              </>
            )}
            {metric === "revenue" && (
              <>
                <Bar dataKey="revEstimate" fill="var(--color-line-2)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="revActual" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
              </>
            )}
            {metric === "epsGrowth" && (
              <Bar dataKey="epsGrowth" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={(d.epsGrowth ?? 0) >= 0 ? "var(--color-pos)" : "var(--color-neg)"} />)}
              </Bar>
            )}
            {metric === "revGrowth" && (
              <Bar dataKey="revGrowth" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={(d.revGrowth ?? 0) >= 0 ? "var(--color-pos)" : "var(--color-neg)"} />)}
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

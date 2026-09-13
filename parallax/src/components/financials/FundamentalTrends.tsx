"use client";
import { useMemo, useState } from "react";
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import type { FinancialStatements } from "@/types";
import { fmtCompact, fmtPct } from "@/lib/format";

const METRICS = [
  { key: "revenue", label: "Revenue", stmt: "income", lineKey: "revenue", kind: "area", pct: false },
  { key: "ni", label: "Net Income", stmt: "income", lineKey: "ni", kind: "bar", pct: false },
  { key: "fcf", label: "Free Cash Flow", stmt: "cashflow", lineKey: "fcf", kind: "bar", pct: false },
  { key: "gmpct", label: "Gross Margin", stmt: "income", lineKey: "gmpct", kind: "area", pct: true },
  { key: "nmpct", label: "Net Margin", stmt: "income", lineKey: "nmpct", kind: "area", pct: true },
] as const;

export function FundamentalTrends({ annual }: { annual: FinancialStatements }) {
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("revenue");
  const def = METRICS.find((m) => m.key === metric)!;

  const data = useMemo(() => {
    const lines = annual[def.stmt as "income" | "cashflow"];
    const line = lines.find((l) => l.key === def.lineKey);
    if (!line) return [];
    // periods are most-recent-first; reverse for chronological display
    return annual.periods
      .map((p, i) => ({ period: p, value: line.values[i] }))
      .reverse();
  }, [annual, def]);

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`chip ${metric === m.key ? "!border-accent/40 !text-text" : ""}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ftGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--color-faint)" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-faint)" }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => (def.pct ? `${v.toFixed(0)}%` : fmtCompact(v, 0))}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-2)" }}
              contentStyle={{ background: "var(--color-surface-3)", border: "1px solid var(--color-line-2)", borderRadius: 6, fontSize: 12 }}
              formatter={(v: number) => [def.pct ? fmtPct(v, 1) : fmtCompact(v, 2), def.label]}
            />
            {def.kind === "area" ? (
              <Area type="monotone" dataKey="value" stroke="var(--color-accent)" strokeWidth={1.8} fill="url(#ftGrad)" />
            ) : (
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={(d.value ?? 0) >= 0 ? "var(--color-pos)" : "var(--color-neg)"} />)}
              </Bar>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import type { FinancialStatements, StatementLine } from "@/types";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

type Stmt = "income" | "balance" | "cashflow";

function cell(line: StatementLine, v: number | null): string {
  if (v == null) return "—";
  if (line.percent) return fmtPct(v, 1);
  if (line.key === "eps") return `$${fmtPrice(v)}`;
  return fmtCompact(v, 2);
}

function StatementTable({ stmt, lines }: { stmt: FinancialStatements; lines: StatementLine[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="ftable min-w-[640px]">
        <thead>
          <tr>
            <th>{" "}</th>
            {stmt.periods.map((p) => <th key={p}>{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const latest = line.values[0];
            const prior = line.values[1];
            const yoy = latest != null && prior != null && prior !== 0 && !line.percent
              ? ((latest - prior) / Math.abs(prior)) * 100
              : null;
            return (
              <tr key={line.key} className={cn(line.emphasis === "total" && "bg-surface-2/40")}>
                <td className={cn(line.emphasis === "total" && "font-semibold", line.emphasis === "subtotal" && "font-medium", line.percent && "text-muted")}>
                  {line.label}
                  {yoy != null && (
                    <span className={cn("ml-2 text-[10px] tnum", yoy >= 0 ? "text-pos" : "text-neg")}>
                      {fmtPct(yoy, 1, true)} YoY
                    </span>
                  )}
                </td>
                {line.values.map((v, i) => (
                  <td key={i} className={cn(
                    line.emphasis === "total" && "font-semibold",
                    !line.percent && v != null && v < 0 && "text-neg",
                    line.percent && "text-muted",
                  )}>
                    {cell(line, v)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FinancialsSection({ annual, quarterly }: { annual: FinancialStatements; quarterly: FinancialStatements }) {
  const [stmt, setStmt] = useState<Stmt>("income");
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const data = period === "annual" ? annual : quarterly;
  const lines = data[stmt];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="seg">
          <button data-active={stmt === "income"} onClick={() => setStmt("income")}>Income</button>
          <button data-active={stmt === "balance"} onClick={() => setStmt("balance")}>Balance Sheet</button>
          <button data-active={stmt === "cashflow"} onClick={() => setStmt("cashflow")}>Cash Flow</button>
        </div>
        <div className="seg">
          <button data-active={period === "annual"} onClick={() => setPeriod("annual")}>Annual</button>
          <button data-active={period === "quarterly"} onClick={() => setPeriod("quarterly")}>Quarterly</button>
        </div>
      </div>
      <StatementTable stmt={data} lines={lines} />
      <p className="border-t border-line px-3 py-2 text-[11px] text-faint">
        Figures in USD. Values shown in compact notation (B = billion, M = million). YoY compares the two most recent periods shown.
      </p>
    </div>
  );
}

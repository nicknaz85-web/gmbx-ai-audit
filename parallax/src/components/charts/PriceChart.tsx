"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle, ChartRange } from "@/types";
import { fmtPrice, fmtCompact } from "@/lib/format";
import { cn } from "@/lib/cn";

const RANGES: ChartRange[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"];
type Mode = "area" | "line" | "candle";

function sma(data: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function PriceChart({
  ticker,
  initial,
  initialRange = "1M",
}: {
  ticker: string;
  initial: Candle[];
  initialRange?: ChartRange;
}) {
  const [range, setRange] = useState<ChartRange>(initialRange);
  const [candles, setCandles] = useState<Candle[]>(initial);
  const [mode, setMode] = useState<Mode>("area");
  const [showVol, setShowVol] = useState(true);
  const [ma, setMa] = useState<{ ma50: boolean; ma200: boolean }>({ ma50: false, ma200: false });
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(880);
  const wrapRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);

  const H = 320;
  const volH = showVol ? 46 : 0;
  const padL = 8, padR = 56, padT = 10, padB = 20;
  const plotH = H - padT - padB - volH;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = ++reqRef.current;
    setLoading(true);
    fetch(`/api/candles?ticker=${ticker}&range=${range}`)
      .then((r) => r.json())
      .then((data: Candle[]) => {
        if (id !== reqRef.current) return;
        setCandles(data);
        setLoading(false);
      })
      .catch(() => id === reqRef.current && setLoading(false));
  }, [range, ticker]);

  const closes = useMemo(() => candles.map((c) => c.c), [candles]);
  const ma50 = useMemo(() => (ma.ma50 ? sma(closes, 50) : null), [ma.ma50, closes]);
  const ma200 = useMemo(() => (ma.ma200 ? sma(closes, 200) : null), [ma.ma200, closes]);

  const { min, max } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) {
      lo = Math.min(lo, mode === "candle" ? c.l : c.c);
      hi = Math.max(hi, mode === "candle" ? c.h : c.c);
    }
    const pad = (hi - lo) * 0.08 || 1;
    return { min: lo - pad, max: hi + pad };
  }, [candles, mode]);

  const maxVol = useMemo(() => Math.max(1, ...candles.map((c) => c.v)), [candles]);
  const plotW = w - padL - padR;
  const up = closes.length > 1 && closes[closes.length - 1] >= closes[0];
  const color = up ? "var(--color-pos)" : "var(--color-neg)";

  const x = (i: number) => padL + (i / Math.max(1, candles.length - 1)) * plotW;
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const volY = (v: number) => padT + plotH + 8 + (1 - v / maxVol) * (volH - 8);

  const linePath = useMemo(() => {
    if (!candles.length) return "";
    return candles.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.c).toFixed(1)}`).join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, w, min, max, showVol]);
  const areaPath = linePath ? `${linePath} L${x(candles.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL},${(padT + plotH).toFixed(1)} Z` : "";

  const maPath = (arr: (number | null)[] | null) => {
    if (!arr) return "";
    let d = "", started = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    return d;
  };

  const gridVals = useMemo(() => {
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);
  }, [min, max]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const i = Math.round(((px - padL) / plotW) * (candles.length - 1));
    setHover(Math.max(0, Math.min(candles.length - 1, i)));
  };

  const hc = hover != null ? candles[hover] : null;
  const intraday = range === "1D" || range === "5D";
  const fmtT = (t: number) => {
    const d = new Date(t);
    return intraday
      ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) + (range === "5D" ? ` ${d.getMonth() + 1}/${d.getDate()}` : "")
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: range === "5Y" || range === "MAX" ? "2-digit" : undefined });
  };

  return (
    <div className="select-none">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="seg">
          {RANGES.map((r) => (
            <button key={r} data-active={r === range} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="seg">
            {(["area", "line", "candle"] as Mode[]).map((m) => (
              <button key={m} data-active={m === mode} onClick={() => setMode(m)} className="capitalize">{m}</button>
            ))}
          </div>
          <button className={cn("chip", ma.ma50 && "!text-accent !border-accent/40")} onClick={() => setMa((s) => ({ ...s, ma50: !s.ma50 }))}>50 MA</button>
          <button className={cn("chip", ma.ma200 && "!text-warn !border-warn/40")} onClick={() => setMa((s) => ({ ...s, ma200: !s.ma200 }))}>200 MA</button>
          <button className={cn("chip", showVol && "!text-text")} onClick={() => setShowVol((s) => !s)}>Vol</button>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
        {loading && <div className="absolute right-2 top-1 z-10 text-[11px] text-faint">updating…</div>}
        <svg
          width={w}
          height={H}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* horizontal gridlines + right axis labels */}
          {gridVals.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={i === 0 ? "0" : "2 4"} opacity={i === 0 ? 0.9 : 0.5} />
              <text x={w - padR + 6} y={y(v) + 3} fontSize="10" fill="var(--color-faint)" className="tnum">{fmtPrice(v, v > 500 ? 0 : 2)}</text>
            </g>
          ))}

          {mode !== "candle" && (
            <>
              {mode === "area" && (
                <>
                  <defs>
                    <linearGradient id="pcArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                      <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaPath} fill="url(#pcArea)" />
                </>
              )}
              <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}

          {mode === "candle" && candles.map((c, i) => {
            const cw = Math.max(1, Math.min(7, (plotW / candles.length) * 0.66));
            const cup = c.c >= c.o;
            const col = cup ? "var(--color-pos)" : "var(--color-neg)";
            const bodyTop = y(Math.max(c.o, c.c));
            const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)));
            return (
              <g key={i}>
                <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth="1" opacity="0.9" />
                <rect x={x(i) - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={col} opacity="0.9" />
              </g>
            );
          })}

          {ma.ma50 && <path d={maPath(ma50)} fill="none" stroke="var(--color-accent)" strokeWidth="1.1" opacity="0.85" />}
          {ma.ma200 && <path d={maPath(ma200)} fill="none" stroke="var(--color-warn)" strokeWidth="1.1" opacity="0.85" />}

          {/* volume */}
          {showVol && candles.map((c, i) => {
            const cw = Math.max(1, Math.min(7, (plotW / candles.length) * 0.66));
            const cup = c.c >= c.o;
            return <rect key={i} x={x(i) - cw / 2} y={volY(c.v)} width={cw} height={padT + plotH + 8 + (volH - 8) - volY(c.v)} fill={cup ? "var(--color-pos)" : "var(--color-neg)"} opacity="0.22" />;
          })}

          {/* crosshair */}
          {hc && hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="var(--color-line-2)" strokeWidth="1" />
              <circle cx={x(hover)} cy={y(hc.c)} r="3" fill={color} stroke="var(--color-bg)" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {hc && hover != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-line-2 bg-surface-3/95 px-2.5 py-1.5 text-[11px] shadow-xl"
            style={{ left: Math.min(Math.max(x(hover) - 60, 0), w - 130) }}
          >
            <div className="tnum text-faint">{fmtT(hc.t)}</div>
            <div className="tnum font-semibold">${fmtPrice(hc.c)}</div>
            <div className="tnum text-faint">Vol {fmtCompact(hc.v, 1)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

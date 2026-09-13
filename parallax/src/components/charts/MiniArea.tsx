"use client";
import { useEffect, useRef, useState } from "react";

/* Responsive area chart for overview panels (index history, fundamental trends
   where a single series suffices). Pure SVG, resizes to its container. */
export function MiniArea({
  data,
  height = 180,
  positive,
}: {
  data: number[];
  height?: number;
  positive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  if (!data.length) return <div ref={ref} style={{ height }} />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const up = positive ?? data[data.length - 1] >= data[0];
  const color = up ? "var(--color-pos)" : "var(--color-neg)";
  const padT = 8, padB = 8, padR = 2, padL = 2;
  const x = (i: number) => padL + (i / (data.length - 1)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / range) * (height - padT - padB);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${height} L${padL},${height} Z`;

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <svg width={w} height={height} className="block">
        <defs>
          <linearGradient id="miniAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#miniAreaGrad)" />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

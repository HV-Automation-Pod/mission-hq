"use client";

import { motion, useReducedMotion } from "framer-motion";
import { C, EASE } from "./theme";
import { Tooltip } from "./Tooltip";

/** Weekly bars that rise into place. The latest is drawn solid, the rest soft. */
export function WeekBars({ points, height = 150 }: { points: { label: string; pct: number | null; provisional?: boolean }[]; height?: number }) {
  const reduce = useReducedMotion();
  const last = points.length - 1;
  return (
    <div className="flex items-end justify-around gap-3" style={{ height: height + 56 }} role="img"
      aria-label={points.map((p) => `${p.label}: ${p.pct === null ? "no score" : `${p.pct}%`}`).join(", ")}>
      {points.map((p, i) => (
        <div key={p.label} className="flex flex-col items-center justify-end flex-1 max-w-[96px] h-full">
          <span className="text-[14px] font-semibold mb-2" style={{ color: p.pct === null ? C.muted : C.text }}>{p.pct === null ? "n/a" : `${p.pct}%`}</span>
          <Tooltip label={p.provisional ? "Current week, provisional" : `Week of ${p.label}`} className="w-full" side="top">
            <div className="w-full flex items-end" style={{ height }}>
              <motion.div className="w-full rounded-lg" style={{ background: i === last ? C.brand : "#B7D2CD", minHeight: 6 }}
                initial={reduce ? false : { height: 0 }} animate={{ height: `${Math.max(4, ((p.pct ?? 0) / 100) * 100)}%` }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.08 + i * 0.06 }} />
            </div>
          </Tooltip>
          <span className="text-[11px] mt-3" style={{ color: C.muted }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

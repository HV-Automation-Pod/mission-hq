"use client";

import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { C, focusRing, viewOf } from "@/components/ui";

/** One weekday as a small card, for the phone's week strip. */
export function WeekCell({ day, today, status, open, onAnswer }: { day: string; today: string; status?: string; open: boolean; onAnswer: () => void }) {
  const d = parseISO(day);
  const future = day > today;
  const v = status && !future ? viewOf(status) : null;
  const pending = status === "Pending";
  const body = (
    <>
      <span className="text-[10px] tracking-wide" style={{ color: C.muted }}>{format(d, "EEE").toUpperCase()}</span>
      <span className="text-[20px] font-semibold leading-none my-1.5">{d.getDate()}</span>
      <span className="h-5 flex items-center" style={{ color: v?.color ?? C.muted }}>{v && <v.Icon size={16} />}</span>
      <span className="text-[11px] mt-1" style={{ color: pending ? C.warn : C.text2 }}>{pending ? (open ? "Answer" : "Pending") : v ? v.short : future ? "" : "None"}</span>
    </>
  );
  const style: React.CSSProperties = pending
    ? { background: C.warnSoft, border: "1px solid #EBD9A8", boxShadow: "var(--shadow-xs)" }
    : { background: day === today ? C.selected : C.surface, border: `${day === today ? 1.5 : 1}px solid ${day === today ? C.primary : C.border}`, boxShadow: "var(--shadow-xs)" };
  const cls = "rounded-2xl py-3 flex flex-col items-center min-w-0";
  return open ? <motion.button whileTap={{ scale: 0.96 }} onClick={onAnswer} className={`${cls} ${focusRing}`} style={style} aria-label={`${format(d, "EEEE d MMMM")}: ${status}`}>{body}</motion.button>
    : <div className={cls} style={style}>{body}</div>;
}

"use client";

import { useMemo } from "react";
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { C, Button, Card, Pill, focusRing, viewOf } from "@/components/ui";
import { iso } from "@/lib/format";
import { scorePeriod } from "@/lib/domain/policy";
import { fmtDays } from "@/lib/domain/policy";
import type { Employee } from "@/lib/domain/types";

/**
 * One person's month, Monday to Friday, with a day selected.
 *
 * Unlike the member's own calendar, every day with a record can be selected and
 * so can days with none: an admin editor can correct a day nobody was asked
 * about. Only the future is closed. Selection is the parent's, so it can live in
 * the URL.
 */
export default function AdminCalendar({ employee, today, month, onMonth, selected, onSelect, earliest }: {
  employee: Employee; today: string; month: Date; onMonth: (m: Date) => void;
  selected: string | null; onSelect: (day: string) => void; earliest: Date;
}) {
  const reduce = useReducedMotion();
  const statuses = employee.statuses;
  const first = startOfMonth(month);
  const last = endOfMonth(month);

  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let w = startOfWeek(first, { weekStartsOn: 1 }); w <= last; w = addDays(w, 7)) {
      const days = Array.from({ length: 5 }, (_, i) => addDays(w, i));
      if (days.some((d) => d.getMonth() === first.getMonth())) out.push(days);
    }
    return out;
  }, [first, last]);

  const monthDays = useMemo(() => Array.from({ length: last.getDate() }, (_, i) => iso(addDays(first, i))), [first, last]);
  const m = scorePeriod(statuses, monthDays.filter((d) => d < today || (d === today && statuses[d] && statuses[d] !== "Pending")), employee.allowance);
  const chips: [string, number, string, string][] = [
    ["office", m.wfo, C.office, C.officeSoft], ["home", m.wfh, C.home, C.homeSoft], ["leave", m.leave, C.leave, C.leaveSoft],
    ["anywhere", m.wfa, C.primary, C.selected], ["unanswered", m.pending, C.warn, C.warnSoft],
  ];

  const thisMonth = iso(first) === iso(startOfMonth(parseISO(today)));
  const canPrev = first > earliest;
  const canNext = first < startOfMonth(parseISO(today));

  return (
    <Card className="!p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">Attendance record</h2>
          <div className="text-[14px] mt-2.5" style={{ color: C.text2 }}>{format(first, "MMMM yyyy")}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" style={{ minHeight: 40 }} disabled={thisMonth} onClick={() => onMonth(startOfMonth(parseISO(today)))}>Today</Button>
          <Tooltip label="Previous month"><button onClick={() => onMonth(addMonths(first, -1))} disabled={!canPrev} aria-label="Previous month" className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronLeft size={19} /></button></Tooltip>
          <Tooltip label="Next month"><button onClick={() => onMonth(addMonths(first, 1))} disabled={!canNext} aria-label="Next month" className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronRight size={19} /></button></Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-5 min-h-[28px]">
        {chips.filter(([, n]) => n > 0.001).map(([label, n, color, bg]) => <Pill key={label} color={color} bg={bg}>{fmtDays(n)} {label}</Pill>)}
      </div>

      <div className="grid grid-cols-5 gap-2.5 mt-6 mb-2">
        {["MON", "TUE", "WED", "THU", "FRI"].map((d) => <div key={d} className="text-[11px] tracking-[0.1em]" style={{ color: C.muted }}>{d}</div>)}
      </div>

      <motion.div key={iso(first)} className="space-y-2.5" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {weeks.map((week) => (
          <div key={iso(week[0])} className="grid grid-cols-5 gap-2.5">
            {week.map((d) => <Day key={iso(d)} date={d} inMonth={d.getMonth() === first.getMonth()} today={today} status={statuses[iso(d)]}
              selected={selected === iso(d)} onSelect={() => onSelect(iso(d))} />)}
          </div>
        ))}
      </motion.div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6 pt-4 text-[12px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
        <span className="inline-flex items-center gap-2"><Lock size={12} /> Select any day to view or correct its record.</span>
        <span>All dates in IST</span>
      </div>
    </Card>
  );
}

function Day({ date, inMonth, today, status, selected, onSelect }: {
  date: Date; inMonth: boolean; today: string; status?: string; selected: boolean; onSelect: () => void;
}) {
  const key = iso(date);
  const base = "relative h-[78px] rounded-xl p-2.5 flex flex-col justify-between text-left";
  if (!inMonth) return <div className={`${base} opacity-0`} aria-hidden />;
  const isToday = key === today;
  const future = key > today;
  const name = format(date, "EEEE d MMMM");

  const num = (
    <span className="flex items-center gap-2 text-[13px] font-medium leading-none">
      {date.getDate()}
      {isToday && <span className="text-[9px] tracking-[0.1em] font-semibold" style={{ color: C.primary }}>TODAY</span>}
    </span>
  );

  if (future) {
    return <div className={base} style={{ background: C.inset, border: `1px solid ${C.inset}` }} aria-label={`${name}: upcoming`}>{num}<span className="text-[11px]" style={{ color: C.muted }}>Upcoming</span></div>;
  }

  const v = status ? viewOf(status) : null;
  const pending = status === "Pending";
  const ring = selected
    ? { border: `2px solid ${C.primary}`, background: C.selected }
    : pending ? { border: "1px solid #EBD9A8", background: C.warnSoft }
    : { border: `1px solid ${C.border}`, background: isToday ? C.selected : C.surface };

  return (
    <motion.button onClick={onSelect} aria-pressed={selected} aria-label={`${name}: ${status ?? "no check-in"}`}
      className={`${base} ${focusRing}`} style={ring} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
      {num}
      {pending ? (
        <span className="self-start text-[11px] font-medium px-2 py-1 rounded-md" style={{ background: "#FCEBC8", color: C.warn }}>Missing</span>
      ) : v ? (
        <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium px-2 py-1 rounded-md" style={{ background: v.bg, color: v.color }}><v.Icon size={12} /> {v.short}</span>
      ) : <span className="text-[11px]" style={{ color: C.muted }}>No check-in</span>}
    </motion.button>
  );
}

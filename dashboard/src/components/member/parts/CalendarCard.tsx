"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, Lock, Pencil } from "lucide-react";
import { C, Card, Pill, btnOutline, focusRing, pctColor, viewOf, Tooltip } from "@/components/ui";
import { fmtDays, scorePeriod } from "@/lib/domain/policy";
import { iso } from "@/lib/format";
import { WEEKDAYS, type PageProps } from "../model";

export function CalendarCard({ employee, view, today, oldest, month, setMonth, earliest, canAnswer, onAnswer, onWeek }: PageProps) {
  const statuses = employee.statuses;
  // WEEK OR MONTH (requested 22 Oct 2026). Month is the default; week is one row with room to read.
  const [mode, setMode] = useState<"month" | "week">("month");
  const thisWeek = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const [weekStart, setWeekStart] = useState(thisWeek);
  const firstWeek = startOfWeek(earliest, { weekStartsOn: 1 });

  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const weeks: Date[][] = [];
  if (mode === "week") {
    weeks.push(Array.from({ length: WEEKDAYS }, (_, i) => addDays(weekStart, i)));
  } else {
    for (let w = startOfWeek(first, { weekStartsOn: 1 }); w <= last; w = addDays(w, 7)) {
      const days = Array.from({ length: WEEKDAYS }, (_, i) => addDays(w, i));
      // A row with no day in this month is somebody else's week with this month's header.
      if (days.some((d) => d.getMonth() === first.getMonth())) weeks.push(days);
    }
  }

  const periodDates = mode === "week" ? weeks[0].map(iso) : Array.from({ length: last.getDate() }, (_, i) => iso(addDays(first, i)));
  const m = scorePeriod(statuses, periodDates.filter((d) => d < today || (d === today && statuses[d] !== "Pending")), employee.allowance);
  const chips: [string, number, string, string][] = [
    ["office", m.wfo, C.office, C.officeSoft], ["home", m.wfh, C.home, C.homeSoft], ["leave", m.leave, C.leave, C.leaveSoft],
    ["anywhere", m.wfa, C.primary, C.selected], ["unanswered", m.pending, C.warn, C.warnSoft],
  ];

  const isThisMonth = iso(first) === iso(startOfMonth(parseISO(today)));
  const isThisWeek = iso(weekStart) === iso(thisWeek);
  const prevDisabled = mode === "week" ? weekStart <= firstWeek : first <= earliest;
  const nextDisabled = mode === "week" ? weekStart >= thisWeek : first >= startOfMonth(parseISO(today));
  const step = (delta: number) => (mode === "week" ? setWeekStart((w) => addDays(w, 7 * delta)) : setMonth((mm) => addMonths(mm, delta)));
  const goNow = () => (mode === "week" ? setWeekStart(thisWeek) : setMonth(() => startOfMonth(parseISO(today))));

  // Keyboard: arrows move, W/M switch, T comes back. Never while typing, inside a
  // dialog, or with a modifier key.
  const stepRef = useRef(step); stepRef.current = step;
  const goNowRef = useRef(goNow); goNowRef.current = goNow;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" && !prevDisabled) stepRef.current(-1);
      else if (e.key === "ArrowRight" && !nextDisabled) stepRef.current(1);
      else if (k === "w") setMode("week");
      else if (k === "m") setMode("month");
      else if (k === "t") goNowRef.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevDisabled, nextDisabled]);

  const subtitle = mode === "week" ? `${format(weekStart, "d MMM")} - ${format(addDays(weekStart, 4), "d MMM yyyy")}` : format(first, "MMMM yyyy");
  const cols = "grid grid-cols-[repeat(5,minmax(0,1fr))_46px] gap-2";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight">My attendance</h2>
          <div className="text-[14px] mt-2" style={{ color: C.text2 }}>{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg p-0.5" role="group" aria-label="Calendar view" style={{ background: C.inset }}>
            {(["week", "month"] as const).map((mm) => (
              <button key={mm} onClick={() => setMode(mm)} aria-pressed={mode === mm} className={`relative px-3 h-8 rounded-md text-[12px] font-medium ${focusRing}`}
                style={{ color: mode === mm ? C.text : C.text2 }}>
                {mode === mm && <motion.span layoutId="calendar-mode" className="absolute inset-0 rounded-md" style={{ background: C.surface, boxShadow: "var(--shadow-xs)" }} transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <span className="relative">{mm === "week" ? "Week" : "Month"}</span>
              </button>
            ))}
          </div>
          <button onClick={goNow} disabled={mode === "week" ? isThisWeek : isThisMonth} className={`px-4 h-10 text-[13px] font-medium disabled:opacity-40 ${focusRing}`} style={btnOutline}>Today</button>
          <Tooltip label={mode === "week" ? "Previous week" : "Previous month"} shortcut="←"><button onClick={() => step(-1)} disabled={prevDisabled} aria-label={mode === "week" ? "Previous week" : "Previous month"} className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronLeft size={19} /></button></Tooltip>
          <Tooltip label={mode === "week" ? "Next week" : "Next month"} shortcut="→"><button onClick={() => step(1)} disabled={nextDisabled} aria-label={mode === "week" ? "Next week" : "Next month"} className={`w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronRight size={19} /></button></Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {chips.filter(([, n]) => n > 0.001).map(([label, n, color, bg]) => <Pill key={label} color={color} bg={bg}>{fmtDays(n)} {label}</Pill>)}
      </div>

      <div className={`${cols} mt-6 mb-2`}>
        {["MON", "TUE", "WED", "THU", "FRI"].map((d) => <div key={d} className="text-[11px] tracking-[0.1em]" style={{ color: C.muted }}>{d}</div>)}
        <div className="text-[11px] tracking-[0.1em] text-center" style={{ color: C.muted }}>WEEK</div>
      </div>

      <motion.div key={`${mode}-${iso(first)}-${iso(weekStart)}`} className="space-y-2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        {weeks.map((week) => {
          const pct = view.weekPct.get(iso(week[0])) ?? null;
          return (
            <div key={iso(week[0])} className={cols}>
              {week.map((d) => (
                <Cell key={iso(d)} date={d} inMonth={mode === "week" || d.getMonth() === first.getMonth()} tall={mode === "week"}
                  today={today} oldest={oldest} status={statuses[iso(d)]} open={canAnswer(iso(d))} onAnswer={() => onAnswer(iso(d))} />
              ))}
              {pct === null ? <div /> : (
                <Tooltip label="Why this score?" side="top"><button onClick={() => onWeek(iso(week[0]))} aria-label={`Week score ${pct} percent. Why?`}
                  className={`flex items-center justify-center rounded-lg text-[12px] font-semibold underline decoration-dotted underline-offset-4 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: pctColor(pct) }}>
                  {pct}%
                </button></Tooltip>
              )}
            </div>
          );
        })}
      </motion.div>

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 mt-6 pt-4 text-[12px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
        <span className="inline-flex items-center gap-2"><Lock size={12} /> Past answers are read-only.</span>
        <span className="inline-flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded-[4px]" style={{ background: C.warnSoft, border: "1px solid #EBD9A8" }} /> Needs an answer</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-4 h-3 rounded-[4px]" style={{ background: "#FEF3F2", border: `1px solid ${C.bad}33` }} /> Unanswered, past the answer window</span>
          <span>All dates in IST</span>
        </span>
      </div>
    </Card>
  );
}

function Cell({ date, inMonth, today, oldest, status, open, onAnswer, tall = false }: {
  date: Date; inMonth: boolean; today: string; oldest: string; status?: string; open: boolean; onAnswer: () => void; tall?: boolean;
}) {
  const key = iso(date);
  const isToday = key === today;
  const base = `relative ${tall ? "h-[132px]" : "h-[76px]"} rounded-xl p-2.5 flex flex-col justify-between text-left`;
  if (!inMonth) return <div className={`${base} opacity-0`} aria-hidden />;

  const num = (
    <span className="flex items-center gap-2 text-[13px] font-medium leading-none">
      {date.getDate()}
      {isToday && <span className="text-[9px] tracking-[0.1em] font-semibold" style={{ color: C.primary }}>TODAY</span>}
    </span>
  );
  const ring = isToday ? { border: `1.5px solid ${C.primary}`, background: C.selected } : { border: `1px solid ${C.border}`, background: C.surface };
  const name = format(date, "EEEE d MMMM");
  const future = key > today;

  if (future) return <div className={base} style={{ background: C.inset, border: `1px solid ${C.inset}` }} aria-label={`${name}: upcoming`}>{num}<span className="text-[11px]" style={{ color: C.muted }}>Upcoming</span></div>;
  if (!status) return <div className={base} style={ring} aria-label={`${name}: no check-in`}>{num}<span className="text-[11px]" style={{ color: C.muted }}>No check-in</span></div>;

  const v = viewOf(status);
  if (status === "Pending") {
    // Same anatomy as every other day (number, then a pill), in the design's
    // warning tint. Past the answer window it turns to the error tint and stops
    // being a button: it is a fact about the record, not a task.
    const tooOld = key < oldest;
    const content = (
      <>
        {num}
        <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium px-2 py-1 rounded-md"
          style={{ background: tooOld ? "#FEE4E2" : "#FCEBC8", color: tooOld ? C.bad : C.warn }}>
          {open ? <Pencil size={12} /> : <AlertCircle size={12} />} {open ? "Answer" : tooOld ? "Unanswered" : "Pending"}
        </span>
      </>
    );
    const style = { background: tooOld ? "#FEF3F2" : C.warnSoft, border: `1px solid ${tooOld ? `${C.bad}33` : "#EBD9A8"}` };
    return open
      ? <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={onAnswer} className={`${base} ${focusRing}`} style={style} aria-label={`${name}: not answered. Answer now`}>{content}</motion.button>
      : <div className={base} style={style} aria-label={`${name}: not answered`}>{content}</div>;
  }

  const content = (
    <>
      {num}
      <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium px-2 py-1 rounded-md" style={{ background: v.bg, color: v.color }}>
        <v.Icon size={12} /> {v.short}
      </span>
    </>
  );
  return open
    ? <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={onAnswer} className={`${base} ${focusRing}`} style={ring} aria-label={`${name}: ${status}. Change`}>{content}</motion.button>
    : <div className={base} style={ring} aria-label={`${name}: ${status}`}>{content}</div>;
}

"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { addDays, addMonths, endOfMonth, format, isSameDay, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { C, focusRing } from "./theme";
import { FieldLabel } from "./Field";
import { Popover } from "./Popover";

/**
 * A calendar to pick a date from, in place of the browser's date input.
 *
 * Values are yyyy-MM-dd strings, like everywhere else in the app. `disabled`
 * says which days may not be chosen (a future date, a weekend) and they are
 * drawn muted rather than hidden, so the grid stays a calendar.
 *
 * KEYBOARD: arrows move a day or a week, PageUp/PageDown a month, Home/End the
 * start and end of the week, Enter chooses, Escape closes.
 */
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function DatePicker({ value, onChange, label, hideLabel = false, min, max, isDisabled, className = "", id, placeholder = "Choose a date", format: fmt = "d MMMM yyyy", today, display }: {
  value: string; onChange: (v: string) => void; label: string; hideLabel?: boolean;
  min?: string; max?: string; isDisabled?: (day: string) => boolean; className?: string; id?: string;
  placeholder?: string; format?: string; today?: string;
  /** Replaces the text on the trigger, e.g. "Today \u00b7 23 October". */
  display?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : null;
  const todayDate = today ? parseISO(today) : new Date();
  const [month, setMonth] = useState(() => startOfMonth(selected ?? todayDate));
  const [focus, setFocus] = useState<Date>(() => selected ?? todayDate);

  const blocked = useCallback((d: Date) => {
    const s = format(d, "yyyy-MM-dd");
    return (min !== undefined && s < min) || (max !== undefined && s > max) || (isDisabled?.(s) ?? false);
  }, [min, max, isDisabled]);

  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const last = endOfMonth(month);
    const out: Date[] = [];
    for (let d = first; d <= last || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  const openPicker = () => {
    const start = selected ?? todayDate;
    setMonth(startOfMonth(start)); setFocus(start); setOpen(true);
  };
  const close = useCallback(() => setOpen(false), []);
  const pick = (d: Date) => { if (blocked(d)) return; onChange(format(d, "yyyy-MM-dd")); close(); trigger.current?.focus(); };

  useEffect(() => { if (open) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(); }, [open, focus]);

  const move = (d: Date) => { setFocus(d); if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(startOfMonth(d)); };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(); trigger.current?.focus(); }
    else if (k === "ArrowLeft") { e.preventDefault(); move(addDays(focus, -1)); }
    else if (k === "ArrowRight") { e.preventDefault(); move(addDays(focus, 1)); }
    else if (k === "ArrowUp") { e.preventDefault(); move(addDays(focus, -7)); }
    else if (k === "ArrowDown") { e.preventDefault(); move(addDays(focus, 7)); }
    else if (k === "PageUp") { e.preventDefault(); move(addMonths(focus, -1)); }
    else if (k === "PageDown") { e.preventDefault(); move(addMonths(focus, 1)); }
    else if (k === "Home") { e.preventDefault(); move(startOfWeek(focus, { weekStartsOn: 1 })); }
    else if (k === "End") { e.preventDefault(); move(addDays(startOfWeek(focus, { weekStartsOn: 1 }), 6)); }
    else if (k === "Tab") close();
  };

  const maxDate = max ? parseISO(max) : null;
  const minDate = min ? parseISO(min) : null;
  const canNext = !maxDate || addMonths(month, 1) <= maxDate;
  const canPrev = !minDate || endOfMonth(addMonths(month, -1)) >= minDate;

  return (
    <div className={className}>
      {hideLabel ? <label htmlFor={fid} className="sr-only">{label}</label> : <FieldLabel htmlFor={fid}>{label}</FieldLabel>}
      <button ref={trigger} id={fid} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : openPicker())}
        className={`w-full h-11 pl-4 pr-3 flex items-center justify-between gap-3 text-[14px] text-left rounded-[10px] transition-colors hover:border-[#B4C4C0] ${focusRing}`}
        style={{ background: C.surface, border: `1px solid ${open ? C.primary : C.border}`, minHeight: 44, color: selected ? C.text : C.muted }}>
        <span className="truncate">{display ?? (selected ? format(selected, fmt) : placeholder)}</span>
        <CalendarDays size={16} className="flex-shrink-0" style={{ color: C.muted }} />
      </button>

      <Popover open={open} anchor={trigger} onClose={close} label={label} minWidth={316}>
        <div className="p-4" onKeyDown={onKey}>
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={() => setMonth(addMonths(month, -1))} disabled={!canPrev} aria-label="Previous month" tabIndex={-1}
              className={`w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronLeft size={18} /></button>
            <div className="text-[15px] font-semibold" aria-live="polite">{format(month, "MMMM yyyy")}</div>
            <button type="button" onClick={() => setMonth(addMonths(month, 1))} disabled={!canNext} aria-label="Next month" tabIndex={-1}
              className={`w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-30 hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}><ChevronRight size={18} /></button>
          </div>
          <div ref={grid} role="grid" aria-label={format(month, "MMMM yyyy")}>
            <div className="grid grid-cols-7 mb-1" role="row">
              {WEEK.map((w) => <div key={w} role="columnheader" className="h-8 flex items-center justify-center text-[11px] tracking-wide" style={{ color: C.muted }}>{w.toUpperCase().slice(0, 2)}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-y-1" role="rowgroup">
              {days.map((d) => {
                const inMonth = d.getMonth() === month.getMonth();
                const dis = blocked(d);
                const isSel = !!selected && isSameDay(d, selected);
                const isToday = isSameDay(d, todayDate);
                const isFocus = isSameDay(d, focus);
                return (
                  <button key={d.toISOString()} type="button" role="gridcell" aria-selected={isSel} aria-disabled={dis} tabIndex={isFocus ? 0 : -1}
                    aria-label={format(d, "EEEE d MMMM yyyy")} onClick={() => pick(d)}
                    className={`h-10 rounded-lg text-[13px] flex items-center justify-center transition-colors ${dis ? "cursor-not-allowed" : isSel ? "" : "hover:bg-[#EEF3F1]"} ${focusRing}`}
                    style={{
                      background: isSel ? C.primary : "transparent",
                      color: isSel ? "#fff" : dis ? "#B7C3C0" : inMonth ? C.text : C.muted,
                      fontWeight: isSel || isToday ? 600 : 400,
                      boxShadow: isToday && !isSel ? `inset 0 0 0 1.5px ${C.primary}` : undefined,
                      opacity: inMonth ? 1 : 0.55,
                    }}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
            <button type="button" tabIndex={-1} disabled={blocked(todayDate)} onClick={() => pick(todayDate)}
              className={`text-[13px] font-medium rounded px-1 disabled:opacity-40 ${focusRing}`} style={{ color: C.primary }}>Today</button>
            <span className="text-[11px]" style={{ color: C.muted }}>Arrow keys to move</span>
          </div>
        </div>
      </Popover>
    </div>
  );
}

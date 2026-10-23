"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { C, focusRing } from "./theme";
import { FieldLabel } from "./Field";
import { Popover } from "./Popover";

export type SelectOption = { value: string; label: string; hint?: string };

/**
 * The dropdown, everywhere. A custom listbox rather than the browser's own
 * <select>: it matches the design, it is searchable, and it behaves the same in
 * every browser and inside a dialog.
 *
 * KEYBOARD: arrows move, Home/End jump, Enter or Space chooses, Escape closes,
 * typing filters (or jumps, on a short list). Focus stays on the trigger and
 * the highlighted option is announced through `aria-activedescendant`, which is
 * the pattern that keeps a screen reader and the on-screen highlight in step.
 *
 * SEARCH appears once there are more than a handful of options, because on a
 * list of three it is only in the way.
 */
const SEARCH_FROM = 7;

export function Select({ value, onChange, options, label, hideLabel = false, className = "", id, placeholder = "Select", searchable }: {
  value: string; onChange: (v: string) => void; options: SelectOption[]; label: string;
  hideLabel?: boolean; className?: string; id?: string; placeholder?: string;
  /** Force search on or off. By default it shows for long lists. */
  searchable?: boolean;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const listId = `${fid}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const showSearch = searchable ?? options.length > SEARCH_FROM;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const current = options.find((o) => o.value === value);

  const close = useCallback(() => { setOpen(false); setQuery(""); }, []);
  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o: SelectOption) => { onChange(o.value); close(); trigger.current?.focus(); };

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, shown]);
  useEffect(() => { if (open && showSearch) searchBox.current?.focus(); }, [open, showSearch]);
  useEffect(() => setActive(0), [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); trigger.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter" || (e.key === " " && !showSearch)) { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === "Tab") close();
    // No search box: typing jumps to the next option that starts with the letter.
    else if (!showSearch && e.key.length === 1 && /\S/.test(e.key)) {
      const at = shown.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      const from = at >= 0 ? at : shown.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (from >= 0) setActive(from);
    }
  };

  return (
    <div className={className}>
      {hideLabel ? <label htmlFor={fid} className="sr-only">{label}</label> : <FieldLabel htmlFor={fid}>{label}</FieldLabel>}
      <button ref={trigger} id={fid} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && shown[active] ? `${fid}-opt-${active}` : undefined}
        onClick={() => (open ? close() : openList())} onKeyDown={onKey}
        className={`w-full h-11 pl-4 pr-3 flex items-center justify-between gap-3 text-[14px] text-left rounded-[10px] transition-colors hover:border-[#B4C4C0] ${focusRing}`}
        style={{ background: C.surface, border: `1px solid ${open ? C.primary : C.border}`, minHeight: 44, color: current ? C.text : C.muted }}>
        <span className="truncate">{current ? current.label : placeholder}</span>
        <ChevronDown size={16} className="flex-shrink-0 transition-transform duration-200" style={{ color: C.muted, transform: open ? "rotate(180deg)" : undefined }} />
      </button>

      <Popover open={open} anchor={trigger} onClose={close} label={label} minWidth={200}>
        {showSearch && (
          <div className="p-2 flex-shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.muted }} />
              <input ref={searchBox} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Search" autoComplete="off"
                aria-label={`Search ${label}`} aria-controls={listId}
                className={`w-full h-9 pl-9 pr-3 text-[13px] rounded-lg ${focusRing}`} style={{ background: C.inset, border: "1px solid transparent" }} />
            </div>
          </div>
        )}
        <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="overflow-y-auto py-1.5 min-h-0">
          {shown.map((o, i) => {
            const on = o.value === value;
            return (
              <li key={o.value} id={`${fid}-opt-${i}`} data-index={i} role="option" aria-selected={on}
                onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseMove={() => active !== i && setActive(i)}
                className="mx-1.5 px-3 h-10 flex items-center gap-2.5 rounded-lg cursor-pointer text-[14px]"
                style={{ background: i === active ? C.selected : "transparent", color: C.text, fontWeight: on ? 600 : 400 }}>
                <span className="w-4 flex-shrink-0" aria-hidden>{on && <Check size={15} style={{ color: C.primary }} />}</span>
                <span className="truncate flex-1">{o.label}</span>
                {o.hint && <span className="text-[12px] flex-shrink-0" style={{ color: C.muted }}>{o.hint}</span>}
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-4 py-5 text-[13px] text-center" style={{ color: C.muted }}>Nothing matches &ldquo;{query}&rdquo;</li>}
        </ul>
      </Popover>
    </div>
  );
}

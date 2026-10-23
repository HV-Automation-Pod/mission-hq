"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { C, btnPrimary, focusRing, viewOf, Tooltip } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import { type Option } from "../model";

export function AnswerDialog({ day, isToday, current, options, onClose, onSubmit, progress, onSkip }: {
  day: string; isToday: boolean; current?: string; options: Option[]; onClose: () => void; onSubmit: (value: string, status: string) => void;
  /** Set while walking through missing days: "Day 2 of 4". */
  progress?: { index: number; total: number }; onSkip?: () => void;
}) {
  // Preselect what is stored now, so "change" starts from the truth.
  const [picked, setPicked] = useState<string | null>(() => options.find((o) => o.status === current)?.value ?? null);
  // A past day can be answered once and never changed, so it gets a second look.
  const [confirming, setConfirming] = useState(false);
  const chosen = options.find((o) => o.value === picked);
  const save = () => {
    if (!chosen) return;
    if (!isToday && !confirming) { setConfirming(true); return; }
    onSubmit(chosen.value, chosen.status);
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-[18px] font-semibold">{isToday ? "Where are you working today?" : `Where were you on ${dayLabel(day)}?`}</h2>
        <Tooltip label="Close" shortcut="Esc" side="bottom"><button onClick={onClose} aria-label="Close" className={`p-1.5 -mr-1.5 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={17} /></button></Tooltip>
      </div>
      <p className="text-[13px] mb-4" style={{ color: C.muted }}>
        {isToday ? "You can change this again until midnight IST." : "You can answer a missed day once. After you save, it cannot be changed."}
      </p>
      {options.length === 0 ? (
        <p className="py-8 text-center text-[13px]" style={{ color: C.muted }}>The options did not load. Refresh the page and try again.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto pr-0.5">
          {options.map((o) => {
            const v = viewOf(o.status); const on = picked === o.value;
            return (
              <button key={o.value} onClick={() => { setPicked(o.value); setConfirming(false); }} aria-pressed={on}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors ${focusRing}`}
                style={{ border: `1.5px solid ${on ? C.primary : C.border}`, background: on ? C.selected : C.surface }}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: v.bg, color: v.color }}><v.Icon size={17} /></span>
                <span className="text-[13px] font-medium leading-tight">{v.verb}</span>
              </button>
            );
          })}
        </div>
      )}
      {confirming && chosen && (
        <div role="alert" className="mt-4 rounded-lg px-3.5 py-3 text-[13px]" style={{ background: C.warnSoft, color: C.warn }}>
          Save <span className="font-semibold">{viewOf(chosen.status).verb}</span> for {dayLabel(day)}? Past answers cannot be changed afterwards.
        </div>
      )}
      <div className="flex items-center gap-2 mt-5">
        {progress && (
          <span className="mr-auto text-[12px]" style={{ color: C.muted }}>
            Day {progress.index} of {progress.total}
            {onSkip && !confirming && <button onClick={onSkip} className={`ml-3 font-medium underline underline-offset-2 ${focusRing}`} style={{ color: C.text2 }}>Skip</button>}
          </span>
        )}
        {!progress && <span className="mr-auto" />}
        <button onClick={confirming ? () => setConfirming(false) : onClose} className={`px-4 h-11 rounded-[10px] text-[14px] font-medium hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.text2 }}>{confirming ? "Back" : "Cancel"}</button>
        <button onClick={save} disabled={!picked} className={`px-6 text-[14px] font-semibold disabled:opacity-40 ${focusRing}`} style={btnPrimary}>{confirming ? "Yes, save" : "Save"}</button>
      </div>
    </>
  );
}

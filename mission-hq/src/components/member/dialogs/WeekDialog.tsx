"use client";

import { addDays, format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { C, focusRing, pctColor, viewOf, Tooltip } from "@/components/ui";
import { fmtDays, scorePeriod } from "@/lib/domain/policy";
import { iso } from "@/lib/format";
import type { Employee } from "@/lib/domain/types";
import { WEEKDAYS } from "../model";

export function WeekDialog({ weekStart, statuses, allowance, today, onClose }: {
  weekStart: string; statuses: Record<string, string>; allowance?: Employee["allowance"]; today: string; onClose: () => void;
}) {
  const start = parseISO(weekStart);
  const days = Array.from({ length: WEEKDAYS }, (_, i) => iso(addDays(start, i)));
  // Same rule as the page: a day still Pending today is not a miss yet.
  const counted = days.filter((d) => statuses[d] && d <= today && (d < today || statuses[d] !== "Pending"));
  const s = scorePeriod(statuses, counted, allowance);

  const reasons: { ok: boolean; text: string }[] = [];
  if (s.available <= 0.001) reasons.push({ ok: true, text: "No days this week counted towards a score, so there is no percentage to explain." });
  else {
    reasons.push({ ok: s.isCompliant, text: `${fmtDays(s.adherent)} of ${fmtDays(s.available)} counted days met the policy.` });
    if (s.wfo > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.wfo)} office ${s.wfo === 1 ? "day" : "days"} counted in full.` });
    if (s.wfh > 0.001) reasons.push({ ok: s.wfhExcess < 0.001, text: s.wfhExcess > 0.001
      ? `${fmtDays(s.wfh)} days at home. One is included, so ${fmtDays(s.wfhExcess)} counted against you.` : "Your one WFH day this week was within the allowance." });
    if (s.pending > 0) reasons.push({ ok: false, text: `${s.pending} ${s.pending === 1 ? "day was" : "days were"} never answered. Unanswered days count as missed.` });
  }
  if (s.leave > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.leave)} leave ${s.leave === 1 ? "day was" : "days were"} left out of the score.` });
  if (s.wfaWithin > 0.001) reasons.push({ ok: true, text: `${fmtDays(s.wfaWithin)} work-from-anywhere ${s.wfaWithin === 1 ? "day was" : "days were"} left out (within your annual balance).` });

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[17px] font-semibold">Week of {format(start, "d MMM")}</h2>
          <div className="text-[30px] font-semibold leading-tight" style={{ color: pctColor(s.pct) }}>{s.pct === null ? "No score" : `${s.pct}%`}</div>
        </div>
        <Tooltip label="Close" shortcut="Esc" side="bottom"><button onClick={onClose} aria-label="Close" className={`p-1.5 -mr-1.5 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={17} /></button></Tooltip>
      </div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {days.map((d) => {
          const st = statuses[d]; const v = st ? viewOf(st) : null;
          return (
            <div key={d} className="flex flex-col items-center gap-1">
              <span className="text-[11px]" style={{ color: C.muted }}>{format(parseISO(d), "EEE d")}</span>
              <div className="w-full h-11 rounded-lg flex items-center justify-center" style={v ? { background: v.bg, color: v.color } : { border: `1.5px dashed ${C.border}` }}>{v && <v.Icon size={18} />}</div>
              <span className="text-[10px] truncate max-w-full" style={{ color: C.text2 }}>{v ? v.short : "None"}</span>
            </div>
          );
        })}
      </div>
      <ul className="space-y-2">
        {reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: C.text2 }}>
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.ok ? C.office : C.bad }} />{r.text}
          </li>
        ))}
      </ul>
    </>
  );
}

"use client";

import { motion } from "framer-motion";
import { Building2, Check, Pencil } from "lucide-react";
import { C, Card, Pill, btnPrimary, focusRing, viewOf, mk } from "@/components/ui";
import type { Employee } from "@/lib/domain/types";

export function TodayCard({ employee, today, isWeekend, editable, onAnswer }: {
  employee: Employee; today: string; isWeekend: boolean; editable: boolean; onAnswer: () => void;
}) {
  const status = employee.statuses[today];
  const answered = !!status && status !== "Pending";
  const tone = status ? viewOf(status) : mk(isWeekend ? "No check-in on weekends" : "No check-in today", "", Building2, C.leave, C.leaveSoft);
  const sub = !status ? (isWeekend ? "Your week starts on Monday." : "You were not asked today, so nothing counts for or against you.")
    : status === "Pending" ? "Tell us where you are working today. It takes a few seconds."
    : status === "Leave" ? "Left out of your score. Leave is managed in Zoho."
    : "You can change today’s answer until midnight IST.";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] tracking-[0.14em]" style={{ color: C.muted }}>TODAY</div>
        {answered && <motion.span initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 28 }}><Pill color={C.office} bg={C.officeSoft}><Check size={12} /> Saved</Pill></motion.span>}
        {status === "Pending" && <Pill color={C.warn} bg={C.warnSoft}>Needs your answer</Pill>}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 mt-3">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <motion.span key={`icon-${status ?? "none"}`} initial={{ scale: 0.55, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 18 }}
            className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: tone.bg, color: tone.color }}><tone.Icon size={26} /></motion.span>
          <motion.div key={`text-${status ?? "none"}`} className="min-w-0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: 0.05 }}>
            <div className="text-[26px] sm:text-[28px] leading-tight font-semibold tracking-tight">{tone.verb}</div>
            <p className="text-[13px] mt-1" style={{ color: C.text2 }}>{sub}</p>
          </motion.div>
        </div>
        {editable && (
          <button onClick={onAnswer} className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 text-[14px] font-semibold transition-opacity hover:opacity-90 flex-shrink-0 ${focusRing}`} style={btnPrimary}>
            {status === "Pending" ? "Answer now" : <><Pencil size={15} /> Change answer</>}
          </button>
        )}
      </div>
    </Card>
  );
}

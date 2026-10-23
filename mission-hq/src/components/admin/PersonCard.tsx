"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { C, Avatar, Card, CountUp, Pill, pctColor, viewOf } from "@/components/ui";
import { bucketOf, siteOf, type PersonRow } from "@/lib/domain/analytics";
import type { Person } from "@/lib/domain/access-types";

/** One person, as a card: who, today, how complete, how they score. Used by People and by department pages. */
export function PersonCard({ row, onOpen }: { row: PersonRow; onOpen: () => void }) {
  const reduce = useReducedMotion();
  const status = row.dayStatus;
  const v = status ? viewOf(status) : null;
  const bucket = bucketOf(status);
  const dept = row.employee.department || "No department";
  const missing = row.missing.length;
  const pct = row.score.pct;
  return (
    <motion.button onClick={onOpen} className="w-full text-left rounded-2xl p-6 h-full" style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)" }}
      whileHover={reduce ? undefined : { y: -3, boxShadow: "0 8px 22px rgb(23 43 44 / 9%)" }} whileTap={reduce ? undefined : { scale: 0.995 }}
      aria-label={`Open ${row.name}'s profile`}>
      <div className="flex items-center gap-4">
        <Avatar name={row.name} size={40} />
        <div className="min-w-0">
          <div className="text-[17px] font-semibold truncate">{row.name}</div>
          <div className="text-[12px] truncate mt-1" style={{ color: C.muted }}>{dept} {"\u00b7"} {row.site}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-5">
        {v && bucket !== "waiting"
          ? <Pill color={v.color} bg={v.bg} className="justify-center !py-2">{v.short}</Pill>
          : bucket === "waiting"
            ? <Pill color={C.warn} bg={C.warnSoft} className="justify-center !py-2">Waiting</Pill>
            : <Pill color={C.muted} bg={C.inset} className="justify-center !py-2">Not asked</Pill>}
        {missing > 0
          ? <Pill color={C.warn} bg={C.warnSoft} className="justify-center !py-2">{missing} missing</Pill>
          : <Pill color={C.text2} bg={C.inset} className="justify-center !py-2">Complete</Pill>}
      </div>
      <div className="flex items-end justify-between mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
        <div>
          <div className="text-[28px] leading-none font-semibold tracking-tight" style={{ color: pct !== null && pctColor(pct) === C.bad ? C.bad : C.text }}>
            {pct === null ? "n/a" : <><CountUp value={pct} />%</>}
          </div>
          <div className="text-[11px] mt-2" style={{ color: C.muted }}>Policy score</div>
        </div>
        <span className="text-[13px] font-medium inline-flex items-center gap-1.5" style={{ color: C.primary }}>Open profile <ArrowRight size={13} /></span>
      </div>
    </motion.button>
  );
}

export function ExitedCard({ person }: { person: Person }) {
  const name = person.full_name || person.email;
  return (
    <Card className="h-full">
      <div className="flex items-center gap-4">
        <Avatar name={name} size={40} />
        <div className="min-w-0">
          <div className="text-[17px] font-semibold truncate">{name}</div>
          <div className="text-[12px] truncate mt-1" style={{ color: C.muted }}>{person.team || "No department"} {"\u00b7"} {siteOf(person)}</div>
        </div>
      </div>
      <div className="mt-5"><Pill color={C.muted} bg={C.inset}>Exited {person.exited_at ? format(parseISO(person.exited_at), "d MMM yyyy") : ""}</Pill></div>
      <p className="text-[12px] mt-4" style={{ color: C.muted }}>Their record stays on file. They are no longer prompted or counted.</p>
    </Card>
  );
}

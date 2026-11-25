"use client";

import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { Info } from "lucide-react";
import { C, Card, Pill, focusRing, btnPrimary } from "@/components/ui";

export function MissingCard({ missed, onAnswer, onReview, compact = false }: {
  missed: string[]; onAnswer: (d: string) => void; onReview: () => void; compact?: boolean;
}) {
  const shown = missed.slice(0, compact ? 8 : 4);
  const chips = shown.map((d, i) => (
    <motion.button key={d} onClick={() => onAnswer(d)} className={`h-9 px-3.5 rounded-lg text-[13px] font-medium transition-colors hover:bg-[#E3EAE7] ${focusRing}`} style={{ background: C.inset }}
      initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.12 + i * 0.045, type: "spring", stiffness: 420, damping: 26 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.95 }}>
      {format(parseISO(d), "d MMM")}
    </motion.button>
  ));
  const more = missed.length > shown.length && <span className="text-[12px] self-center" style={{ color: C.muted }}>+ {missed.length - shown.length} more</span>;

  // On its own page it is one slim row; in the side column it stacks, and is
  // smaller than it was: a prompt for a few days should not out-weigh the week.
  if (compact) {
    return (
      <Card className="!p-4 sm:!px-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Pill color={C.warn} bg={C.warnSoft}><Info size={12} /> {missed.length} missing</Pill>
            <div>
              <h2 className="text-[15px] font-semibold leading-tight">Complete your record</h2>
              <p className="text-[12px]" style={{ color: C.text2 }}>You can answer each missed day once.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-1 min-w-[200px]">{chips}{more}</div>
          <button onClick={onReview} className={`px-5 h-10 text-[13px] font-semibold hover:opacity-90 ${focusRing}`} style={{ ...btnPrimary, minHeight: 40 }}>Review missing days</button>
        </div>
      </Card>
    );
  }
  return (
    <Card className="!p-5">
      <Pill color={C.warn} bg={C.warnSoft}><Info size={12} /> {missed.length} missing</Pill>
      <h2 className="text-[17px] font-semibold mt-2.5">Complete your record</h2>
      <p className="text-[12px] mt-1" style={{ color: C.text2 }}>You can answer each missed day once.</p>
      <div className="flex flex-wrap gap-2 mt-3">{chips}{more}</div>
      <button onClick={onReview} className={`mt-3.5 w-full h-10 text-[13px] font-semibold hover:opacity-90 ${focusRing}`} style={{ ...btnPrimary, minHeight: 40 }}>Review missing days</button>
    </Card>
  );
}

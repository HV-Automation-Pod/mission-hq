"use client";

import { ArrowRight, Globe } from "lucide-react";
import { C, Card, LinkButton, Segments, CountUp } from "@/components/ui";
import { fmtDays } from "@/lib/domain/policy";
import { type ViewData } from "../model";

export function WfaCard({ view, onMore }: { view: ViewData; onMore: () => void }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5 mb-4"><Globe size={17} style={{ color: C.muted }} /><h2 className="text-[15px] font-semibold">Work from anywhere</h2></div>
      {view.wfa ? (() => {
        const { cap, used } = view.wfa;
        const left = cap - used;
        return (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-[40px] leading-none font-semibold tracking-tight" style={{ color: left < -0.001 ? C.bad : C.text }}><CountUp value={Math.abs(left)} format={(n) => fmtDays(n)} /></span>
              <span className="text-[13px]" style={{ color: C.muted }}>{left < -0.001 ? "days over" : "days remaining"}</span>
            </div>
            <div className="mt-4"><Segments cap={cap} used={used} /></div>
            <p className="text-[12px] mt-3" style={{ color: C.muted }}>{fmtDays(used)} of {fmtDays(cap)} used in {view.wfa.year}</p>
          </>
        );
      })() : <p className="text-[13px]" style={{ color: C.muted }}>Your balance is not available right now.</p>}
      <div className="mt-3 flex"><LinkButton color={C.home} onClick={onMore}>All allowances <ArrowRight size={14} /></LinkButton></div>
    </Card>
  );
}

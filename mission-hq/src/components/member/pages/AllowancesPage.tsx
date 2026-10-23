"use client";

import { addDays, format, parseISO } from "date-fns";
import { Globe, Home, Info, Leaf } from "lucide-react";
import { C, Card, Pill, Segments, RiseCard, Stagger, CountUp } from "@/components/ui";
import { fmtDays } from "@/lib/domain/policy";
import { type PageProps } from "../model";
import { PageHead, PersonalChip } from "../parts/PageHead";

export function AllowancesPage({ view, employee, today }: PageProps) {
  const t = view.thisWeek;
  const weekStart = parseISO(view.weekDays[0]);
  const range = `${format(weekStart, "d")}–${format(addDays(weekStart, 4), "d MMMM")}`;
  const w = view.wfa;
  const over = w ? w.cap - w.used < -0.001 : false;

  return (
    <>
      <PageHead crumb="MY WORKSPACE / ALLOWANCES" title="Allowances" sub="Know what you've used, what remains, and which balance each workday belongs to." aside={<PersonalChip />} />
      <Stagger className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <RiseCard>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3"><Globe size={20} style={{ color: C.primary }} /><h2 className="text-[20px] font-semibold">Work from anywhere</h2></div>
            {w && <Pill color={C.text2} bg={C.inset}>{w.year}</Pill>}
          </div>
          {w ? (
            <>
              <div className="flex items-baseline gap-5 mt-8">
                <span className="text-[64px] leading-none font-semibold tracking-tight" style={{ color: over ? C.bad : C.text }}><CountUp value={Math.abs(w.cap - w.used)} format={(n) => fmtDays(n)} /></span>
                <span className="text-[16px]" style={{ color: C.text2 }}>{over ? "days over" : "days remaining"}</span>
              </div>
              <div className="mt-6"><Segments cap={w.cap} used={w.used} color={C.primary} /></div>
              <div className="flex justify-between text-[13px] mt-4"><span className="font-semibold" style={{ color: C.primary }}>{fmtDays(w.used)} used</span><span style={{ color: C.text2 }}>{fmtDays(w.cap)}-day annual allowance</span></div>
              {over && <p className="text-[13px] mt-3" style={{ color: C.warn }}>Days beyond the allowance stay in the calculation without office credit.</p>}
            </>
          ) : <p className="text-[14px] mt-6" style={{ color: C.muted }}>Your balance is not available right now. Nothing is shown rather than a wrong number.</p>}
        </RiseCard>

        <RiseCard>
          <div className="flex items-center gap-3"><Home size={20} style={{ color: C.primary }} /><h2 className="text-[20px] font-semibold">Work from home</h2></div>
          <div className="text-[13px] mt-4" style={{ color: C.muted }}>{range}</div>
          <div className="flex items-baseline gap-3 mt-3"><span className="text-[44px] leading-none font-semibold"><CountUp value={t.wfh} format={(n) => fmtDays(n)} /></span><span className="text-[13px]" style={{ color: C.text2 }}>days recorded / 1 included</span></div>
          {t.wfhExcess > 0.001 && <Pill color={C.warn} bg={C.warnSoft} className="mt-5 w-full !rounded-xl !py-2"><Info size={13} /> {fmtDays(t.wfhExcess)} {t.wfhExcess === 1 ? "day" : "days"} over the weekly allowance</Pill>}
          <p className="text-[12px] mt-4" style={{ color: C.muted }}>This does not use your annual WFA balance.</p>
        </RiseCard>

        <RiseCard>
          <h2 className="text-[20px] font-semibold">Work-from-anywhere history</h2>
          {w ? (
            <>
              <p className="text-[13px] mt-1.5" style={{ color: C.muted }}>{fmtDays(w.used)} recorded {w.used === 1 ? "day" : "days"} against your annual allowance</p>
              <div className="mt-5 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                <div className="grid grid-cols-[1.2fr_1fr_80px] px-4 h-10 items-center text-[11px] tracking-[0.12em]" style={{ background: C.inset, color: C.muted }}><span>DATE</span><span>LOCATION</span><span className="text-right">DAYS USED</span></div>
                {w.before > 0.001 && (
                  <div className="grid grid-cols-[1.2fr_1fr_80px] px-4 h-14 items-center text-[14px]" style={{ borderTop: `1px solid ${C.border}` }}>
                    <span style={{ color: C.text2 }}>Earlier in {w.year}</span><span className="text-[13px]" style={{ color: C.muted }}>Before {format(parseISO(employee.allowance!.windowDates[0] ?? today), "d MMM")}</span><span className="text-right">{fmtDays(w.before)}</span>
                  </div>
                )}
                {[...w.rows].reverse().map((r) => (
                  <div key={r.day} className="grid grid-cols-[1.2fr_1fr_80px] px-4 h-14 items-center text-[14px]" style={{ borderTop: `1px solid ${C.border}` }}>
                    <span>{format(parseISO(r.day), "d MMMM yyyy")}</span>
                    <span className="inline-flex items-center gap-2" style={{ color: C.text2 }}><Globe size={14} /> Anywhere</span>
                    <span className="text-right">{fmtDays(r.used)}</span>
                  </div>
                ))}
                {w.rows.length === 0 && w.before <= 0.001 && <div className="px-4 h-14 flex items-center text-[13px]" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>No work-from-anywhere days recorded this year.</div>}
                <div className="grid grid-cols-[1fr_100px] px-4 h-14 items-center text-[14px] font-semibold" style={{ borderTop: `1px solid ${C.border}` }}><span>Total used in {w.year}</span><span className="text-right">{fmtDays(w.used)} {w.used === 1 ? "day" : "days"}</span></div>
              </div>
            </>
          ) : <p className="text-[13px] mt-3" style={{ color: C.muted }}>History is not available right now.</p>}
        </RiseCard>

        <RiseCard>
          <h2 className="text-[20px] font-semibold">Two different allowances</h2>
          <dl className="mt-5 space-y-5">
            {[
              ["Weekly WFH", "One day per calendar week. You can use it on any weekday."],
              ["Annual WFA", "Within your allowance, Anywhere days are excluded from your score."],
              ["Beyond the annual limit", "Additional Anywhere days stay in the calculation but don't count as office attendance."],
            ].map(([k, v]) => <div key={k}><dt className="text-[14px] font-semibold">{k}</dt><dd className="text-[13px] mt-1 leading-snug" style={{ color: C.text2 }}>{v}</dd></div>)}
          </dl>
        </RiseCard>

        <RiseCard className="lg:col-span-2 flex items-center gap-5">
          <span className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: C.inset, color: C.muted }}><Leaf size={24} /></span>
          <div>
            <h2 className="text-[18px] font-semibold">Looking for your leave balance?</h2>
            <p className="text-[14px] mt-1" style={{ color: C.text2 }}>Leave is managed in Zoho. MissionHQ shows its effect on your attendance record.</p>
            <p className="text-[12px] mt-1.5" style={{ color: C.muted }}>Leave and WFA are separate balances.</p>
          </div>
        </RiseCard>
      </Stagger>
      <p className="text-[12px] mt-6" style={{ color: C.muted }}>Attendance records determine usage. Need a correction? Contact People &amp; Culture.</p>
    </>
  );
}

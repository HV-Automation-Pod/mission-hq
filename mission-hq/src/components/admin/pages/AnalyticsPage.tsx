"use client";

import { useMemo } from "react";
import { C, Card, CountUp, GrowBar, Item, LinkButton, Pill, Stagger, WeekBars } from "@/components/ui";
import { useAdmin } from "../context";
import { FilterBar, Kpi, PageHeading, useScope } from "../ui";
import { aggregate, excessWeeks, weeklySeries } from "@/lib/domain/analytics";
import { ArrowRight } from "lucide-react";

const n0 = (n: number) => Math.round(n).toLocaleString();

export default function AnalyticsPage() {
  const { go, dates, today } = useAdmin();
  const scope = useScope();
  const { agg, rows, period } = scope;

  const weeks = useMemo(() => weeklySeries(rows, dates, today, 6), [rows, dates, today]);
  const weeksOver = useMemo(() => excessWeeks(rows, dates, today, period), [rows, dates, today, period]);
  const depts = useMemo(
    () => scope.depts.map((name) => ({ name, a: aggregate(rows.filter((r) => r.employee.departments.includes(name))) }))
      .filter((d) => d.a.people > 0).sort((x, y) => (y.a.pct ?? -1) - (x.a.pct ?? -1)),
    [scope.depts, rows],
  );

  const answered = agg.requested - agg.unanswered;
  const without = agg.counted - agg.credited;

  return (
    <>
      <PageHeading title="Organisation analytics" sub="Understand patterns across the organisation, with the calculation always in view." />
      <FilterBar scope={scope} />

      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Item><Kpi label="Policy score" valueNode={agg.pct === null ? "n/a" : <><CountUp value={agg.pct} />%</>} sub={`${n0(agg.credited)} / ${n0(agg.counted)} counted days`} /></Item>
        <Item><Kpi label="Response coverage" valueNode={agg.coverage === null ? "n/a" : <><CountUp value={agg.coverage} />%</>} sub={`${n0(answered)} / ${n0(agg.requested)} prompted days`} /></Item>
        <Item><Kpi label="Above weekly WFH" valueNode={<><CountUp value={Math.round(agg.wfhOver)} /> <span className="text-[26px]" style={{ fontWeight: 600 }}>days</span></>} sub={`Across ${n0(weeksOver)} member-weeks`} /></Item>
        <Item><Kpi label="WFA above annual cap" valueNode={<><CountUp value={Math.round(agg.wfaOverDays)} /> <span className="text-[26px]" style={{ fontWeight: 600 }}>days</span></>} sub={`Across ${agg.peopleOverWfa} ${agg.peopleOverWfa === 1 ? "person" : "people"}`} /></Item>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6 items-stretch">
        <Card className="!p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-[22px] font-semibold tracking-tight">Policy score over time</h2>
            <Pill color={C.primary} bg={C.selected}>Weekly</Pill>
          </div>
          <p className="text-[13px] mt-2.5" style={{ color: C.muted }}>Like-for-like calendar weeks {"·"} current week is provisional</p>
          <div className="mt-8">{weeks.length ? <WeekBars points={weeks} /> : <p className="text-[13px]" style={{ color: C.muted }}>There are not enough complete weeks to draw a trend.</p>}</div>
        </Card>

        <Card className="!p-7 flex flex-col">
          <h2 className="text-[22px] font-semibold tracking-tight">What is counted?</h2>
          <dl className="mt-7 space-y-6 text-[13px]">
            {[
              ["Requested days", agg.requested], ["Leave / WFA excluded", agg.excluded], ["Counted days", agg.counted], ["Credited days", agg.credited],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between"><dt style={{ color: C.text2 }}>{k}</dt><dd className="text-[15px] font-semibold">{n0(v as number)}</dd></div>
            ))}
          </dl>
          <div className="mt-auto pt-6 text-[14px]" style={{ borderTop: `1px solid ${C.border}`, color: C.text2 }}>
            {agg.pct === null ? "No counted days in this period." : `${n0(agg.credited)} ÷ ${n0(agg.counted)} = ${agg.pct}%`}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6 items-stretch">
        <Card className="!p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">Department comparison</h2>
          <div className="mt-7 space-y-5">
            {depts.length === 0 && <p className="text-[13px]" style={{ color: C.muted }}>No departments in this scope.</p>}
            {depts.map(({ name, a }, i) => (
              <button key={name} onClick={() => go({ page: "teams", team: name })} className="w-full grid grid-cols-[170px_minmax(0,1fr)_48px] items-center gap-5 text-left rounded-lg hover:bg-[#F7F9F8] -mx-2 px-2 py-1 transition-colors">
                <span className="text-[13px] truncate" style={{ color: C.text2 }}>{name}</span>
                <GrowBar pct={a.pct ?? 0} color={C.brand} delay={i * 0.05} />
                <span className="text-[13px] font-semibold text-right">{a.pct === null ? "n/a" : `${a.pct}%`}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card tone="tint" className="!p-7 flex flex-col">
          <h2 className="text-[22px] font-semibold tracking-tight">{n0(without)} days without credit</h2>
          <ul className="mt-6 space-y-2 text-[13px]" style={{ color: C.text2 }}>
            <li><span className="font-semibold" style={{ color: C.text }}>{n0(agg.unanswered)}</span> unanswered days</li>
            <li><span className="font-semibold" style={{ color: C.text }}>{n0(agg.wfhOver)}</span> home days above the weekly limit</li>
            <li><span className="font-semibold" style={{ color: C.text }}>{n0(agg.wfaOverDays)}</span> WFA days above annual entitlement</li>
          </ul>
          <p className="text-[12px] mt-8 leading-relaxed" style={{ color: C.muted }}>These are attendance measures, not a measure of performance.</p>
          <div className="mt-auto pt-5"><LinkButton onClick={() => go({ page: "attention" })}>Review exceptions <ArrowRight size={14} /></LinkButton></div>
        </Card>
      </div>
    </>
  );
}

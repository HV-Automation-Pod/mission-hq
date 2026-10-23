"use client";

import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { C, Button, Card, CountUp, Item, Stagger, WeekBars } from "@/components/ui";
import { useAdmin } from "../context";
import { PersonCard } from "../PersonCard";
import { EmptyState, Kpi, PageHeading, useScope } from "../ui";
import { aggregate, plural, rangeLabel, weeklySeries } from "@/lib/domain/analytics";

export default function TeamDetailPage() {
  const { route, go, openMember, dates, today } = useAdmin();
  const name = route.team as string;
  const scope = useScope();
  const rows = useMemo(() => scope.rows.filter((r) => r.employee.departments.includes(name)), [scope.rows, name]);
  const a = useMemo(() => aggregate(rows), [rows]);
  const weeks = useMemo(() => weeklySeries(rows, dates, today, 4), [rows, dates, today]);
  const review = useMemo(() => [...rows].filter((r) => r.missing.length > 0).sort((x, y) => y.missing.length - x.missing.length || x.name.localeCompare(y.name)).slice(0, 3), [rows]);

  if (rows.length === 0) {
    return <>
      <button onClick={() => go({ page: "teams" })} className="mb-6 inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: C.primary }}><ChevronLeft size={15} /> All departments</button>
      <EmptyState title={`No people found in ${name}`} body="The department may be empty in this scope, or the filters may be excluding everyone." action={<Button variant="outline" onClick={() => go({ page: "teams" })}>All departments</Button>} />
    </>;
  }

  return (
    <>
      <PageHeading title={name} sub={`${plural(a.people, "person", "people")} · Department membership from Zoho · ${scope.period.label || rangeLabel(scope.period.from, scope.period.to)}`} />
      <div className="flex items-center justify-between gap-4 mb-6">
        <button onClick={() => go({ page: "teams" })} className="inline-flex items-center gap-2 h-11 px-4 rounded-[10px] text-[13px] font-semibold" style={{ background: C.surface, border: `1px solid ${C.border}` }}><ChevronLeft size={15} /> All departments</button>
        <Button onClick={() => go({ page: "people", dept: name })}>View people</Button>
      </div>

      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Item><Kpi label="Policy score" valueNode={a.pct === null ? "n/a" : <><CountUp value={a.pct} />%</>} sub={`${Math.round(a.credited).toLocaleString()} of ${Math.round(a.counted).toLocaleString()} counted days`} /></Item>
        <Item><Kpi label="Today’s coverage" valueNode={<><CountUp value={a.recorded} /> <span style={{ color: C.muted, fontWeight: 500 }}>/ {a.asked}</span></>} sub={`${a.waiting} waiting · ${a.notPrompted} not prompted`} /></Item>
        <Item><Kpi label="Missing past answers" numeric={Math.round(a.missingDays)} tone={a.missingDays ? "warn" : undefined} sub={`Across ${plural(a.peopleMissing, "person", "people")}`} /></Item>
        <Item><Kpi label="WFA over allowance" valueNode={<><CountUp value={a.peopleOverWfa} /> <span className="text-[26px]" style={{ fontWeight: 600 }}>{a.peopleOverWfa === 1 ? "person" : "people"}</span></>} sub="Open profiles to review" onClick={() => go({ page: "attention", attention: "wfa", dept: name })} /></Item>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6 items-stretch">
        <Card className="!p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">Weekly policy trend</h2>
          <p className="text-[13px] mt-2.5" style={{ color: C.muted }}>Each point is a complete calendar week.</p>
          <div className="mt-6">{weeks.length ? <WeekBars points={weeks} /> : <p className="text-[13px]" style={{ color: C.muted }}>There are not enough complete weeks to draw a trend.</p>}</div>
        </Card>
        <Card tone="tint" className="!p-7 flex flex-col">
          <h2 className="text-[22px] font-semibold tracking-tight">Where to focus</h2>
          <div className="text-[44px] leading-none font-semibold tracking-tight mt-8"><CountUp value={a.peopleMissing} /> <span className="text-[30px]">{a.peopleMissing === 1 ? "person" : "people"}</span></div>
          <p className="text-[14px] mt-5 leading-relaxed" style={{ color: C.text2 }}>have at least one unanswered past day. Resolve those before interpreting trends.</p>
          <div className="mt-auto pt-6"><Button className="w-full" onClick={() => go({ page: "attention", attention: "missing", dept: name })}>Review missing answers</Button></div>
        </Card>
      </div>

      <h2 className="text-[22px] font-semibold tracking-tight mt-9">People to review</h2>
      <p className="text-[13px] mt-2 mb-5" style={{ color: C.muted }}>Relevant exceptions, with a route to the individual record.</p>
      {review.length === 0
        ? <EmptyState title="Nobody here has an unanswered past day" body="Records in this department look complete for the loaded period." />
        : <Stagger className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{review.map((r) => <Item key={r.employee.email}><PersonCard row={r} onOpen={() => openMember(r.employee.email)} /></Item>)}</Stagger>}
    </>
  );
}

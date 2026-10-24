"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { ArrowRight } from "lucide-react";
import { C, Button, Card, CountUp, DatePicker, GrowBar, Item, LinkButton, Pill, Stagger, Tooltip } from "@/components/ui";
import { useAdmin } from "../context";
import { ago, FilterBar, Kpi, PageHeading, useScope } from "../ui";
import { aggregate, departmentsOf, type Bucket } from "@/lib/domain/analytics";

/** The five groups, in the order they are drawn, with the colour each keeps everywhere. */
const SEGMENTS: { id: Bucket; label: string; color: string }[] = [
  { id: "office", label: "Office", color: C.brand },
  { id: "home", label: "Home", color: C.home },
  { id: "anywhere", label: "Anywhere", color: "#6FA3A3" },
  { id: "leave", label: "Leave", color: "#9AA8A5" },
  { id: "waiting", label: "Waiting", color: "#D9A44F" },
];

export default function OverviewPage() {
  const { route, go, setFilter, dates, today, admin } = useAdmin();
  const reduce = useReducedMotion();
  const day = route.day && dates.includes(route.day) ? route.day : today;
  const scope = useScope(day);
  const { agg, rows, period } = scope;
  const isToday = day === today;
  const weekend = [0, 6].includes(parseISO(day).getDay());
  const dayName = format(parseISO(day), "EEEE");

  // Only days that have data can be chosen: weekends, holidays and anything
  // before the loaded window are drawn muted in the calendar.
  const loaded = useMemo(() => new Set(dates), [dates]);
  const firstDay = useMemo(() => [...dates].sort()[0], [dates]);

  const departments = useMemo(
    () => departmentsOf(rows).map((name) => ({ name, a: aggregate(rows.filter((r) => r.employee.departments.includes(name))) }))
      .sort((x, y) => y.a.people - x.a.people).slice(0, 4),
    [rows],
  );

  const directory = admin?.triage.length ?? 0;
  const paused = admin?.jobs.filter((j) => !j.active).length ?? 0;
  const things = [
    { n: agg.waiting, text: `${agg.waiting} unanswered ${isToday ? "today" : "that day"}`, link: "Review people still waiting", go: () => go({ page: "attention", attention: "waiting" }) },
    { n: directory, text: `${directory} directory ${directory === 1 ? "mismatch" : "mismatches"}`, link: "Resolve Slack / Zoho differences", go: () => go({ page: "administration", tab: "directory" }) },
    { n: agg.peopleOverWfa, text: `${agg.peopleOverWfa} ${agg.peopleOverWfa === 1 ? "person" : "people"} over WFA allowance`, link: "Review individual balances", go: () => go({ page: "attention", attention: "wfa" }) },
  ].filter((t) => t.n > 0);

  const total = SEGMENTS.reduce((n, s) => n + agg.mix[s.id], 0);
  const monthName = period.key === "all" ? "Policy score" : `${format(parseISO(period.from), "MMMM")} policy score`;

  return (
    <>
      <PageHeading title="A clear view of today."
        sub={`${format(parseISO(day), "EEEE, d MMMM yyyy")} · See who has checked in and what needs your attention.`} />

      <FilterBar scope={scope} showPeriod={false}
        leading={
          <DatePicker label="Day" hideLabel className="w-[250px]" value={day} today={today} min={firstDay} max={today}
            isDisabled={(d) => !loaded.has(d)} onChange={(v) => setFilter({ day: v === today ? null : v })}
            display={day === today ? `Today \u00b7 ${format(parseISO(day), "d MMMM")}` : format(parseISO(day), "EEE d MMMM yyyy")} />} />

      {weekend && (
        <Card tone="tint" className="!p-6 mb-4">
          <div className="text-[16px] font-semibold">{isToday ? `Today is a weekend (${dayName})` : `${dayName} was a weekend`}</div>
          <p className="text-[13px] mt-1" style={{ color: C.text2 }}>
            No check-ins are requested on weekends, so there is nothing to record. The next check-in goes out on the next working day.
          </p>
        </Card>
      )}

      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Item><Kpi label="People in scope" numeric={agg.people} sub={weekend ? "Weekend, no check-ins requested" : `${agg.asked} asked ${isToday ? "today" : "that day"} · ${agg.notPrompted} not prompted`} onClick={() => go({ page: "people" })} /></Item>
        <Item><Kpi label={isToday ? "Recorded today" : "Recorded"} onClick={() => go({ page: "people" })}
          valueNode={<><CountUp value={agg.recorded} /> <span style={{ color: C.muted, fontWeight: 500 }}>/ {agg.asked}</span></>}
          sub={agg.asked ? `${Math.round((agg.recorded / agg.asked) * 100)}% response coverage` : weekend ? "Weekend" : "Nobody was asked"} /></Item>
        <Item><Kpi label="Still waiting" numeric={agg.waiting} tone={agg.waiting > 0 ? "warn" : undefined} sub={weekend ? "Weekend" : isToday ? "Today’s check-in is unanswered" : "Unanswered that day"} onClick={() => go({ page: "attention", attention: "waiting" })} /></Item>
        <Item><Kpi label={monthName} valueNode={agg.pct === null ? "n/a" : <><CountUp value={agg.pct} />%</>}
          sub={agg.pct === null ? "No counted days in this period" : `${Math.round(agg.credited).toLocaleString()} of ${Math.round(agg.counted).toLocaleString()} counted days`} onClick={() => go({ page: "analytics" })} /></Item>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6 items-stretch">
        {weekend ? (
        <Card className="!p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">Where people are working</h2>
          <p className="text-[15px] mt-6" style={{ color: C.text2 }}>
            {isToday ? "Today is a weekend" : `${dayName} was a weekend`}. Nobody is asked where they are working, so there is no breakdown to show.
          </p>
        </Card>
        ) : (
        <Card className="!p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">Where people are working</h2>
          <p className="text-[13px] mt-2" style={{ color: C.muted }}>
            {agg.asked} requested check-ins{isToday ? " · Today is still in progress" : ""}
          </p>

          {total > 0 ? (
            <div className="flex h-[30px] gap-[3px] mt-8 [&>span:first-child>div]:rounded-l-[10px] [&>span:last-child>div]:rounded-r-[10px]" role="img"
              aria-label={SEGMENTS.map((s) => `${s.label} ${agg.mix[s.id]}`).join(", ")}>
              {SEGMENTS.filter((s) => agg.mix[s.id] > 0).map((s, i) => (
                <Tooltip key={s.id} label={`${s.label}: ${agg.mix[s.id]}`} className="h-full min-w-[4px]" style={{ flexGrow: agg.mix[s.id], flexBasis: 0 }}>
                  <motion.div className="h-full w-full" style={{ background: s.color }}
                    initial={reduce ? false : { opacity: 0, scaleX: 0.6 }} animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 + i * 0.05 }} />
                </Tooltip>
              ))}
            </div>
          ) : <div className="h-[30px] mt-8 rounded-md" style={{ background: C.inset }} />}

          <div className="grid grid-cols-5 gap-4 mt-6">
            {SEGMENTS.map((s) => (
              <div key={s.id}>
                <div className="flex items-center gap-2 text-[12px]" style={{ color: C.text2 }}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
                </div>
                <div className="text-[36px] leading-none font-semibold tracking-tight mt-3"><CountUp value={agg.mix[s.id]} /></div>
              </div>
            ))}
          </div>
          <div className="mt-7 pt-5 text-[13px]" style={{ borderTop: `1px solid ${C.border}`, color: C.text2 }}>
            {agg.notPrompted} {agg.notPrompted === 1 ? "person was" : "people were"} not prompted; they are not counted as missing.
          </div>
        </Card>
        )}

        <Card tone="tint" className="!p-7 flex flex-col">
          <h2 className="text-[22px] font-semibold tracking-tight">Start here</h2>
          {things.length > 0 ? (
            <div className="mt-6 space-y-6">
              {things.map((t) => (
                <div key={t.text}>
                  <div className="text-[16px] font-semibold">{t.text}</div>
                  <div className="mt-2"><LinkButton onClick={t.go}>{t.link} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></LinkButton></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[14px] mt-6" style={{ color: C.text2 }}>Nothing needs attention right now. Unanswered check-ins, directory differences and allowance overruns will appear here.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 mt-6 items-stretch">
        {weekend ? (
        <Card className="!p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">Department snapshot</h2>
          <p className="text-[15px] mt-6" style={{ color: C.text2 }}>No response coverage on a weekend.</p>
          <div className="mt-7"><LinkButton onClick={() => go({ page: "teams" })}>Explore all departments <ArrowRight size={14} /></LinkButton></div>
        </Card>
        ) : (
        <Card className="!p-7">
          <h2 className="text-[22px] font-semibold tracking-tight">Department snapshot</h2>
          <p className="text-[13px] mt-2" style={{ color: C.muted }}>{isToday ? "Today’s" : "That day’s"} response coverage</p>
          <div className="mt-7 space-y-6">
            {departments.length === 0 && <p className="text-[13px]" style={{ color: C.muted }}>No departments in this scope.</p>}
            {departments.map(({ name, a }, i) => (
              <button key={name} onClick={() => go({ page: "teams", team: name })} className="w-full grid grid-cols-[150px_minmax(0,1fr)_72px] items-center gap-5 text-left rounded-lg hover:bg-[#F7F9F8] -mx-2 px-2 py-1 transition-colors">
                <span className="text-[14px] truncate" style={{ color: C.text2 }}>{name}</span>
                <GrowBar pct={a.asked ? (a.recorded / a.asked) * 100 : 0} color={C.brand} height={8} delay={i * 0.06} />
                <span className="text-[14px] font-medium text-right">{a.recorded} / {a.asked}</span>
              </button>
            ))}
          </div>
          <div className="mt-7"><LinkButton onClick={() => go({ page: "teams" })}>Explore all departments <ArrowRight size={14} /></LinkButton></div>
        </Card>
        )}

        <Card className="!p-7 flex flex-col">
          <h2 className="text-[22px] font-semibold tracking-tight">Operations</h2>
          <div className="mt-5">
            {!admin ? <Pill color={C.muted} bg={C.inset}>Loading schedules</Pill>
              : paused > 0 ? <Pill color={C.warn} bg={C.warnSoft}>{paused} {paused === 1 ? "schedule" : "schedules"} paused</Pill>
              : admin.jobs.length > 0 ? <Pill color={C.office} bg={C.officeSoft}>Schedules active</Pill>
              : <Pill color={C.muted} bg={C.inset}>No schedules found</Pill>}
          </div>
          <p className="text-[13px] mt-6" style={{ color: C.text2 }}>
            {admin?.slackSyncedAt ? `Slack directory synced ${ago(admin.slackSyncedAt)}.` : "Slack directory sync time is not available."}
          </p>
          <p className="text-[13px] mt-5 leading-relaxed" style={{ color: C.muted }}>A schedule being active does not confirm that its last run succeeded.</p>
          <div className="mt-auto pt-6"><Button variant="outline" className="w-full" onClick={() => go({ page: "administration", tab: "operations" })}>Open administration</Button></div>
        </Card>
      </div>
    </>
  );
}

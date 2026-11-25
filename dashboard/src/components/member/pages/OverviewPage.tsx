"use client";

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { ArrowRight, Check, Flame } from "lucide-react";
import { C, Card, CountUp, GrowBar, Item, LinkButton, Stagger, Tooltip, pctColor } from "@/components/ui";
import { fmtDays } from "@/lib/domain/policy";
import { greeting, weekVerdict, type PageProps } from "../model";
import { PersonalChip } from "../parts/PageHead";
import { StickyColumn } from "../parts/StickyColumn";
import { TodayCard } from "../parts/TodayCard";
import { MissingCard } from "../parts/MissingCard";
import { WfaCard } from "../parts/WfaCard";
import { CalendarCard } from "../parts/CalendarCard";
import { WeekCell } from "../parts/WeekCell";

export function OverviewPage(p: PageProps & { firstName: string; hour: number }) {
  const { employee, view, today, now, canAnswer, onAnswer, setPage, holidays, isWeekend } = p;
  const v = weekVerdict(view.thisWeek);
  const weekStart = parseISO(view.weekDays[0]);
  const range = `${format(weekStart, "d")}–${format(addDays(weekStart, 4), "d MMMM")}`;
  const missed = view.missed;

  return (
    <>
      <div className="mb-6 lg:mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] lg:text-[13px] mb-3 lg:mb-4 uppercase lg:normal-case tracking-[0.08em] lg:tracking-normal" style={{ color: C.muted }}>
            {format(now, "EEEE, d MMMM")}<span className="hidden lg:inline">{format(now, " yyyy")}</span>
          </div>
          <h1 className="text-[34px] lg:text-[32px] font-semibold leading-tight tracking-tight">{greeting(p.hour)}, {p.firstName}.</h1>
          <p className="hidden lg:block text-[14px] mt-3" style={{ color: C.text2 }}>Your personal attendance, with a clear view of what&apos;s next.</p>
        </div>
        <PersonalChip />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        {/* The left column is the shorter one. It stays pinned while the page
            scrolls through the longer right column, then lets go at the end:
            no nested scrollbar, one scroll, nothing fighting for the wheel. */}
        <StickyColumn className="min-w-0">
          <Stagger className="space-y-6">
          <Item><TodayCard employee={employee} today={today} isWeekend={isWeekend} editable={canAnswer(today)} onAnswer={() => onAnswer(today)} /></Item>

          {/* Phone: the design shows this week as five cards, with History for the rest. */}
          <Item className="lg:hidden"><section>
            <div className="flex items-end justify-between mb-3">
              <div>
                <h2 className="text-[20px] font-semibold">My attendance</h2>
                <div className="text-[13px] mt-1" style={{ color: C.muted }}>{range}</div>
              </div>
              <LinkButton color={C.home} onClick={() => setPage("attendance")}>History <ArrowRight size={14} /></LinkButton>
            </div>
            <Stagger className="grid grid-cols-5 gap-2">
              {view.weekDays.map((d) => <Item key={d} className="min-w-0"><WeekCell day={d} today={today} status={employee.statuses[d]}
                open={canAnswer(d)} onAnswer={() => onAnswer(d)} /></Item>)}
            </Stagger>
          </section></Item>

          <Item className="hidden lg:block"><CalendarCard {...p} /></Item>

        <Item><Card className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 !py-5">
          <div className="text-[34px] font-semibold tracking-tight leading-none" style={{ color: pctColor(view.overall.pct) }}>
            {view.overall.pct === null ? "n/a" : <><CountUp value={view.overall.pct} />%</>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">Policy adherence since {format(parseISO(p.employee.allowance?.windowDates[0] ?? view.recent[0]?.weekStart ?? today), "d MMMM")}</div>
            <div className="text-[12px] mt-0.5" style={{ color: C.muted }}>
              {view.weeksTotal > 0 ? `${view.weeksMet} of ${view.weeksTotal} completed weeks fully met` : "No completed weeks yet"}
              {view.streak.current > 0 && <> &middot; <Flame size={11} className="inline -mt-0.5" style={{ color: "#c2410c" }} /> {view.streak.current}-day office streak (best {view.streak.best})</>}
            </div>
          </div>
          <LinkButton color={C.home} onClick={() => setPage("policies")}>Understand your record <ArrowRight size={14} /></LinkButton>
        </Card></Item>
          </Stagger>
        </StickyColumn>

        <Stagger className="space-y-6 min-w-0">
          <Item>{missed.length > 0 ? <MissingCard missed={missed} onAnswer={onAnswer} onReview={p.onReview} />
            : <Card className="flex items-center gap-3"><span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: C.officeSoft, color: C.office }}><Check size={17} /></span>
                <div><div className="text-[15px] font-semibold">Your record is complete</div><div className="text-[12px]" style={{ color: C.muted }}>Nothing is waiting for an answer.</div></div></Card>}</Item>

          <Item><Card>
            <h2 className="text-[17px] font-semibold">This week</h2>
            <div className="text-[13px] mt-1" style={{ color: C.muted }}>{range}</div>
            <div className="flex items-center gap-5 mt-5">
              <div className="text-[44px] leading-none font-semibold tracking-tight" style={{ color: v.label === "On track" ? C.text : pctColor(view.thisWeek.pct) }}>
                {view.thisWeek.pct === null ? "n/a" : <><CountUp value={view.thisWeek.pct} />%</>}
              </div>
              <p className="text-[13px] leading-snug" style={{ color: C.text2 }}>{v.detail}</p>
            </div>
            <div className="mt-4"><GrowBar pct={view.thisWeek.pct ?? 0} delay={0.2} /></div>
            {view.thisWeek.wfh > 0.001 && (
              <p className="text-[12px] mt-3" style={{ color: view.thisWeek.wfhExcess > 0.001 ? C.warn : C.muted }}>
                {fmtDays(view.thisWeek.wfh)} home {view.thisWeek.wfh === 1 ? "day" : "days"} recorded &middot; {fmtDays(Math.min(view.thisWeek.wfh, 1))} included weekly
              </p>
            )}
            <div className="mt-4 flex"><LinkButton color={C.home} onClick={() => setPage("policies")}>View weekly breakdown <ArrowRight size={14} /></LinkButton></div>
          </Card></Item>

          <Item><WfaCard view={view} onMore={() => setPage("allowances")} /></Item>

          {holidays.length > 0 && (
            <Item><Card>
              <h2 className="text-[17px] font-semibold mb-4">Coming up</h2>
              <ul className="space-y-3.5">
                {holidays.slice(0, 3).map((h) => {
                  const d = parseISO(h.day);
                  const n = differenceInCalendarDays(d, now);
                  return (
                    <li key={h.day} className="flex items-center gap-3.5">
                      <span className="w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0" style={{ background: C.inset }}>
                        <span className="text-[15px] font-semibold leading-none">{format(d, "dd")}</span>
                        <span className="text-[9px] tracking-wide mt-0.5" style={{ color: C.muted }}>{format(d, "MMM").toUpperCase()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{h.name}</span>
                        <Tooltip width={230} side="top"
                          label={h.kind === "closed" ? "The office is closed." : "Restricted holiday: optional, taken per person. The office is open."}>
                          <span className="block text-[11px] cursor-default" style={{ color: h.kind === "closed" ? C.muted : C.home }}>
                            {h.kind === "closed" ? "Office closed" : "Optional holiday"}
                          </span>
                        </Tooltip>
                      </span>
                      <span className="text-[11px] flex-shrink-0" style={{ color: C.muted }}>{n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n}d`}</span>
                    </li>
                  );
                })}
              </ul>
            </Card></Item>
          )}
        </Stagger>
      </div>

    </>
  );
}

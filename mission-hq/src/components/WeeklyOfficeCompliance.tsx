"use client";

import { Employee } from "@/lib/types";
import { useState, useMemo } from "react";
import { CheckCircle2, XCircle, Building2, ChevronDown, ChevronUp, Trophy, AlertCircle, Sparkles } from "lucide-react";
import { startOfWeek, addDays, format, startOfMonth, endOfMonth } from "date-fns";
import { scorePeriod, fmtDays, isRealWeek, type PeriodScore } from "@/lib/policy";
import Tooltip from "./Tooltip";

/*
 * Scored by `lib/policy.ts` — the same rule as the fortnightly Slack report.
 *
 * This screen used to count `officeDays >= 4` and ignore WHICH day. In a week
 * like Sep 28 - Oct 2 (four working days; Oct 2 was Gandhi Jayanti) somebody
 * following the policy exactly — office Mon, Tue, Thu, home Wednesday — scored
 * 3/4 and read as non-compliant, while Slack called the same fortnight 100%.
 * Wednesday WFH now counts in full, and the target is "every available day",
 * which lands on 4 in an ordinary week without hardcoding the number 4.
 *
 * There is also no holiday list here any more. A day with no attendance row is
 * a day nobody was asked about, so holidays, weekends, future days and days
 * before somebody joined all drop out on their own — the way they do in SQL.
 * The old hardcoded 2026 list would have needed editing every January and
 * would have disagreed with the database the moment PnC moved a holiday.
 */

type PeriodTab = "this" | "last" | "month";

interface Props {
  employees: Employee[];
  dates: string[];
}

export default function WeeklyOfficeCompliance({ employees, dates }: Props) {
  const [periodTab, setPeriodTab] = useState<PeriodTab>("this");
  const [showAll, setShowAll] = useState(false);

  const today = new Date();
  const thisMonday = startOfWeek(today, { weekStartsOn: 1 });
  const lastMonday = addDays(thisMonday, -7);
  const monday = periodTab === "last" ? lastMonday : thisMonday;

  // Mon-Fri of the selected week. Handed to the scorer whole: it keeps the
  // days this person was actually asked about and discards the rest.
  const weekDates = useMemo(
    () => Array.from({ length: 5 }, (_, i) => format(addDays(monday, i), "yyyy-MM-dd")),
    [monday],
  );

  // For the header only. Days anybody was prompted on, which is the week's
  // working days once holidays and the future have excluded themselves.
  const workingDaysCount = useMemo(() => {
    const dateSet = new Set(dates);
    return weekDates.filter((d) => dateSet.has(d)).length;
  }, [weekDates, dates]);

  const employeeStats = useMemo(() => {
    return employees.map((emp) => ({
      name: emp.name,
      email: emp.email,
      departments: emp.departments,
      department: emp.department,
      score: scorePeriod(emp.statuses, weekDates, emp.allowance),
    }))
      // Compliant first, then by how close they got. Somebody with nothing
      // available — a full week of leave — sorts last rather than as a 0%.
      .sort((a, b) => (b.score.pct ?? -1) - (a.score.pct ?? -1) || b.score.adherent - a.score.adherent);
  }, [employees, weekDates]);

  // Anybody with nothing available is out of both the numerator and the
  // denominator: a week of leave is not a pass and not a failure.
  const scored = employeeStats.filter((e) => e.score.pct !== null);
  const compliantCount = scored.filter((e) => e.score.isCompliant).length;
  const nonCompliantCount = scored.length - compliantCount;
  const complianceRate = scored.length > 0 ? Math.round((compliantCount / scored.length) * 100) : 0;
  const onLeaveCount = employeeStats.length - scored.length;

  const weekLabel = `${format(addDays(monday, 0), "MMM d")} – ${format(addDays(monday, 4), "MMM d")}`;
  const isCurrentWeekPartial = periodTab === "this" && workingDaysCount < 5;

  const displayList = showAll ? employeeStats : employeeStats.slice(0, 10);

  // ── Monthly stats ────────────────────────────────────────
  const monthlyData = useMemo(() => {
    if (periodTab !== "month") return null;
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const todayStr = format(today, "yyyy-MM-dd");

    // Mon-Fri runs intersecting the month, clipped to in-month days. A week
    // straddling the 1st is scored on its in-month half only, so October does
    // not inherit a judgement about September.
    const weeks: { mondayStr: string; days: string[]; isCurrentWeek: boolean }[] = [];
    let cursor = startOfWeek(monthStart, { weekStartsOn: 1 });
    while (cursor <= monthEnd) {
      const all = Array.from({ length: 5 }, (_, i) => addDays(cursor, i));
      const days = all
        .filter((d) => d.getMonth() === monthStart.getMonth())
        .map((d) => format(d, "yyyy-MM-dd"));
      if (days.length > 0) {
        weeks.push({
          mondayStr: format(cursor, "MMM d"),
          days,
          isCurrentWeek: days.includes(todayStr),
        });
      }
      cursor = addDays(cursor, 7);
    }

    type EmpWeek = { score: PeriodScore; counts: boolean; isCurrentWeek: boolean };
    type EmpMonth = {
      name: string; email: string; departments: string[]; department: string;
      weeks: EmpWeek[];
      totalAdherent: number;
      compliantWeeks: number;
      /** Weeks that were a real week FOR THIS PERSON. Somebody on leave for a
       *  whole week has one fewer week to be judged on, not a failed one. */
      countedWeeks: number;
      isPerfectMonth: boolean;
    };

    const empData: EmpMonth[] = employees.map((emp) => {
      const wkStats: EmpWeek[] = weeks.map((w) => {
        const score = scorePeriod(emp.statuses, w.days, emp.allowance);
        return { score, counts: isRealWeek(score.available), isCurrentWeek: w.isCurrentWeek };
      });

      const totalAdherent = wkStats.reduce((sum, w) => sum + w.score.adherent, 0);
      const counted = wkStats.filter((w) => w.counts);
      const compliantWeeks = counted.filter((w) => w.score.isCompliant).length;
      const isPerfectMonth = counted.length > 0 && compliantWeeks === counted.length;

      return {
        name: emp.name,
        email: emp.email,
        departments: emp.departments,
        department: emp.department,
        weeks: wkStats,
        totalAdherent,
        compliantWeeks,
        countedWeeks: counted.length,
        isPerfectMonth,
      };
    }).sort((a, b) => {
      if (a.isPerfectMonth !== b.isPerfectMonth) return a.isPerfectMonth ? -1 : 1;
      if (b.compliantWeeks !== a.compliantWeeks) return b.compliantWeeks - a.compliantWeeks;
      return b.totalAdherent - a.totalAdherent;
    });

    const dateSet = new Set(dates);
    const totalWorkingDaysInMonth = weeks.flatMap((w) => w.days).filter((d) => dateSet.has(d)).length;
    const perfectMonthCount = empData.filter((e) => e.isPerfectMonth).length;
    const atRiskCount = empData.filter((e) => e.countedWeeks > 0 && e.compliantWeeks === 0).length;

    // Average of each person's compliantWeeks / countedWeeks. People with no
    // counted week are left out entirely rather than averaged in as zero.
    const judged = empData.filter((e) => e.countedWeeks > 0);
    const avgCompliance = judged.length > 0
      ? Math.round(judged.reduce((sum, e) => sum + e.compliantWeeks / e.countedWeeks, 0) / judged.length * 100)
      : 0;

    return {
      weeks,
      empData,
      totalWorkingDaysInMonth,
      perfectMonthCount,
      atRiskCount,
      avgCompliance,
      monthLabel: format(monthStart, "MMMM yyyy"),
    };
  }, [periodTab, employees, dates, today]);

  const monthDisplayList = monthlyData
    ? (showAll ? monthlyData.empData : monthlyData.empData.slice(0, 10))
    : [];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
            <Building2 size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {periodTab === "month" ? "Monthly Office Tracker" : "Weekly Office Check"}
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {periodTab === "month" && monthlyData
                ? `${monthlyData.monthLabel} · ${monthlyData.weeks.length} week${monthlyData.weeks.length !== 1 ? "s" : ""} · ${monthlyData.totalWorkingDaysInMonth} working days so far`
                : <>{weekLabel} &middot; {workingDaysCount} working day{workingDaysCount !== 1 ? "s" : ""}{isCurrentWeekPartial && " (in progress)"} &middot; office every available day, Wednesday at home counts in full</>
              }
            </p>
          </div>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--bg-inset)" }}>
          {(["this", "last", "month"] as PeriodTab[]).map((p) => (
            <button key={p} onClick={() => { setPeriodTab(p); setShowAll(false); }}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
              style={{
                background: periodTab === p ? "var(--bg-surface)" : "transparent",
                color: periodTab === p ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: periodTab === p ? "var(--shadow-xs)" : "none",
              }}>
              {p === "this" ? "This Week" : p === "last" ? "Last Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {periodTab === "month" && monthlyData ? (
        <div className="animate-fade-in">
          {/* Monthly summary cards */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3.5 rounded-xl border relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(234, 179, 8, 0.08), rgba(245, 158, 11, 0.04))", borderColor: "rgba(234, 179, 8, 0.25)" }}>
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                <Trophy size={11} className="text-amber-500" /> Perfect Month
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">{monthlyData.perfectMonthCount}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {monthlyData.empData.length}</span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>All weeks compliant</div>
              {monthlyData.perfectMonthCount > 0 && (
                <Sparkles size={32} className="absolute -right-1 -bottom-1 text-amber-500 opacity-10" />
              )}
            </div>
            <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Avg Compliance</div>
              <div className={`text-2xl font-bold font-mono ${monthlyData.avgCompliance >= 80 ? "text-emerald-600 dark:text-emerald-400" : monthlyData.avgCompliance >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                {monthlyData.avgCompliance}%
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Across all employees</div>
            </div>
            <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                <AlertCircle size={11} className="text-red-400" /> At Risk
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold font-mono text-red-500 dark:text-red-400">{monthlyData.atRiskCount}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {monthlyData.empData.length}</span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Zero compliant weeks</div>
            </div>
          </div>

          {/* Employee list - monthly */}
          <div className="overflow-y-auto scrollbar-thin rounded-lg border" style={{ borderColor: "var(--border-subtle)", maxHeight: showAll ? "560px" : undefined }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface-secondary)" }}>
                <tr>
                  <th className="text-left py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Employee</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden md:table-cell" style={{ color: "var(--text-secondary)" }}>Department</th>
                  <th className="text-center py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Week by week</th>
                  <th className="text-center py-2.5 px-3 font-medium hidden sm:table-cell" style={{ color: "var(--text-secondary)" }}>Adherent</th>
                  <th className="text-center py-2.5 px-3 font-medium w-20" style={{ color: "var(--text-secondary)" }}>Weeks Met</th>
                </tr>
              </thead>
              <tbody>
                {monthDisplayList.map((emp) => (
                  <tr key={emp.email} className="table-row-hover" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`avatar w-7 h-7 text-[10px] relative ${
                          emp.isPerfectMonth
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                            : emp.compliantWeeks > 0
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                        }`}>
                          {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                          {emp.isPerfectMonth && (
                            <Trophy size={10} className="absolute -top-1 -right-1 text-amber-500 bg-white dark:bg-[var(--bg-surface)] rounded-full p-[1px]" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-[13px] flex items-center gap-1" style={{ color: "var(--text-primary)" }}>
                            {emp.name}
                          </div>
                          <div className="text-[10px] truncate max-w-[140px]" style={{ color: "var(--text-muted)" }}>{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 hidden md:table-cell text-[13px]" style={{ color: "var(--text-muted)" }}>
                      {emp.departments?.length > 1 ? (
                        <div className="flex flex-wrap gap-1">
                          {emp.departments.map((dept) => (
                            <span key={dept} className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--bg-inset)" }}>{dept}</span>
                          ))}
                        </div>
                      ) : emp.department}
                    </td>
                    {/* Weekly mini-bars */}
                    <td className="py-2.5 px-3">
                      <WeeklyMiniBars weeks={emp.weeks} weekLabels={monthlyData.weeks.map((w) => w.mondayStr)} />
                    </td>
                    <td className="py-2.5 px-3 text-center hidden sm:table-cell">
                      <span className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>{fmtDays(emp.totalAdherent)}</span>
                      <span className="text-[10px] ml-0.5" style={{ color: "var(--text-muted)" }}>days</span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                        emp.isPerfectMonth
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          : emp.compliantWeeks > 0
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      }`}>
                        <span className="font-mono">{emp.compliantWeeks}/{emp.countedWeeks || "\u2014"}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {monthlyData.empData.length > 10 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-colors"
              style={{ color: "var(--text-muted)", background: "var(--bg-inset)" }}
            >
              {showAll ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show all {monthlyData.empData.length} employees</>}
            </button>
          )}
        </div>
      ) : (
        <div className="animate-fade-in">
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Compliance</div>
              <div className={`text-2xl font-bold font-mono ${complianceRate >= 80 ? "text-emerald-600 dark:text-emerald-400" : complianceRate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                {complianceRate}%
              </div>
            </div>
            <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Compliant</div>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{compliantCount}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {scored.length}</span>
              </div>
            </div>
            <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Not Yet</div>
              <div className="flex items-center gap-2">
                <XCircle size={16} className="text-red-400" />
                <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{nonCompliantCount}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {scored.length}</span>
              </div>
              {onLeaveCount > 0 && (
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {onLeaveCount} not scored (leave or away all week)
                </div>
              )}
            </div>
          </div>

          {/* Employee list */}
          <div className="overflow-y-auto scrollbar-thin rounded-lg border" style={{ borderColor: "var(--border-subtle)", maxHeight: showAll ? "500px" : undefined }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface-secondary)" }}>
                <tr>
                  <th className="text-left py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Employee</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell" style={{ color: "var(--text-secondary)" }}>Department</th>
                  <th className="text-center py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Adherent / Available</th>
                  <th className="text-center py-2.5 px-3 font-medium w-10" style={{ color: "var(--text-secondary)" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayList.map((emp) => (
                  <tr key={emp.email} className="table-row-hover" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`avatar w-7 h-7 text-[10px] ${
                          emp.score.pct === null
                            ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            : emp.score.isCompliant
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                        }`}>
                          {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium text-[13px]" style={{ color: "var(--text-primary)" }}>{emp.name}</div>
                          <div className="text-[10px] truncate max-w-[140px]" style={{ color: "var(--text-muted)" }}>{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 hidden sm:table-cell text-[13px]" style={{ color: "var(--text-muted)" }}>
                      {emp.departments?.length > 1 ? (
                        <div className="flex flex-wrap gap-1">
                          {emp.departments.map((dept) => (
                            <span key={dept} className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: "var(--bg-inset)" }}>{dept}</span>
                          ))}
                        </div>
                      ) : emp.department}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {emp.score.pct === null ? (
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Not scored</span>
                      ) : (
                        <>
                          <Tooltip width={220} label={
                            `${fmtDays(emp.score.wfo)} office + ${fmtDays(emp.score.adherent - emp.score.wfo)} Wednesday WFH, out of ${fmtDays(emp.score.available)} available` +
                            (emp.score.wfhOffWed > 0 ? ` \u00b7 ${fmtDays(emp.score.wfhOffWed)} WFH on another weekday` : "") +
                            (emp.score.pending > 0 ? ` \u00b7 ${fmtDays(emp.score.pending)} unanswered` : "")}>
                            <span className="flex items-center justify-center gap-1.5">
                              <span className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>{fmtDays(emp.score.adherent)}</span>
                              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {fmtDays(emp.score.available)}</span>
                            </span>
                          </Tooltip>
                          <div className="w-16 mx-auto rounded-full h-1.5 mt-1" style={{ background: "var(--bg-inset)" }}>
                            <div
                              className={`h-1.5 rounded-full transition-all duration-300 ${emp.score.isCompliant ? "bg-emerald-500" : emp.score.pct >= 75 ? "bg-amber-500" : "bg-red-400"}`}
                              style={{ width: `${Math.min(emp.score.pct, 100)}%` }}
                            />
                          </div>
                        </>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {emp.score.pct === null
                        ? <span className="text-xs" style={{ color: "var(--text-faint)" }}>&mdash;</span>
                        : emp.score.isCompliant
                          ? <CheckCircle2 size={16} className="text-emerald-500 inline" />
                          : <XCircle size={16} className="text-red-400 inline" />
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {employeeStats.length > 10 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-colors"
              style={{ color: "var(--text-muted)", background: "var(--bg-inset)" }}
            >
              {showAll ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show all {employeeStats.length} employees</>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One bar per week, filled by how close that week came to the policy.
 *
 * The bar is a PERCENTAGE, not a day count, so a four-day holiday week and a
 * five-day week both reach the top when the person adhered — which is the
 * point: the old bars divided by a fixed 4 and so left a perfect short week
 * looking like a miss.
 */
function WeeklyMiniBars({ weeks, weekLabels }: {
  weeks: { score: PeriodScore; counts: boolean; isCurrentWeek: boolean }[];
  weekLabels: string[];
}) {
  return (
    <div className="flex items-end justify-center gap-1.5 h-9">
      {weeks.map((w, i) => {
        const pct = w.score.pct;
        const heightPct = pct === null ? 0 : Math.min(100, pct);
        const color = pct === null
          ? "var(--text-faint)"
          : w.score.isCompliant
            ? "#22c55e"
            : pct >= 75
              ? "#f59e0b"
              : pct >= 25
                ? "#fb923c"
                : "#ef4444";
        const opacity = pct === null ? 0.45 : w.isCurrentWeek ? 0.85 : 1;
        return (
          <Tooltip key={i} width={190} label={
            `${weekLabels[i] ?? `W${i + 1}`}: ${pct === null ? "nothing available" : `${fmtDays(w.score.adherent)}/${fmtDays(w.score.available)} adherent (${pct}%)`}` +
            (w.isCurrentWeek ? " \u00b7 in progress" : !w.counts && pct !== null ? " \u00b7 short week, not counted" : "")}>
          <div className="flex flex-col items-center gap-0.5">
            <div className="relative w-3 h-7 rounded-sm flex items-end" style={{ background: "var(--bg-inset)" }}>
              <div
                className="w-full rounded-sm transition-all duration-300"
                style={{
                  height: `${heightPct}%`,
                  background: color,
                  opacity,
                  boxShadow: w.isCurrentWeek ? "0 0 0 1.5px var(--accent)" : "none",
                }}
              />
            </div>
            <span className="text-[8px] font-mono leading-none" style={{ color: w.counts || w.isCurrentWeek ? "var(--text-muted)" : "var(--text-faint)" }}>
              {w.score.pct === null ? "\u00b7" : fmtDays(w.score.adherent)}
            </span>
          </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

"use client";

import { Employee } from "@/lib/types";
import { useState, useMemo } from "react";
import { CheckCircle2, XCircle, Building2, ChevronDown, ChevronUp, Trophy, AlertCircle, Sparkles } from "lucide-react";
import { startOfWeek, addDays, format, startOfMonth, endOfMonth, isBefore } from "date-fns";

const OFFICE_STATUSES = ["Office", "Client Location", "Split Day"];
const REQUIRED_DAYS = 4;

// Holidays in YYYY-MM-DD format
const HOLIDAYS = new Set([
  "2026-04-03", "2026-05-01", "2026-08-15", "2026-10-02",
  "2026-11-01", "2026-11-09", "2026-11-10", "2026-12-25",
]);

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

  // Get Mon-Fri dates for the selected week, excluding holidays
  const weekDates = useMemo(() => {
    const dateSet = new Set(dates);
    return Array.from({ length: 5 }, (_, i) => {
      const day = addDays(monday, i);
      const dateStr = format(day, "yyyy-MM-dd");
      const isHoliday = HOLIDAYS.has(dateStr);
      const isFuture = day > today;
      return { dateStr, isHoliday, isFuture, hasData: dateSet.has(dateStr) };
    }).filter((d) => !d.isHoliday && !d.isFuture);
  }, [monday, dates, today]);

  const workingDaysCount = weekDates.length;
  const requiredDays = Math.min(REQUIRED_DAYS, workingDaysCount);

  // Calculate office days per employee for this week
  const employeeStats = useMemo(() => {
    return employees.map((emp) => {
      let officeDays = 0;
      weekDates.forEach(({ dateStr, hasData }) => {
        if (hasData) {
          const status = emp.statuses[dateStr];
          if (status && OFFICE_STATUSES.includes(status)) officeDays++;
        }
      });
      return {
        name: emp.name,
        email: emp.email,
        departments: emp.departments,
        department: emp.department,
        officeDays,
        isCompliant: officeDays >= requiredDays,
      };
    }).sort((a, b) => b.officeDays - a.officeDays);
  }, [employees, weekDates, requiredDays]);

  const compliantCount = employeeStats.filter((e) => e.isCompliant).length;
  const nonCompliantCount = employeeStats.length - compliantCount;
  const complianceRate = employeeStats.length > 0 ? Math.round((compliantCount / employeeStats.length) * 100) : 0;

  const weekLabel = `${format(addDays(monday, 0), "MMM d")} – ${format(addDays(monday, 4), "MMM d")}`;
  const isCurrentWeekPartial = periodTab === "this" && workingDaysCount < 5;

  const displayList = showAll ? employeeStats : employeeStats.slice(0, 10);

  // ── Monthly stats ────────────────────────────────────────
  const monthlyData = useMemo(() => {
    if (periodTab !== "month") return null;
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);
    const dateSet = new Set(dates);

    // Build week ranges (Mon-Fri) intersecting the month
    const weeks: { weekIdx: number; mondayStr: string; days: { dateStr: string; isHoliday: boolean; isFuture: boolean; hasData: boolean; inMonth: boolean }[] }[] = [];
    let cursor = startOfWeek(monthStart, { weekStartsOn: 1 });
    let weekIdx = 0;
    while (cursor <= monthEnd) {
      const days = Array.from({ length: 5 }, (_, i) => {
        const day = addDays(cursor, i);
        const dateStr = format(day, "yyyy-MM-dd");
        return {
          dateStr,
          isHoliday: HOLIDAYS.has(dateStr),
          isFuture: isBefore(today, day) && dateStr !== format(today, "yyyy-MM-dd"),
          hasData: dateSet.has(dateStr),
          inMonth: day.getMonth() === monthStart.getMonth(),
        };
      });
      // Only include weeks that have at least one in-month day
      if (days.some((d) => d.inMonth)) {
        weeks.push({ weekIdx, mondayStr: format(cursor, "MMM d"), days });
        weekIdx++;
      }
      cursor = addDays(cursor, 7);
    }

    type EmpMonth = {
      name: string; email: string; departments: string[]; department: string;
      weeks: { officeDays: number; workingDays: number; isCompliant: boolean; isComplete: boolean; isCurrentWeek: boolean }[];
      totalOfficeDays: number;
      compliantWeeks: number;
      completedWeeks: number;
      isPerfectMonth: boolean;
    };

    const todayStr = format(today, "yyyy-MM-dd");
    const empData: EmpMonth[] = employees.map((emp) => {
      const wkStats = weeks.map((w) => {
        const eligibleDays = w.days.filter((d) => d.inMonth && !d.isHoliday && !d.isFuture);
        let officeDays = 0;
        eligibleDays.forEach(({ dateStr, hasData }) => {
          if (hasData) {
            const status = emp.statuses[dateStr];
            if (status && OFFICE_STATUSES.includes(status)) officeDays++;
          }
        });
        const workingDays = eligibleDays.length;
        const fullWeekDays = w.days.filter((d) => d.inMonth && !d.isHoliday).length;
        // A week is "complete" once all its working days are in the past (no future-in-month days remain)
        const isComplete = workingDays === fullWeekDays && workingDays > 0;
        const requiredForWeek = Math.min(REQUIRED_DAYS, fullWeekDays);
        const isCurrentWeek = w.days.some((d) => d.dateStr === todayStr);
        return {
          officeDays,
          workingDays,
          isCompliant: officeDays >= requiredForWeek && requiredForWeek > 0,
          isComplete,
          isCurrentWeek,
        };
      });

      const totalOfficeDays = wkStats.reduce((s, w) => s + w.officeDays, 0);
      const completedOnly = wkStats.filter((w) => w.isComplete);
      const compliantWeeks = completedOnly.filter((w) => w.isCompliant).length;
      const completedWeeks = completedOnly.length;
      const isPerfectMonth = completedWeeks > 0 && compliantWeeks === completedWeeks;

      return {
        name: emp.name,
        email: emp.email,
        departments: emp.departments,
        department: emp.department,
        weeks: wkStats,
        totalOfficeDays,
        compliantWeeks,
        completedWeeks,
        isPerfectMonth,
      };
    }).sort((a, b) => {
      if (a.isPerfectMonth !== b.isPerfectMonth) return a.isPerfectMonth ? -1 : 1;
      if (b.compliantWeeks !== a.compliantWeeks) return b.compliantWeeks - a.compliantWeeks;
      return b.totalOfficeDays - a.totalOfficeDays;
    });

    const totalWorkingDaysInMonth = weeks.flatMap((w) => w.days).filter((d) => d.inMonth && !d.isHoliday && !d.isFuture).length;
    const perfectMonthCount = empData.filter((e) => e.isPerfectMonth).length;
    const atRiskCount = empData.filter((e) => e.completedWeeks > 0 && e.compliantWeeks === 0).length;

    // Avg compliance: each employee's (compliantWeeks / completedWeeks)
    const avgCompliance = empData.length > 0
      ? Math.round(
          empData.reduce((sum, e) => sum + (e.completedWeeks > 0 ? (e.compliantWeeks / e.completedWeeks) : 0), 0) / empData.length * 100
        )
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
              {periodTab === "month" ? "Monthly 4-Day Office Tracker" : "Weekly 4-Day Office Check"}
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {periodTab === "month" && monthlyData
                ? `${monthlyData.monthLabel} · ${monthlyData.weeks.length} week${monthlyData.weeks.length !== 1 ? "s" : ""} · ${monthlyData.totalWorkingDaysInMonth} working days so far`
                : <>{weekLabel} &middot; {workingDaysCount} working day{workingDaysCount !== 1 ? "s" : ""}{isCurrentWeekPartial && " (in progress)"}</>
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
                  <th className="text-center py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Weekly Office Days</th>
                  <th className="text-center py-2.5 px-3 font-medium hidden sm:table-cell" style={{ color: "var(--text-secondary)" }}>Total</th>
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
                      <span className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>{emp.totalOfficeDays}</span>
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
                        <span className="font-mono">{emp.compliantWeeks}/{emp.completedWeeks || "—"}</span>
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
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {employeeStats.length}</span>
              </div>
            </div>
            <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Not Yet</div>
              <div className="flex items-center gap-2">
                <XCircle size={16} className="text-red-400" />
                <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>{nonCompliantCount}</span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {employeeStats.length}</span>
              </div>
            </div>
          </div>

          {/* Employee list */}
          <div className="overflow-y-auto scrollbar-thin rounded-lg border" style={{ borderColor: "var(--border-subtle)", maxHeight: showAll ? "500px" : undefined }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface-secondary)" }}>
                <tr>
                  <th className="text-left py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Employee</th>
                  <th className="text-left py-2.5 px-3 font-medium hidden sm:table-cell" style={{ color: "var(--text-secondary)" }}>Department</th>
                  <th className="text-center py-2.5 px-3 font-medium" style={{ color: "var(--text-secondary)" }}>Office Days</th>
                  <th className="text-center py-2.5 px-3 font-medium w-10" style={{ color: "var(--text-secondary)" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {displayList.map((emp) => (
                  <tr key={emp.email} className="table-row-hover" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`avatar w-7 h-7 text-[10px] ${
                          emp.isCompliant
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
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>{emp.officeDays}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>/ {requiredDays}</span>
                      </div>
                      <div className="w-16 mx-auto rounded-full h-1.5 mt-1" style={{ background: "var(--bg-inset)" }}>
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${emp.isCompliant ? "bg-emerald-500" : emp.officeDays >= requiredDays - 1 ? "bg-amber-500" : "bg-red-400"}`}
                          style={{ width: `${Math.min((emp.officeDays / requiredDays) * 100, 100)}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {emp.isCompliant
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

// Per-employee mini bars showing each week's office days within the month
function WeeklyMiniBars({ weeks, weekLabels }: {
  weeks: { officeDays: number; workingDays: number; isCompliant: boolean; isComplete: boolean; isCurrentWeek: boolean }[];
  weekLabels: string[];
}) {
  const MAX_DAYS = 4; // height max
  return (
    <div className="flex items-end justify-center gap-1.5 h-9">
      {weeks.map((w, i) => {
        const heightPct = w.workingDays > 0
          ? Math.min(100, (w.officeDays / MAX_DAYS) * 100)
          : 0;
        const color = !w.isComplete && !w.isCurrentWeek
          ? "var(--text-faint)"
          : w.isCompliant
            ? "#22c55e"
            : w.officeDays >= 3
              ? "#f59e0b"
              : w.officeDays >= 1
                ? "#fb923c"
                : "#ef4444";
        const opacity = !w.isComplete && !w.isCurrentWeek ? 0.45 : w.isCurrentWeek && !w.isComplete ? 0.85 : 1;
        return (
          <div key={i} className="flex flex-col items-center gap-0.5"
            title={`${weekLabels[i] ?? `W${i + 1}`}: ${w.officeDays}/${w.workingDays || MAX_DAYS} office${w.isCurrentWeek ? " (in progress)" : !w.isComplete ? " (upcoming)" : ""}`}>
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
            <span className="text-[8px] font-mono leading-none" style={{ color: w.isComplete || w.isCurrentWeek ? "var(--text-muted)" : "var(--text-faint)" }}>
              {w.officeDays || (w.workingDays === 0 && !w.isCurrentWeek ? "·" : 0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

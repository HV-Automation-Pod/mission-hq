"use client";

import { Employee } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { startOfMonth, endOfMonth, startOfWeek, addDays, parseISO, format } from "date-fns";

type ViewMode = "week" | "month";

interface Props {
  employees: Employee[];
  dates: string[];
  selectedDept: string;
}

export default function TeamBreakdown({ employees, dates, selectedDept }: Props) {
  const filtered = selectedDept === "All"
    ? employees
    : employees.filter((e) => e.departments.includes(selectedDept));

  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  const [viewMode, setViewMode] = useState<ViewMode>("week");

  // ── Week navigation (Mon–Fri, like DailyTrendChart) ─────────
  const thisMonday = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today]);
  const thisMondayKey = format(thisMonday, "yyyy-MM-dd");

  const earliestMondayKey = useMemo(() => {
    if (dates.length === 0) return thisMondayKey;
    const sorted = [...dates].sort();
    const earliest = parseISO(sorted[0]);
    return format(startOfWeek(earliest, { weekStartsOn: 1 }), "yyyy-MM-dd");
  }, [dates, thisMondayKey]);

  const [viewedMondayKey, setViewedMondayKey] = useState(thisMondayKey);
  const viewedMonday = useMemo(() => parseISO(viewedMondayKey), [viewedMondayKey]);

  const prevMondayKey = viewedMondayKey > earliestMondayKey
    ? format(addDays(viewedMonday, -7), "yyyy-MM-dd")
    : null;
  const nextMondayKey = viewedMondayKey < thisMondayKey
    ? format(addDays(viewedMonday, 7), "yyyy-MM-dd")
    : null;
  const isCurrentWeek = viewedMondayKey === thisMondayKey;

  // Mon–Fri date strings for the viewed week (always 5 cols, future days render as "—")
  const weekDates = useMemo(
    () => Array.from({ length: 5 }, (_, i) => format(addDays(viewedMonday, i), "yyyy-MM-dd")),
    [viewedMonday]
  );

  // Months that have at least one date in the dataset
  const monthsWithData = useMemo(() => {
    const set = new Set<string>();
    dates.forEach((d) => set.add(d.slice(0, 7)));
    return Array.from(set).sort();
  }, [dates]);

  const todayMonthKey = format(startOfMonth(today), "yyyy-MM");
  const initialMonthKey = monthsWithData.includes(todayMonthKey)
    ? todayMonthKey
    : (monthsWithData[monthsWithData.length - 1] ?? todayMonthKey);

  const [viewedMonthKey, setViewedMonthKey] = useState(initialMonthKey);
  const monthAnchor = useMemo(() => parseISO(`${viewedMonthKey}-01`), [viewedMonthKey]);
  const monthEnd = useMemo(() => endOfMonth(monthAnchor), [monthAnchor]);
  const monthAnchorStr = format(monthAnchor, "yyyy-MM-dd");
  const monthEndStr = format(monthEnd, "yyyy-MM-dd");

  const monthDates = useMemo(() => {
    return dates.filter((d) => d >= monthAnchorStr && d <= monthEndStr && d <= todayStr);
  }, [dates, monthAnchorStr, monthEndStr, todayStr]);

  const monthIdx = monthsWithData.indexOf(viewedMonthKey);
  const prevMonthKey = monthIdx > 0 ? monthsWithData[monthIdx - 1] : null;
  const nextMonthKey = monthIdx >= 0 && monthIdx < monthsWithData.length - 1 ? monthsWithData[monthIdx + 1] : null;
  const isCurrentMonth = viewedMonthKey === todayMonthKey;
  const todayMonthAvailable = monthsWithData.includes(todayMonthKey);

  // Week: Mon → Fri left-to-right (matches Daily Attendance Trend).
  // Month: latest date first (leftmost), as before.
  const pastDates = viewMode === "month" ? monthDates.slice().reverse() : weekDates;

  // Keyboard navigation (←/→/T) scoped to the active view mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (viewMode === "week") {
        if (e.key === "ArrowLeft" && prevMondayKey) { e.preventDefault(); setViewedMondayKey(prevMondayKey); }
        else if (e.key === "ArrowRight" && nextMondayKey) { e.preventDefault(); setViewedMondayKey(nextMondayKey); }
        else if ((e.key === "t" || e.key === "T") && !isCurrentWeek) { e.preventDefault(); setViewedMondayKey(thisMondayKey); }
      } else {
        if (e.key === "ArrowLeft" && prevMonthKey) { e.preventDefault(); setViewedMonthKey(prevMonthKey); }
        else if (e.key === "ArrowRight" && nextMonthKey) { e.preventDefault(); setViewedMonthKey(nextMonthKey); }
        else if ((e.key === "t" || e.key === "T") && todayMonthAvailable && !isCurrentMonth) { e.preventDefault(); setViewedMonthKey(todayMonthKey); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, prevMondayKey, nextMondayKey, isCurrentWeek, thisMondayKey, prevMonthKey, nextMonthKey, isCurrentMonth, todayMonthAvailable, todayMonthKey]);

  const grouped = useMemo(() => {
    const map: Record<string, Employee[]> = {};
    filtered.forEach((e) => {
      const depts = selectedDept !== "All" ? [selectedDept] : (e.departments.length > 0 ? e.departments : [e.department || "Unassigned"]);
      depts.forEach((dept) => {
        if (!map[dept]) map[dept] = [];
        map[dept].push(e);
      });
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, selectedDept]);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400">
            <Users size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Department Status View</h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {filtered.length} employees across {grouped.length} department{grouped.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode toggle */}
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--bg-inset)" }}>
            {(["week", "month"] as ViewMode[]).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md transition-all capitalize"
                style={{
                  background: viewMode === m ? "var(--bg-surface)" : "transparent",
                  color: viewMode === m ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: viewMode === m ? "var(--shadow-xs)" : "none",
                }}>{m}</button>
            ))}
          </div>

          {/* Navigation */}
          {viewMode === "week" ? (
            <div className="flex items-center gap-1">
              <NavTooltip
                label={prevMondayKey ? `Week of ${format(parseISO(prevMondayKey), "MMM d")}` : "No earlier data"}
                shortcut={prevMondayKey ? "←" : undefined}
              >
                <button
                  onClick={() => prevMondayKey && setViewedMondayKey(prevMondayKey)}
                  disabled={!prevMondayKey}
                  className="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Previous week"
                >
                  <ChevronLeft size={15} />
                </button>
              </NavTooltip>
              <span className="text-[11px] min-w-[120px] text-center font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {format(parseISO(weekDates[0]), "MMM d")} – {format(parseISO(weekDates[4]), "MMM d")}
              </span>
              <NavTooltip
                label={nextMondayKey ? `Week of ${format(parseISO(nextMondayKey), "MMM d")}` : "No later weeks"}
                shortcut={nextMondayKey ? "→" : undefined}
              >
                <button
                  onClick={() => nextMondayKey && setViewedMondayKey(nextMondayKey)}
                  disabled={!nextMondayKey}
                  className="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Next week"
                >
                  <ChevronRight size={15} />
                </button>
              </NavTooltip>
              <span className="mx-1 h-4 w-px" style={{ background: "var(--border-subtle)" }} />
              <NavTooltip
                label={isCurrentWeek ? "You're here" : `Week of ${format(thisMonday, "MMM d")}`}
                shortcut={isCurrentWeek ? undefined : "T"}
              >
                <button
                  onClick={() => setViewedMondayKey(thisMondayKey)}
                  disabled={isCurrentWeek}
                  aria-current={isCurrentWeek ? "true" : undefined}
                  className="px-2 py-1 text-[10px] font-bold rounded-md transition-all disabled:cursor-not-allowed"
                  style={{
                    background: isCurrentWeek ? "var(--accent-light)" : "var(--bg-inset)",
                    color: isCurrentWeek ? "var(--accent)" : "var(--text-secondary)",
                    border: `1px solid ${isCurrentWeek ? "var(--accent-muted)" : "var(--border-subtle)"}`,
                    opacity: isCurrentWeek ? 0.85 : 1,
                  }}
                >
                  This Week
                </button>
              </NavTooltip>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <NavTooltip
                label={prevMonthKey ? format(parseISO(prevMonthKey + "-01"), "MMMM yyyy") : "No earlier data"}
                shortcut={prevMonthKey ? "←" : undefined}
              >
                <button
                  onClick={() => prevMonthKey && setViewedMonthKey(prevMonthKey)}
                  disabled={!prevMonthKey}
                  className="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={15} />
                </button>
              </NavTooltip>
              <span className="text-[11px] min-w-[100px] text-center font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {format(monthAnchor, "MMM yyyy")}
              </span>
              <NavTooltip
                label={nextMonthKey ? format(parseISO(nextMonthKey + "-01"), "MMMM yyyy") : "No later months"}
                shortcut={nextMonthKey ? "→" : undefined}
              >
                <button
                  onClick={() => nextMonthKey && setViewedMonthKey(nextMonthKey)}
                  disabled={!nextMonthKey}
                  className="p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Next month"
                >
                  <ChevronRight size={15} />
                </button>
              </NavTooltip>
              <span className="mx-1 h-4 w-px" style={{ background: "var(--border-subtle)" }} />
              <NavTooltip
                label={isCurrentMonth ? "You're here" : todayMonthAvailable ? format(parseISO(todayMonthKey + "-01"), "MMMM yyyy") : "No data this month"}
                shortcut={isCurrentMonth || !todayMonthAvailable ? undefined : "T"}
              >
                <button
                  onClick={() => todayMonthAvailable && setViewedMonthKey(todayMonthKey)}
                  disabled={isCurrentMonth || !todayMonthAvailable}
                  aria-current={isCurrentMonth ? "true" : undefined}
                  className="px-2 py-1 text-[10px] font-bold rounded-md transition-all disabled:cursor-not-allowed"
                  style={{
                    background: isCurrentMonth ? "var(--accent-light)" : "var(--bg-inset)",
                    color: isCurrentMonth ? "var(--accent)" : "var(--text-secondary)",
                    border: `1px solid ${isCurrentMonth ? "var(--accent-muted)" : "var(--border-subtle)"}`,
                    opacity: isCurrentMonth ? 0.85 : !todayMonthAvailable ? 0.4 : 1,
                  }}
                >
                  This Month
                </button>
              </NavTooltip>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-auto scrollbar-thin rounded-lg border" style={{ borderColor: "var(--border-subtle)", maxHeight: 680 }}>
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th
                className="text-left py-2.5 px-3 font-medium sticky top-0 left-0 w-[300px] min-w-[300px] z-30"
                style={{
                  background: "var(--bg-surface-secondary)",
                  borderRight: "1px solid var(--border-default)",
                  color: "var(--text-secondary)",
                  borderBottom: "1px solid var(--border-default)",
                  boxShadow: "0 1px 0 0 var(--border-default)",
                }}
              >
                Employee
              </th>
              {pastDates.map((d) => (
                <th
                  key={d}
                  className="text-center py-2.5 px-3 font-medium min-w-[110px] sticky top-0 z-20"
                  style={{
                    background: "var(--bg-surface-secondary)",
                    color: "var(--text-secondary)",
                    borderBottom: "1px solid var(--border-default)",
                    boxShadow: "0 1px 0 0 var(--border-default)",
                  }}
                >
                  <div className="text-xs">{new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" })}</div>
                  <div className="text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                    {new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([dept, emps]) => (
              <React.Fragment key={dept}>
                <tr style={{ background: "var(--bg-surface-secondary)" }}>
                  <td
                    className="py-2 px-3 sticky left-0 z-10 whitespace-nowrap"
                    style={{
                      background: "var(--bg-surface-secondary)",
                      borderRight: "1px solid var(--border-default)",
                      boxShadow: "1px 0 0 0 var(--border-default)",
                    }}
                  >
                    <span className="section-label">{dept}</span>
                    <span className="text-[10px] ml-2" style={{ color: "var(--text-muted)" }}>({emps.length})</span>
                  </td>
                  {pastDates.map((d) => (
                    <td key={d} style={{ background: "var(--bg-surface-secondary)" }} />
                  ))}
                </tr>
                {emps.map((emp) => (
                  <tr key={emp.email} className="table-row-hover" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td
                      className="py-2.5 px-3 sticky left-0 z-10"
                      style={{
                        background: "var(--bg-surface)",
                        borderRight: "1px solid var(--border-default)",
                        boxShadow: "1px 0 0 0 var(--border-default)",
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="avatar w-7 h-7 text-[10px] flex-shrink-0" style={{ background: "var(--bg-inset)", color: "var(--text-muted)" }}>
                          {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[13px] truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</div>
                          <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{emp.email}</div>
                        </div>
                      </div>
                    </td>
                    {pastDates.map((d) => (
                      <td key={d} className="py-2.5 px-3 text-center">
                        <StatusBadge status={emp.statuses[d] || "—"} size="xs" />
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No employees found
          </div>
        )}
      </div>
    </div>
  );
}

function NavTooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 absolute left-1/2 -translate-x-1/2 top-full mt-2 z-30 transition-opacity duration-150"
      >
        <span
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 whitespace-nowrap relative"
          style={{ background: "#0f172a", color: "#f1f5f9", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}
        >
          <span className="text-[11px] font-medium">{label}</span>
          {shortcut && (
            <kbd
              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded leading-none"
              style={{ background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155" }}
            >
              {shortcut}
            </kbd>
          )}
          <span
            className="absolute left-1/2 -translate-x-1/2 bottom-full w-2 h-2 rotate-45"
            style={{ background: "#0f172a", marginBottom: "-4px" }}
          />
        </span>
      </span>
    </span>
  );
}

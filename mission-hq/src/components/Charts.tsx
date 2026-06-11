"use client";

import { Employee, STATUS_COLORS } from "@/lib/types";
import { useTheme } from "@/lib/theme";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart, ReferenceLine } from "recharts";
import { format, parseISO, startOfWeek, addDays, isBefore, startOfMonth, endOfMonth } from "date-fns";
import { Sparkles, TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from "lucide-react";

const CHART_COLORS = {
  light: { grid: "#f1f5f9", tick: "#94a3b8", ref: "#ef4444", bg: "#ffffff", border: "#e2e8f0", text: "#0f172a", sub: "#64748b" },
  dark: { grid: "#1e2737", tick: "#4b5a72", ref: "#f87171", bg: "#111622", border: "#1e2737", text: "#f1f5f9", sub: "#8b97ad" },
};

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-custom">
      <p className="font-semibold text-[11px] mb-1.5" style={{ color: "var(--text-primary)" }}>{label}</p>
      <div className="space-y-1">
        {payload.filter(p => p.value > 0).map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-[11px]">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
            <span style={{ color: "var(--text-muted)" }}>{p.name}</span>
            <span className="font-semibold font-mono ml-auto" style={{ color: "var(--text-primary)" }}>{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Holidays in YYYY-MM-DD format
const HOLIDAYS = new Set([
  "2026-04-03", "2026-05-01", "2026-08-15", "2026-10-02",
  "2026-11-01", "2026-11-09", "2026-11-10", "2026-12-25",
]);

function isHolidayDate(day: Date): boolean {
  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return HOLIDAYS.has(`${yyyy}-${mm}-${dd}`);
}

type PeriodTab = "week" | "month";
interface TrendProps { employees: Employee[]; dates: string[]; }

export function DailyTrendChart({ employees, dates }: TrendProps) {
  const { theme } = useTheme();
  const c = CHART_COLORS[theme === "dark" ? "dark" : "light"];
  const [periodTab, setPeriodTab] = useState<PeriodTab>("week");

  const today = useMemo(() => new Date(), []);
  const thisMonday = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today]);
  const thisMondayKey = format(thisMonday, "yyyy-MM-dd");

  // Earliest Monday we have data for — caps the back-navigation
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

  // Mon-Fri for the viewed week
  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(viewedMonday, i)),
    [viewedMonday]
  );
  const dateSet = useMemo(() => new Set(dates), [dates]);

  const data = weekDays.map((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const holiday = isHolidayDate(day);
    const dayLabel = format(day, "EEE, MMM d");
    const label = holiday ? `${dayLabel} (Holiday)` : dayLabel;
    const isPast = isBefore(day, today) || format(day, "yyyy-MM-dd") === format(today, "yyyy-MM-dd");
    const hasData = dateSet.has(dateStr);

    if (holiday) {
      return { date: label, Office: 0, Home: 0, "Client Location": 0, "Split Day": 0, Travel: 0, Leave: 0, Anywhere: 0, Pending: 0, Holiday: employees.length };
    }

    if (!isPast || !hasData) {
      return { date: label, Office: 0, Home: 0, "Client Location": 0, "Split Day": 0, Travel: 0, Leave: 0, Anywhere: 0, Pending: 0, Holiday: 0 };
    }

    const counts: Record<string, number> = { Office: 0, Home: 0, "Client Location": 0, "Split Day": 0, Travel: 0, Leave: 0, Anywhere: 0, Pending: 0 };
    employees.forEach((emp) => {
      const status = emp.statuses[dateStr];
      if (status && status in counts) counts[status]++;
    });
    return { date: label, ...counts, Holiday: 0 };
  });

  const weekLabel = `${format(weekDays[0], "MMM d")} – ${format(weekDays[4], "MMM d, yyyy")}`;

  // Keyboard nav for week view (←/→/T) — only mounted while week tab is active
  useEffect(() => {
    if (periodTab !== "week") return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && prevMondayKey) { e.preventDefault(); setViewedMondayKey(prevMondayKey); }
      else if (e.key === "ArrowRight" && nextMondayKey) { e.preventDefault(); setViewedMondayKey(nextMondayKey); }
      else if ((e.key === "t" || e.key === "T") && !isCurrentWeek) { e.preventDefault(); setViewedMondayKey(thisMondayKey); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [periodTab, prevMondayKey, nextMondayKey, isCurrentWeek, thisMondayKey]);

  // Custom X-axis tick to style holidays differently
  const CustomXTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const value = payload?.value || "";
    const isHol = value.includes("(Holiday)");
    const displayLabel = value.replace(" (Holiday)", "");
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={12} textAnchor="middle" fontSize={10} fill={isHol ? "#f59e0b" : c.tick}>
          {displayLabel}
        </text>
        {isHol && (
          <text x={0} y={0} dy={24} textAnchor="middle" fontSize={9} fill="#f59e0b" fontWeight={600}>
            Holiday
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Daily Attendance Trend</h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {periodTab === "week" ? (isCurrentWeek ? "This week" : "Browsing past week") : ""}
          </p>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--bg-inset)" }}>
          {(["week", "month"] as PeriodTab[]).map((p) => (
            <button key={p} onClick={() => setPeriodTab(p)}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
              style={{
                background: periodTab === p ? "var(--bg-surface)" : "transparent",
                color: periodTab === p ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: periodTab === p ? "var(--shadow-xs)" : "none",
              }}>
              {p === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      {periodTab === "month" ? (
        <MonthCalendarHeatmap employees={employees} dates={dates} />
      ) : (
        <div className="animate-fade-in">
          {/* Week nav */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <NavIconButton
              icon={<ChevronLeft size={15} />}
              disabled={!prevMondayKey}
              onClick={() => prevMondayKey && setViewedMondayKey(prevMondayKey)}
              tooltipLabel={prevMondayKey ? `Week of ${format(parseISO(prevMondayKey), "MMM d")}` : "No earlier data"}
              shortcut="←"
            />

            <div className="flex items-center gap-2 min-w-[180px] justify-center">
              <h3 className="text-[13px] font-semibold tracking-tight tabular-nums" style={{ color: "var(--text-primary)" }}>
                {weekLabel}
              </h3>
            </div>

            <NavIconButton
              icon={<ChevronRight size={15} />}
              disabled={!nextMondayKey}
              onClick={() => nextMondayKey && setViewedMondayKey(nextMondayKey)}
              tooltipLabel={nextMondayKey ? `Week of ${format(parseISO(nextMondayKey), "MMM d")}` : "No later data"}
              shortcut="→"
            />

            <span className="mx-1 h-5 w-px" style={{ background: "var(--border-subtle)" }} />

            <NavIconButton
              icon={<span className="text-[11px] font-bold tracking-tight">This Week</span>}
              disabled={false}
              active={isCurrentWeek}
              onClick={() => setViewedMondayKey(thisMondayKey)}
              tooltipLabel={isCurrentWeek ? "You're here" : `Week of ${format(thisMonday, "MMM d")}`}
              shortcut="T"
              wide
            />
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} barSize={14} barGap={1}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="date" tick={<CustomXTick />} axisLine={false} tickLine={false} height={40} />
              <YAxis tick={{ fontSize: 10, fill: c.tick }} axisLine={false} tickLine={false} width={30} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }} />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 12 }} iconType="circle" iconSize={6} />
              <Bar dataKey="Holiday" stackId="a" fill="#f59e0b" opacity={0.3} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Office" stackId="a" fill={STATUS_COLORS.Office} />
              <Bar dataKey="Home" stackId="a" fill={STATUS_COLORS.Home} />
              <Bar dataKey="Client Location" stackId="a" fill={STATUS_COLORS["Client Location"]} />
              <Bar dataKey="Split Day" stackId="a" fill={STATUS_COLORS["Split Day"]} />
              <Bar dataKey="Travel" stackId="a" fill={STATUS_COLORS.Travel} />
              <Bar dataKey="Leave" stackId="a" fill={STATUS_COLORS.Leave} />
              <Bar dataKey="Anywhere" stackId="a" fill={STATUS_COLORS.Anywhere} />
              <Bar dataKey="Pending" stackId="a" fill={STATUS_COLORS.Pending} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Month Calendar Heatmap ──────────────────────────────────────
interface DayStat {
  day: Date;
  dateStr: string;
  inMonth: boolean;
  isHoliday: boolean;
  isFuture: boolean;
  isToday: boolean;
  hasData: boolean;
  total: number;
  office: number;
  officePct: number;
  counts: Record<string, number>;
}

const OFFICE_KEYS = ["Office", "Client Location", "Split Day"] as const;

function MonthCalendarHeatmap({ employees, dates }: { employees: Employee[]; dates: string[] }) {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  // Months that have at least one date in the data set, sorted ascending
  const monthsWithData = useMemo(() => {
    const set = new Set<string>();
    dates.forEach((d) => set.add(d.slice(0, 7))); // "yyyy-MM"
    return Array.from(set).sort();
  }, [dates]);

  // Initial viewed month: today's month if it has data, else the latest month with data
  const initialMonthKey = useMemo(() => {
    const todayKey = format(startOfMonth(today), "yyyy-MM");
    if (monthsWithData.includes(todayKey)) return todayKey;
    return monthsWithData[monthsWithData.length - 1] ?? todayKey;
  }, [monthsWithData, today]);

  const [viewedMonthKey, setViewedMonthKey] = useState(initialMonthKey);
  const viewedMonth = useMemo(() => parseISO(`${viewedMonthKey}-01`), [viewedMonthKey]);

  const idx = monthsWithData.indexOf(viewedMonthKey);
  const prevMonthKey = idx > 0 ? monthsWithData[idx - 1] : null;
  const nextMonthKey = idx >= 0 && idx < monthsWithData.length - 1 ? monthsWithData[idx + 1] : null;
  const todayMonthKey = format(startOfMonth(today), "yyyy-MM");
  const isCurrentMonth = viewedMonthKey === todayMonthKey;
  const todayAvailable = monthsWithData.includes(todayMonthKey);

  // Keyboard shortcuts (only mounted while month tab is active)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && prevMonthKey) { e.preventDefault(); setViewedMonthKey(prevMonthKey); }
      else if (e.key === "ArrowRight" && nextMonthKey) { e.preventDefault(); setViewedMonthKey(nextMonthKey); }
      else if ((e.key === "t" || e.key === "T") && todayAvailable && !isCurrentMonth) { e.preventDefault(); setViewedMonthKey(todayMonthKey); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prevMonthKey, nextMonthKey, todayAvailable, isCurrentMonth, todayMonthKey]);

  const monthStart = startOfMonth(viewedMonth);
  const monthEnd = endOfMonth(viewedMonth);
  const firstWeekStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const dateSet = new Set(dates);

  // Build week rows that span the month (Mon-Fri only)
  const weeks: Date[][] = [];
  let cursor = firstWeekStart;
  while (cursor <= monthEnd) {
    weeks.push(Array.from({ length: 5 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }

  const buildStat = (day: Date): DayStat => {
    const dateStr = format(day, "yyyy-MM-dd");
    const inMonth = day.getMonth() === monthStart.getMonth();
    const isHoliday = HOLIDAYS.has(dateStr);
    const isFuture = isBefore(today, day) && dateStr !== todayStr;
    const isToday = dateStr === todayStr;
    const hasData = dateSet.has(dateStr);
    const counts: Record<string, number> = { Office: 0, Home: 0, "Client Location": 0, "Split Day": 0, Travel: 0, Leave: 0, Anywhere: 0, Pending: 0 };

    if (inMonth && !isFuture && !isHoliday && hasData) {
      employees.forEach((emp) => {
        const s = emp.statuses[dateStr];
        if (s && s in counts) counts[s]++;
      });
    }
    const total = employees.length || 1;
    const office = counts.Office + counts["Client Location"] + counts["Split Day"];
    const officePct = inMonth && !isFuture && !isHoliday && hasData ? Math.round((office / total) * 100) : 0;
    return { day, dateStr, inMonth, isHoliday, isFuture, isToday, hasData, total, office, officePct, counts };
  };

  const allCells = weeks.flatMap((w) => w.map(buildStat));
  const validDays = allCells.filter((d) => d.inMonth && !d.isHoliday && !d.isFuture && d.hasData);
  const avgOffice = validDays.length > 0
    ? Math.round(validDays.reduce((sum, d) => sum + d.officePct, 0) / validDays.length)
    : 0;
  const bestDay = validDays.reduce<DayStat | null>((b, d) => (!b || d.officePct > b.officePct ? d : b), null);
  const worstDay = validDays.reduce<DayStat | null>((w, d) => (!w || d.officePct < w.officePct ? d : w), null);
  const totalWorkingDaysInMonth = allCells.filter((d) => d.inMonth && !d.isHoliday).length;

  return (
    <div className="animate-fade-in">
      {/* Month nav */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <NavIconButton
          icon={<ChevronLeft size={15} />}
          disabled={!prevMonthKey}
          onClick={() => prevMonthKey && setViewedMonthKey(prevMonthKey)}
          tooltipLabel={prevMonthKey ? format(parseISO(prevMonthKey + "-01"), "MMMM yyyy") : "No earlier data"}
          shortcut="←"
        />

        <div className="flex items-center gap-2 min-w-[150px] justify-center">
          <h3 className="text-[13px] font-semibold tracking-tight tabular-nums" style={{ color: "var(--text-primary)" }}>
            {format(viewedMonth, "MMMM yyyy")}
          </h3>
        </div>

        <NavIconButton
          icon={<ChevronRight size={15} />}
          disabled={!nextMonthKey}
          onClick={() => nextMonthKey && setViewedMonthKey(nextMonthKey)}
          tooltipLabel={nextMonthKey ? format(parseISO(nextMonthKey + "-01"), "MMMM yyyy") : "No later data"}
          shortcut="→"
        />

        <span className="mx-1 h-5 w-px" style={{ background: "var(--border-subtle)" }} />

        <NavIconButton
          icon={<span className="text-[11px] font-bold tracking-tight">Today</span>}
          disabled={!todayAvailable}
          active={isCurrentMonth}
          onClick={() => setViewedMonthKey(todayMonthKey)}
          tooltipLabel={isCurrentMonth ? "You're here" : todayAvailable ? format(startOfMonth(today), "MMMM yyyy") : "No data this month"}
          shortcut="T"
          wide
        />
      </div>

      {/* Month summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        <SummaryCard
          label="Avg Office"
          value={`${avgOffice}%`}
          accent={avgOffice >= 80 ? "emerald" : avgOffice >= 60 ? "amber" : "red"}
        />
        <SummaryCard
          label="Days Tracked"
          value={`${validDays.length}/${totalWorkingDaysInMonth}`}
          accent="indigo"
        />
        <SummaryCard
          label="Best Day"
          value={bestDay ? `${bestDay.officePct}%` : "—"}
          sub={bestDay ? format(bestDay.day, "EEE, MMM d") : ""}
          accent="emerald"
          icon={<TrendingUp size={11} />}
        />
        <SummaryCard
          label="Lowest Day"
          value={worstDay ? `${worstDay.officePct}%` : "—"}
          sub={worstDay ? format(worstDay.day, "EEE, MMM d") : ""}
          accent="red"
          icon={<TrendingDown size={11} />}
        />
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-5 gap-2 mb-1.5 px-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
          <div key={d} className="text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: "var(--text-muted)" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-5 gap-2">
        {allCells.map((stat) => (
          <DayCell key={stat.dateStr} stat={stat} isBest={!!bestDay && stat.dateStr === bestDay.dateStr} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded" style={{ background: "rgba(34, 197, 94, 0.18)", border: "1px solid rgba(34, 197, 94, 0.35)" }} /> ≥80%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded" style={{ background: "rgba(245, 158, 11, 0.18)", border: "1px solid rgba(245, 158, 11, 0.35)" }} /> 60–79%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded" style={{ background: "rgba(239, 68, 68, 0.14)", border: "1px solid rgba(239, 68, 68, 0.3)" }} /> &lt;60%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded" style={{ background: "rgba(245, 158, 11, 0.18)", border: "1px dashed rgba(245, 158, 11, 0.5)" }} /> Holiday
        </span>
      </div>
    </div>
  );
}

function NavIconButton({ icon, disabled, active, onClick, tooltipLabel, shortcut, wide }: {
  icon: React.ReactNode;
  disabled: boolean;
  active?: boolean;
  onClick: () => void;
  tooltipLabel: string;
  shortcut: string;
  wide?: boolean;
}) {
  const baseColor = active ? "var(--accent)" : "var(--text-secondary)";
  const baseBg = active ? "var(--accent-light)" : "var(--bg-inset)";
  const baseBorder = active ? "var(--accent-muted)" : "var(--border-subtle)";

  return (
    <div className="group relative inline-flex">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltipLabel}
        aria-current={active ? "true" : undefined}
        className={`flex items-center justify-center rounded-md transition-all ${wide ? "h-7 px-2.5" : "w-7 h-7"} disabled:cursor-not-allowed`}
        style={{
          color: disabled ? "var(--text-faint)" : baseColor,
          background: baseBg,
          border: `1px solid ${baseBorder}`,
          opacity: disabled ? 0.5 : 1,
          boxShadow: active ? "0 0 0 2px var(--accent-light)" : "none",
          fontWeight: active ? 700 : undefined,
        }}
        onMouseEnter={(e) => {
          if (!disabled && !active) {
            e.currentTarget.style.background = "var(--bg-surface-hover)";
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.borderColor = "var(--border-default)";
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = baseBg;
          e.currentTarget.style.color = disabled ? "var(--text-faint)" : baseColor;
          e.currentTarget.style.borderColor = baseBorder;
        }}
      >
        {icon}
      </button>

      {/* Slack-style tooltip */}
      <div
        role="tooltip"
        className="pointer-events-none opacity-0 group-hover:opacity-100 absolute left-1/2 -translate-x-1/2 top-full mt-2 z-30 transition-opacity duration-150"
      >
        <div
          className="rounded-lg px-2.5 py-2 whitespace-nowrap flex items-center gap-2"
          style={{
            background: "#0f172a",
            color: "#f1f5f9",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
        >
          <span className="text-[11px] font-medium">{tooltipLabel}</span>
          {!disabled && (
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
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, accent, icon }: {
  label: string; value: string; sub?: string;
  accent: "emerald" | "amber" | "red" | "indigo";
  icon?: React.ReactNode;
}) {
  const accentColors: Record<string, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
  };
  return (
    <div className="px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {icon}<span className="truncate">{label}</span>
        </div>
        {sub && <div className="text-[9.5px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{sub}</div>}
      </div>
      <div className={`text-[15px] font-bold font-mono leading-none flex-shrink-0 ${accentColors[accent]}`}>{value}</div>
    </div>
  );
}

function DayCell({ stat, isBest }: { stat: DayStat; isBest: boolean }) {
  const { day, inMonth, isHoliday, isFuture, isToday, hasData, officePct, counts, total } = stat;

  // Background tint
  let bg = "transparent";
  let borderColor = "var(--border-subtle)";
  if (!inMonth) {
    bg = "transparent";
  } else if (isHoliday) {
    bg = "rgba(245, 158, 11, 0.15)";
    borderColor = "rgba(245, 158, 11, 0.35)";
  } else if (isFuture) {
    bg = "var(--bg-inset)";
  } else if (!hasData) {
    bg = "var(--bg-inset)";
  } else if (officePct >= 80) {
    bg = "rgba(34, 197, 94, 0.14)";
    borderColor = "rgba(34, 197, 94, 0.32)";
  } else if (officePct >= 60) {
    bg = "rgba(245, 158, 11, 0.14)";
    borderColor = "rgba(245, 158, 11, 0.32)";
  } else {
    bg = "rgba(239, 68, 68, 0.10)";
    borderColor = "rgba(239, 68, 68, 0.25)";
  }

  const ring = isToday ? "0 0 0 2px var(--accent)" : isBest ? "0 0 0 1.5px rgba(234, 179, 8, 0.55)" : "none";
  const opacity = !inMonth ? 0.35 : isFuture ? 0.5 : 1;

  // Build mini-stack of office vs other
  const dayCount = hasData ? Object.values(counts).reduce((a, b) => a + b, 0) || total : 0;

  const interactive = inMonth && !isFuture;
  const breakdownEntries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="group relative">
      <div
        className="relative aspect-[4/2] rounded-lg p-3 transition-all hover:scale-[1.03] hover:z-10"
        style={{
          background: bg,
          border: `1px solid ${borderColor}`,
          boxShadow: ring,
          opacity,
          cursor: interactive ? "pointer" : "default",
        }}
      >
        {/* date number */}
        <div className="flex items-start justify-between">
          <span className="text-[10px] font-semibold font-mono leading-none" style={{ color: isToday ? "var(--accent)" : inMonth ? "var(--text-primary)" : "var(--text-muted)" }}>
            {format(day, "d")}
          </span>
          {isBest && <Sparkles size={9} className="text-amber-500" />}
          {isToday && !isBest && <span className="text-[7px] font-bold uppercase px-1 py-0.5 rounded leading-none" style={{ background: "var(--accent)", color: "white" }}>Today</span>}
        </div>

        {/* center content */}
        {inMonth && !isFuture && !isHoliday && hasData && (
          <>
            <div className="absolute inset-x-1 top-[55%] -translate-y-1/2 text-center">
              <div className="text-[13px] font-bold font-mono leading-none" style={{ color: "var(--text-primary)" }}>{officePct}<span className="text-[8px]">%</span></div>
              <div className="text-[7.5px] mt-0.5 leading-none" style={{ color: "var(--text-muted)" }}>{stat.office}/{dayCount}</div>
            </div>

            {/* stacked mini-bar at the bottom */}
            <div className="absolute inset-x-2 bottom-0.5 h-[2.5px] rounded-full overflow-hidden flex" style={{ background: "var(--bg-surface-secondary)" }}>
              {OFFICE_KEYS.map((k) => counts[k] > 0 && (
                <div key={k} style={{ width: `${(counts[k] / dayCount) * 100}%`, background: STATUS_COLORS[k] }} />
              ))}
              {(["Home", "Travel", "Leave", "Anywhere", "Pending"] as const).map((k) => counts[k] > 0 && (
                <div key={k} style={{ width: `${(counts[k] / dayCount) * 100}%`, background: STATUS_COLORS[k], opacity: 0.55 }} />
              ))}
            </div>
          </>
        )}

        {inMonth && isHoliday && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[9px] font-semibold tracking-wide" style={{ color: "#d97706" }}>Holiday</div>
          </div>
        )}

        {inMonth && isFuture && !isHoliday && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-1 h-1 rounded-full" style={{ background: "var(--text-faint)" }} />
          </div>
        )}
      </div>

      {/* Custom tooltip — shown on hover */}
      {inMonth && (
        <div
          role="tooltip"
          className="day-tooltip pointer-events-none opacity-0 group-hover:opacity-100 absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-30 transition-opacity duration-150"
        >
          <div
            className="rounded-xl px-3 py-2.5 min-w-[180px]"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="text-[11px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                {format(day, "EEE, MMM d, yyyy")}
              </div>
              {isToday && (
                <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded leading-none" style={{ background: "var(--accent)", color: "white" }}>Today</span>
              )}
            </div>

            {isHoliday ? (
              <div className="text-[11px] font-medium flex items-center gap-1.5" style={{ color: "#d97706" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#d97706" }} />
                Holiday
              </div>
            ) : isFuture ? (
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Upcoming</div>
            ) : !hasData ? (
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>No data yet</div>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mb-2 pb-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className={`text-lg font-bold font-mono leading-none ${
                    officePct >= 80 ? "text-emerald-600 dark:text-emerald-400"
                      : officePct >= 60 ? "text-amber-600 dark:text-amber-400"
                        : "text-red-500 dark:text-red-400"
                  }`}>{officePct}%</span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>in office · {stat.office}/{dayCount}</span>
                </div>
                <div className="space-y-1">
                  {breakdownEntries.map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[10.5px]">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[k] }} />
                      <span className="flex-1" style={{ color: "var(--text-secondary)" }}>{k}</span>
                      <span className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* arrow */}
            <span
              className="absolute left-1/2 -translate-x-1/2 top-full w-2.5 h-2.5 rotate-45"
              style={{
                background: "var(--bg-surface)",
                borderRight: "1px solid var(--border-default)",
                borderBottom: "1px solid var(--border-default)",
                marginTop: "-5px",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface PieProps { employees: Employee[]; date: string; }

export function StatusPieChart({ employees, date }: PieProps) {
  const { theme } = useTheme();
  const c = CHART_COLORS[theme === "dark" ? "dark" : "light"];
  const counts: Record<string, number> = {};
  employees.forEach((emp) => {
    const status = emp.statuses[date] || "No Data";
    counts[status] = (counts[status] || 0) + 1;
  });

  const total = employees.length;
  const data = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  return (
    <ChartCard title="Status Distribution" subtitle={new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}>
      <div className="flex flex-col items-center">
        <ResponsiveContainer width="100%" height={210}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" strokeWidth={0}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: unknown, name: unknown) => [`${value} (${Math.round((Number(value) / total) * 100)}%)`, String(name)]}
              contentStyle={{
                backgroundColor: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: 12, fontSize: 11,
                color: c.text,
                boxShadow: "var(--shadow-lg)",
              }}
              labelStyle={{ color: c.text }}
              itemStyle={{ color: c.sub }}
            />
          </PieChart>
        </ResponsiveContainer>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-2 w-full px-2">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[entry.name] || "#94a3b8" }} />
              <span className="truncate flex-1" style={{ color: "var(--text-muted)" }}>{entry.name}</span>
              <span className="font-semibold font-mono" style={{ color: "var(--text-primary)" }}>{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

interface TeamComplianceProps { employees: Employee[]; dates: string[]; }

export function TeamComplianceChart({ employees, dates }: TeamComplianceProps) {
  const { theme } = useTheme();
  const c = CHART_COLORS[theme === "dark" ? "dark" : "light"];
  const departments: Record<string, { total: number; officeDays: number }> = {};

  employees.forEach((emp) => {
    const depts = emp.departments?.length > 0 ? emp.departments : [emp.department || "Unassigned"];
    depts.forEach((dept) => {
      if (!departments[dept]) departments[dept] = { total: 0, officeDays: 0 };
      dates.slice(-5).forEach((d) => {
        const status = emp.statuses[d];
        departments[dept].total++;
        if (status === "Office" || status === "Client Location" || status === "Split Day") {
          departments[dept].officeDays++;
        }
      });
    });
  });

  const data = Object.entries(departments)
    .map(([department, val]) => ({ department, "Office %": Math.round((val.officeDays / val.total) * 100) }))
    .sort((a, b) => b["Office %"] - a["Office %"]);

  return (
    <ChartCard title="Department Office Attendance" subtitle="Last 5 working days vs 80% target">
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44 + 40)}>
        <BarChart data={data} barSize={22} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: c.tick }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="department" tick={{ fontSize: 11, fill: c.tick }} axisLine={false} tickLine={false} width={100} />
          <Tooltip
            formatter={(value: unknown) => [`${value}%`, "Office Rate"]}
            contentStyle={{
              backgroundColor: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 12, fontSize: 11,
              color: c.text,
              boxShadow: "var(--shadow-lg)",
            }}
            labelStyle={{ color: c.text }}
            itemStyle={{ color: c.sub }}
            cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}
          />
          <ReferenceLine x={80} stroke={c.ref} strokeDasharray="4 4" strokeWidth={1.5} />
          <Bar dataKey="Office %" radius={[0, 6, 6, 0]}>
            {data.map((entry) => (
              <Cell key={entry.department} fill={entry["Office %"] >= 80 ? "#22c55e" : entry["Office %"] >= 60 ? "#f59e0b" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

interface WeeklyTrendProps { employees: Employee[]; dates: string[]; }

export function WeeklyOfficeTrend({ employees, dates }: WeeklyTrendProps) {
  const { theme } = useTheme();
  const c = CHART_COLORS[theme === "dark" ? "dark" : "light"];
  const weekMap: Record<string, { total: number; office: number }> = {};

  dates.forEach((d) => {
    const date = parseISO(d);
    const weekLabel = format(date, "'W'w MMM");
    if (!weekMap[weekLabel]) weekMap[weekLabel] = { total: 0, office: 0 };
    employees.forEach((emp) => {
      const status = emp.statuses[d];
      if (status) {
        weekMap[weekLabel].total++;
        if (status === "Office" || status === "Client Location" || status === "Split Day") weekMap[weekLabel].office++;
      }
    });
  });

  const data = Object.entries(weekMap).map(([week, val]) => ({
    week,
    "Office %": Math.round((val.office / val.total) * 100),
  }));

  const gradientId = theme === "dark" ? "officeGradientDark" : "officeGradientLight";

  return (
    <ChartCard title="Weekly Office Trend" subtitle="In-office attendance by week">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={theme === "dark" ? 0.15 : 0.2} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: c.tick }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: c.tick }} axisLine={false} tickLine={false} width={35} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={80} stroke={c.ref} strokeDasharray="4 4" strokeWidth={1.5} />
          <Tooltip
            formatter={(value: unknown) => [`${value}%`, "Office Rate"]}
            contentStyle={{
              backgroundColor: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 12, fontSize: 11,
              color: c.text,
              boxShadow: "var(--shadow-lg)",
            }}
            labelStyle={{ color: c.text }}
            itemStyle={{ color: c.sub }}
            cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}
          />
          <Area type="monotone" dataKey="Office %" stroke="#6366f1" strokeWidth={2.5} fill={`url(#${gradientId})`}
            dot={{ r: 3, fill: "#6366f1", stroke: c.bg, strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "#6366f1", strokeWidth: 2, fill: c.bg }} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

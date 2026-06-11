"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { fetchAllData } from "@/lib/api";
import { computeEmployeeAnalytics } from "@/lib/utils";
import { Employee } from "@/lib/types";
import { useTheme } from "@/lib/theme";
import StatsCards from "@/components/StatsCards";
import Filters from "@/components/Filters";
import ComplianceTracker from "@/components/ComplianceTracker";
import TeamBreakdown from "@/components/TeamBreakdown";
import EmployeeDetail from "@/components/EmployeeDetail";
import { DailyTrendChart, StatusPieChart, TeamComplianceChart, WeeklyOfficeTrend } from "@/components/Charts";
import WeeklyOfficeCompliance from "@/components/WeeklyOfficeCompliance";
import LoadingScreen from "@/components/LoadingScreen";
import {
  MapPin, BarChart3, Users, ShieldCheck, Download, Sun, Moon, TrendingUp,
  RefreshCw, AlertCircle, Clock, AlertTriangle, Search, X, Command,
  Keyboard, Flame, Trophy, Award,
} from "lucide-react";

type Tab = "overview" | "compliance" | "team" | "trends";

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;

// ─── Command Palette ──────────────────────────────────────
type CmdAction = { id: string; label: string; sub?: string; icon: React.ReactNode; kbd?: string; action: () => void };

function CommandPalette({
  open, onClose, employees, onSelectEmployee, onSwitchTab, onExport, onRefresh, onToggleTheme,
}: {
  open: boolean; onClose: () => void; employees: Employee[];
  onSelectEmployee: (e: Employee) => void; onSwitchTab: (t: Tab) => void;
  onExport: () => void; onRefresh: () => void; onToggleTheme: () => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQuery(""); setHighlighted(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  const actions: CmdAction[] = useMemo(() => {
    const items: CmdAction[] = [
      { id: "nav-overview", label: "Go to Overview", icon: <BarChart3 size={15} />, kbd: "1", action: () => onSwitchTab("overview") },
      { id: "nav-compliance", label: "Go to Compliance", icon: <ShieldCheck size={15} />, kbd: "2", action: () => onSwitchTab("compliance") },
      { id: "nav-team", label: "Go to Departments", icon: <Users size={15} />, kbd: "3", action: () => onSwitchTab("team") },
      { id: "nav-trends", label: "Go to Trends", icon: <TrendingUp size={15} />, kbd: "4", action: () => onSwitchTab("trends") },
      { id: "action-export", label: "Export CSV", icon: <Download size={15} />, kbd: "E", action: onExport },
      { id: "action-refresh", label: "Refresh Data", icon: <RefreshCw size={15} />, kbd: "R", action: onRefresh },
      { id: "action-theme", label: "Toggle Theme", icon: <Sun size={15} />, kbd: "D", action: onToggleTheme },
    ];
    if (query.trim()) {
      const q = query.toLowerCase();
      const empResults: CmdAction[] = employees
        .filter((e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.departments.some((d) => d.toLowerCase().includes(q)))
        .slice(0, 8)
        .map((e) => ({ id: `emp-${e.email}`, label: e.name, sub: e.departments.join(", ") || e.department, icon: <Users size={15} />, action: () => onSelectEmployee(e) }));
      return [...empResults, ...items.filter((a) => a.label.toLowerCase().includes(q))];
    }
    return items;
  }, [query, employees, onSwitchTab, onExport, onRefresh, onToggleTheme, onSelectEmployee]);

  useEffect(() => { setHighlighted(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, actions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && actions[highlighted]) { actions[highlighted].action(); onClose(); }
    else if (e.key === "Escape") onClose();
  };

  if (!open) return null;
  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search employees, actions..." autoComplete="off" />
        </div>
        {actions.length > 0 ? (
          <div className="cmd-palette-results">
            {actions.map((item, i) => (
              <div key={item.id} className={`cmd-palette-item ${i === highlighted ? "highlighted" : ""}`}
                onClick={() => { item.action(); onClose(); }} onMouseEnter={() => setHighlighted(i)}>
                <span style={{ color: "var(--text-muted)" }}>{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                  {item.sub && <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>{item.sub}</span>}
                </div>
                {item.kbd && <span className="kbd">{item.kbd}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No results for &ldquo;{query}&rdquo;</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────
export default function Dashboard() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "overview";
    const t = new URLSearchParams(window.location.search).get("tab");
    return (["overview", "compliance", "team", "trends"].includes(t || "") ? t : "overview") as Tab;
  });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const { theme, toggleTheme } = useTheme();

  const [selectedDept, setSelectedDept] = useState<string>(() => {
    if (typeof window === "undefined") return "All";
    return new URLSearchParams(window.location.search).get("dept") || "All";
  });
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });

  // Sync filter state → URL (so tab + filters can be shared via link)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (activeTab === "overview") params.delete("tab"); else params.set("tab", activeTab);
    if (selectedDept === "All") params.delete("dept"); else params.set("dept", selectedDept);
    if (!searchQuery) params.delete("q"); else params.set("q", searchQuery);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);
    }
  }, [activeTab, selectedDept, searchQuery]);

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [directorySearch, setDirectorySearch] = useState("");

  const switchTab = useCallback((tab: Tab) => setActiveTab(tab), []);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const data = await fetchAllData();
      setEmployees(data.employees);
      setDates(data.dates);
      if (data.dates.length > 0 && !isRefresh) setSelectedDate(data.dates[data.dates.length - 1]);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { setMounted(true); loadData(); }, [loadData]);
  useEffect(() => {
    const interval = setInterval(() => loadData(true), AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  const departments = useMemo(() => Array.from(new Set(employees.flatMap((e) => e.departments))).filter(Boolean).sort(), [employees]);

  // Pre-compute analytics for ALL employees once (expensive, only re-runs when employees/dates change)
  const allAnalytics = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeEmployeeAnalytics>>();
    employees.forEach((e) => map.set(e.email, computeEmployeeAnalytics(e, dates)));
    return map;
  }, [employees, dates]);

  const filteredEmployees = useMemo(() => {
    let result = employees;
    if (selectedDept !== "All") result = result.filter((e) => e.departments.includes(selectedDept));
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter((e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)); }
    return result;
  }, [employees, selectedDept, searchQuery]);

  // Fast lookup from pre-computed map — no recomputation on filter/search changes
  const analytics = useMemo(() => filteredEmployees.map((e) => allAnalytics.get(e.email)!), [filteredEmployees, allAnalytics]);

  const previousDate = useMemo(() => { const idx = dates.indexOf(selectedDate); return idx > 0 ? dates[idx - 1] : undefined; }, [dates, selectedDate]);

  const alerts = useMemo(() => {
    const nonCompliant = analytics.filter((a) => a.complianceRate < 50);
    const pending = filteredEmployees.filter((e) => !e.statuses[selectedDate] || e.statuses[selectedDate] === "Pending");
    return { nonCompliant: nonCompliant.length, pending: pending.length };
  }, [analytics, filteredEmployees, selectedDate]);

  const handleExport = useCallback(() => {
    const headers = ["Name", "Email", "Department", "Office", "Home", "Client Location", "Split Day", "Travel", "Leave", "Anywhere", "Pending", "Compliance %"];
    const rows = analytics.map((a) => [a.name, a.email, a.department, a.office, a.home, a.clientLocation, a.splitDay, a.travel, a.leave, a.anywhere, a.pending, Math.round(a.complianceRate)]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `missionhq-report-${selectedDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [analytics, selectedDate]);

  // Top 5 streaks (both types)
  const topOfficeStreaks = useMemo(() => {
    return [...analytics].sort((a, b) => b.currentStreak - a.currentStreak).slice(0, 5).filter((a) => a.currentStreak > 0);
  }, [analytics]);

  const topAttendanceStreaks = useMemo(() => {
    return [...analytics].sort((a, b) => b.currentAttendanceStreak - a.currentAttendanceStreak).slice(0, 5).filter((a) => a.currentAttendanceStreak > 0);
  }, [analytics]);

  const [streakTab, setStreakTab] = useState<"overall" | "office">("overall");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") { e.preventDefault(); setCmdOpen(true); return; }
      if (e.key === "1") switchTab("overview");
      else if (e.key === "2") switchTab("compliance");
      else if (e.key === "3") switchTab("team");
      else if (e.key === "4") switchTab("trends");
      else if (e.key === "r" && !e.metaKey && !e.ctrlKey) loadData(true);
      else if (e.key === "d") toggleTheme();
      else if (e.key === "e") handleExport();
      else if (e.key === "?") setShowShortcuts(s => !s);
      else if (e.key === "Escape") { setSelectedEmployee(null); setCmdOpen(false); setShowShortcuts(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loadData, toggleTheme, handleExport, switchTab]);

  const todayCounts = useMemo(() => {
    let office = 0, pending = 0;
    filteredEmployees.forEach((e) => {
      const s = e.statuses[selectedDate];
      if (s === "Office" || s === "Client Location" || s === "Split Day") office++;
      if (s === "Pending" || !s) pending++;
    });
    return { office, pending, total: filteredEmployees.length };
  }, [filteredEmployees, selectedDate]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: <BarChart3 size={16} /> },
    { id: "compliance", label: "Compliance", icon: <ShieldCheck size={16} />, badge: alerts.nonCompliant > 0 ? alerts.nonCompliant : undefined },
    { id: "team", label: "Departments", icon: <Users size={16} /> },
    { id: "trends", label: "Trends", icon: <TrendingUp size={16} /> },
  ];

  // ─── Loading: Mission Control acquiring signal ─────────
  if (!mounted || loading) return <LoadingScreen />;

  // ─── Error ────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-app)" }}>
        <div className="flex flex-col items-center gap-5 text-center max-w-md p-8">
          <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertCircle size={32} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Failed to load data</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{error}</p>
          </div>
          <button onClick={() => loadData()} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl hover:opacity-90 transition-all active:scale-95 font-medium text-sm" style={{ background: "var(--accent)" }}>
            <RefreshCw size={16} /> Try Again
          </button>
        </div>
      </div>
    );
  }

  // ─── Main ─────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>

      {/* Alert Banner */}
      {(alerts.nonCompliant > 0 || alerts.pending > 5) && (
        <div className="alert-banner no-print border-b bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-3 text-xs font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
            <span>
              {alerts.nonCompliant > 0 && <>{alerts.nonCompliant} below compliance</>}
              {alerts.nonCompliant > 0 && alerts.pending > 5 && " · "}
              {alerts.pending > 5 && <>{alerts.pending} pending</>}
            </span>
            <button onClick={() => switchTab("compliance")} className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors bg-amber-200/60 hover:bg-amber-200 dark:bg-amber-800/40 dark:hover:bg-amber-800/60 text-amber-900 dark:text-amber-200">
              View
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="glass border-b sticky top-0 z-40 no-print" style={{ borderColor: "var(--border-default)" }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          {/* Logo + Status */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)" }}>
              <MapPin size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>MissionHQ</h1>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span className="flex items-center gap-1">
                  <span className="status-dot live" style={{ background: "#22c55e" }} />
                  {todayCounts.office}/{todayCounts.total} in office
                </span>
                {todayCounts.pending > 0 && (
                  <span className="text-amber-500 font-medium">&middot; {todayCounts.pending} pending</span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {lastUpdated && (
              <div className="hidden md:flex items-center gap-1.5 text-[11px] mr-2" style={{ color: "var(--text-muted)" }}>
                <Clock size={11} />
                Updated {lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}

            {/* Cmd+K trigger */}
            <button onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs mr-1 transition-colors hover:border-[var(--accent-muted)]"
              style={{ background: "var(--bg-surface-secondary)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
              <Search size={12} />
              <span>Search</span>
              <kbd className="font-mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}>⌘K</kbd>
            </button>

            <button onClick={() => loadData(true)} disabled={refreshing}
              className="p-2 rounded-lg transition-all active:scale-95 disabled:opacity-40 hover:bg-[var(--bg-surface-hover)]"
              style={{ color: "var(--text-secondary)" }} title="Refresh (R)">
              <RefreshCw size={16} className={refreshing ? "refresh-spin" : ""} />
            </button>
            <button onClick={toggleTheme}
              className="p-2 rounded-lg transition-all active:scale-95 hover:bg-[var(--bg-surface-hover)]"
              style={{ color: "var(--text-secondary)" }} title={`${theme === "light" ? "Dark" : "Light"} mode (D)`}>
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button onClick={() => setShowShortcuts(true)}
              className="hidden sm:flex p-2 rounded-lg transition-all active:scale-95 hover:bg-[var(--bg-surface-hover)]"
              style={{ color: "var(--text-secondary)" }} title="Shortcuts (?)">
              <Keyboard size={16} />
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] rounded-lg transition-all active:scale-95 font-medium hover:bg-[var(--bg-surface-hover)]"
              style={{ color: "var(--text-secondary)" }} title="Export (E)">
              <Download size={14} /> <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex gap-0.5 -mb-px">
            {tabs.map((tab, i) => (
              <button key={tab.id} onClick={() => switchTab(tab.id)}
                className={`tab-indicator flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-all ${
                  activeTab === tab.id
                    ? "tab-active"
                    : ""
                }`}
                style={{ color: activeTab === tab.id ? "var(--accent)" : "var(--text-muted)" }}>
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.badge && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full animate-pulse-soft">
                    {tab.badge}
                  </span>
                )}
                <span className="hidden lg:inline text-[10px] ml-1 font-normal font-mono" style={{ color: "var(--text-faint)" }}>{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        <div className="mb-5">
          <Filters departments={departments} selectedDept={selectedDept} onDeptChange={setSelectedDept}
            searchQuery={searchQuery} onSearchChange={setSearchQuery} selectedDate={selectedDate}
            onDateChange={setSelectedDate} dates={dates} />
        </div>

        {/* Active filter context */}
        {(searchQuery || selectedDept !== "All") && filteredEmployees.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-xs" style={{ background: "var(--accent-light)", border: "1px solid var(--accent-muted)" }}>
            <Users size={13} style={{ color: "var(--accent)" }} />
            <span style={{ color: "var(--text-secondary)" }}>
              Showing data for{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {filteredEmployees.length === 1
                  ? filteredEmployees[0].name
                  : `${filteredEmployees.length} employees`}
              </strong>
              {selectedDept !== "All" && <> in <strong style={{ color: "var(--text-primary)" }}>{selectedDept}</strong></>}
              {searchQuery && <> matching &quot;<strong style={{ color: "var(--text-primary)" }}>{searchQuery}</strong>&quot;</>}
            </span>
          </div>
        )}

        {filteredEmployees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "var(--bg-inset)" }}>
              <Users size={28} style={{ color: "var(--text-faint)" }} />
            </div>
            <h3 className="text-base font-semibold" style={{ color: "var(--text-secondary)" }}>No employees found</h3>
            <p className="text-sm mt-1 max-w-sm" style={{ color: "var(--text-muted)" }}>Try adjusting your search or department filter</p>
            <button onClick={() => { setSelectedDept("All"); setSearchQuery(""); }}
              className="mt-4 px-4 py-2 text-sm font-medium rounded-lg transition-all"
              style={{ color: "var(--accent)", background: "var(--accent-light)" }}>
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {activeTab === "overview" && (
              <>
                <StatsCards employees={filteredEmployees} date={selectedDate} previousDate={previousDate} />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  <div className="lg:col-span-2"><DailyTrendChart employees={filteredEmployees} dates={dates} /></div>
                  <StatusPieChart employees={filteredEmployees} date={selectedDate} />
                </div>

                {/* Top 5 Streaks with tabs */}
                {(topOfficeStreaks.length > 0 || topAttendanceStreaks.length > 0) && (
                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/25 flex items-center justify-center">
                          <Flame size={16} className="text-orange-500" />
                        </div>
                        <div>
                          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Streaks</h2>
                          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Top 5 current consecutive days</p>
                        </div>
                      </div>
                      {/* Tabs */}
                      <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--bg-inset)" }}>
                        <button onClick={() => setStreakTab("overall")}
                          className="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                          style={{
                            background: streakTab === "overall" ? "var(--bg-surface)" : "transparent",
                            color: streakTab === "overall" ? "var(--text-primary)" : "var(--text-muted)",
                            boxShadow: streakTab === "overall" ? "var(--shadow-xs)" : "none",
                          }}>Overall</button>
                        <button onClick={() => setStreakTab("office")}
                          className="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                          style={{
                            background: streakTab === "office" ? "var(--bg-surface)" : "transparent",
                            color: streakTab === "office" ? "var(--text-primary)" : "var(--text-muted)",
                            boxShadow: streakTab === "office" ? "var(--shadow-xs)" : "none",
                          }}>Office</button>
                      </div>
                    </div>

                    {(() => {
                      const list = streakTab === "office" ? topOfficeStreaks : topAttendanceStreaks;
                      const getStreak = (emp: typeof list[0]) => streakTab === "office" ? emp.currentStreak : emp.currentAttendanceStreak;
                      const medals = ["text-yellow-500", "text-gray-400", "text-amber-600"];
                      if (list.length === 0) return (
                        <div className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>No active streaks</div>
                      );
                      return (
                        <div className="space-y-2">
                          {list.map((emp, i) => (
                            <div key={emp.email} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: i === 0 ? "var(--accent-light)" : "var(--bg-inset)" }}>
                              <span className="w-6 text-center text-xs font-bold font-mono" style={{ color: i < 3 ? undefined : "var(--text-muted)" }}>
                                {i < 3 ? <Trophy size={14} className={`inline ${medals[i]}`} /> : `#${i + 1}`}
                              </span>
                              <div className={`avatar w-7 h-7 text-[10px] ${
                                i === 0 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                                : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400"
                              }`}>
                                {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</div>
                                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{emp.departments?.join(", ") || emp.department}</div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Flame size={13} className={getStreak(emp) >= 5 ? "text-orange-500" : "text-gray-400 dark:text-gray-600"} />
                                <span className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>{getStreak(emp)}</span>
                                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>days</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <WeeklyOfficeCompliance employees={filteredEmployees} dates={dates} />
                <TeamComplianceChart employees={filteredEmployees} dates={dates} />
              </>
            )}

            {activeTab === "compliance" && (
              <>
                <WeeklyOfficeCompliance employees={filteredEmployees} dates={dates} />
                <ComplianceTracker analytics={analytics} selectedDept={selectedDept} dates={dates} />
                <WeeklyOfficeTrend employees={filteredEmployees} dates={dates} />
              </>
            )}

            {activeTab === "team" && (
              <>
                <TeamBreakdown employees={filteredEmployees} dates={dates} selectedDept={selectedDept} />
                <div className="card p-5">
                  {(() => {
                    const q = directorySearch.trim().toLowerCase();
                    const directoryEmployees = q
                      ? filteredEmployees.filter((e) =>
                          e.name.toLowerCase().includes(q) ||
                          e.email.toLowerCase().includes(q) ||
                          e.departments.some((d) => d.toLowerCase().includes(q)) ||
                          (e.department?.toLowerCase().includes(q) ?? false)
                        )
                      : filteredEmployees;
                    return (
                      <>
                        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                          <div>
                            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Employee Directory</h2>
                            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {directoryEmployees.length} {directoryEmployees.length === 1 ? "employee" : "employees"}
                              {q && filteredEmployees.length !== directoryEmployees.length && ` of ${filteredEmployees.length}`}
                              {" "}&middot; Click for details
                            </p>
                          </div>
                          <div className="relative w-full sm:w-72">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                            <input
                              type="text"
                              value={directorySearch}
                              onChange={(e) => setDirectorySearch(e.target.value)}
                              placeholder="Search this list…"
                              className="w-full pl-9 pr-8 py-2 text-[13px] rounded-lg border focus:outline-none transition-all"
                              style={{
                                background: "var(--bg-surface-secondary)",
                                borderColor: "var(--border-default)",
                                color: "var(--text-primary)",
                              }}
                            />
                            {directorySearch && (
                              <button
                                onClick={() => setDirectorySearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center"
                                style={{ background: "var(--text-faint)" }}
                                aria-label="Clear directory search"
                              >
                                <X size={9} className="text-white" />
                              </button>
                            )}
                          </div>
                        </div>
                        {directoryEmployees.length === 0 ? (
                          <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                            No employees match &ldquo;{directorySearch}&rdquo;
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {directoryEmployees.map((emp) => {
                              const empAnalytics = allAnalytics.get(emp.email)!;
                              const todayStatus = emp.statuses[selectedDate] || "No Data";
                              const initials = emp.name.split(" ").map(n => n[0]).join("").slice(0, 2);
                              return (
                        <button key={emp.email} onClick={() => setSelectedEmployee(emp)}
                          className="card-interactive text-left p-4 rounded-xl border focus-visible:ring-2 focus-visible:ring-indigo-500"
                          style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}>
                          <div className="flex items-start gap-3 mb-3">
                            <div className={`avatar w-9 h-9 text-xs ${
                              empAnalytics.complianceRate >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                              : empAnalytics.complianceRate >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                            }`}>{initials}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-[13px] truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</div>
                              <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{emp.department}</div>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
                              todayStatus === "Office" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" :
                              todayStatus === "Home" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" :
                              todayStatus === "Anywhere" ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400" :
                              todayStatus === "Pending" || todayStatus === "No Data" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" :
                              "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400"
                            }`}>{todayStatus === "Client Location" ? "Client" : todayStatus}</span>
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[11px] mb-1.5">
                              <span style={{ color: "var(--text-muted)" }}>Compliance</span>
                              <span className={`font-bold font-mono ${
                                empAnalytics.complianceRate >= 80 ? "text-emerald-600 dark:text-emerald-400" :
                                empAnalytics.complianceRate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                              }`}>{Math.round(empAnalytics.complianceRate)}%</span>
                            </div>
                            <div className="w-full rounded-full h-1.5" style={{ background: "var(--bg-inset)" }}>
                              <div className={`h-1.5 rounded-full transition-all duration-300 ${
                                empAnalytics.complianceRate >= 80 ? "bg-emerald-500" : empAnalytics.complianceRate >= 50 ? "bg-amber-500" : "bg-red-500"
                              }`} style={{ width: `${Math.min(empAnalytics.complianceRate, 100)}%` }} />
                            </div>
                          </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </>
            )}

            {activeTab === "trends" && (
              <>
                <DailyTrendChart employees={filteredEmployees} dates={dates} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <WeeklyOfficeTrend employees={filteredEmployees} dates={dates} />
                  <TeamComplianceChart employees={filteredEmployees} dates={dates} />
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 mt-4 no-print">
        <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)", paddingTop: "16px" }}>
          <span>MissionHQ &middot; {employees.length} employees tracked</span>
          <span className="hidden sm:flex items-center gap-1.5">
            <kbd className="font-mono px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}>⌘K</kbd>
            search &middot;
            <kbd className="font-mono px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}>?</kbd>
            shortcuts
          </span>
        </div>
      </footer>

      {/* Employee Slide Panel */}
      {selectedEmployee && (
        <EmployeeDetail employee={selectedEmployee} dates={dates} onClose={() => setSelectedEmployee(null)} />
      )}

      {/* Command Palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} employees={employees}
        onSelectEmployee={(e) => setSelectedEmployee(e)} onSwitchTab={switchTab}
        onExport={handleExport} onRefresh={() => loadData(true)} onToggleTheme={toggleTheme} />

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div className="animate-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => setShowShortcuts(false)}>
          <div className="animate-modal card max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                <Keyboard size={16} /> Keyboard Shortcuts
              </h2>
              <button onClick={() => setShowShortcuts(false)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-surface-hover)]" style={{ color: "var(--text-muted)" }}>
                <X size={15} />
              </button>
            </div>
            <div className="space-y-1.5">
              {[["⌘K / /", "Search & commands"], ["1-4", "Switch tabs"], ["R", "Refresh data"], ["D", "Toggle theme"], ["E", "Export CSV"], ["?", "Show shortcuts"], ["Esc", "Close modals"]].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between py-1.5">
                  <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{desc}</span>
                  <kbd className="px-2 py-1 rounded-md text-[11px] font-mono min-w-[36px] text-center"
                    style={{ background: "var(--bg-inset)", border: "1px solid var(--border-default)", color: "var(--text-muted)" }}>
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { Employee, STATUS_COLORS } from "@/lib/types";
import { computeEmployeeAnalytics } from "@/lib/utils";
import { X, CheckCircle2, XCircle, AlertTriangle, Building2, Home, MapPin, ArrowLeftRight, Plane, TreePalm, Globe, Mail, Briefcase, Flame, Trophy } from "lucide-react";
import { useState } from "react";

interface Props {
  employee: Employee;
  dates: string[];
  onClose: () => void;
}

type ModalTab = "overview" | "weekly";

export default function EmployeeDetail({ employee, dates, onClose }: Props) {
  const analytics = computeEmployeeAnalytics(employee, dates);
  const [tab, setTab] = useState<ModalTab>("overview");

  const statCounts = [
    { label: "Office", value: analytics.office, icon: <Building2 size={13} />, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/15 border-green-200 dark:border-green-800/40" },
    { label: "Home", value: analytics.home, icon: <Home size={13} />, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-900/15 border-blue-200 dark:border-blue-800/40" },
    { label: "Client", value: analytics.clientLocation, icon: <MapPin size={13} />, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-900/15 border-amber-200 dark:border-amber-800/40" },
    { label: "Split", value: analytics.splitDay, icon: <ArrowLeftRight size={13} />, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/15 border-violet-200 dark:border-violet-800/40" },
    { label: "Travel", value: analytics.travel, icon: <Plane size={13} />, color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50 dark:bg-pink-900/15 border-pink-200 dark:border-pink-800/40" },
    { label: "Leave", value: analytics.leave, icon: <TreePalm size={13} />, color: "text-gray-500 dark:text-gray-400", bg: "bg-gray-50 dark:bg-slate-800/50 border-gray-200 dark:border-slate-700/50" },
    { label: "Anywhere", value: analytics.anywhere, icon: <Globe size={13} />, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50 dark:bg-cyan-900/15 border-cyan-200 dark:border-cyan-800/40" },
  ].filter((s) => s.value > 0); // Only show statuses that have data

  const recentDates = dates.slice(-30);
  const initials = employee.name.split(" ").map(n => n[0]).join("").slice(0, 2);

  return (
    <div className="animate-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>

      <div className="animate-modal card max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="relative px-6 py-5 flex-shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white/80 hover:text-white">
            <X size={18} />
          </button>

          <div className="flex items-center gap-4">
            <div className="avatar w-12 h-12 text-base bg-white/20 backdrop-blur-sm border-2 border-white/30 text-white">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{employee.name}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-sm text-white/70">
                <span className="flex items-center gap-1 truncate"><Mail size={11} /> {employee.email}</span>
                {employee.departments?.length > 0 ? (
                  <span className="flex items-center gap-1 flex-wrap">
                    <Briefcase size={11} />
                    {employee.departments.map((dept) => (
                      <span key={dept} className="px-1.5 py-0.5 rounded bg-white/15 text-[11px]">{dept}</span>
                    ))}
                  </span>
                ) : (
                  <span className="flex items-center gap-1"><Briefcase size={11} /> {employee.department}</span>
                )}
              </div>
            </div>
          </div>

          {/* Stats row in header */}
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm">
              {analytics.complianceRate >= 80 ? <CheckCircle2 size={14} className="text-green-300" />
                : analytics.complianceRate >= 50 ? <AlertTriangle size={14} className="text-amber-300" />
                : <XCircle size={14} className="text-red-300" />}
              <span className="text-sm font-bold font-mono text-white">{Math.round(analytics.complianceRate)}%</span>
              <span className="text-[10px] text-white/50">compliance</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm">
              <Flame size={14} className={analytics.currentStreak >= 3 ? "text-orange-300" : "text-white/50"} />
              <span className="text-sm font-bold font-mono text-white">{analytics.currentStreak}</span>
              <span className="text-[10px] text-white/50">day streak</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-sm">
              <Trophy size={14} className="text-yellow-300" />
              <span className="text-sm font-bold font-mono text-white">{analytics.longestStreak}</span>
              <span className="text-[10px] text-white/50">best</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-6">
            {/* Tabs */}
            <div className="flex gap-1 mb-5 p-1 rounded-lg" style={{ background: "var(--bg-inset)" }}>
              {([["overview", "Overview"], ["weekly", "Weekly Breakdown"]] as [ModalTab, string][]).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className="flex-1 py-2 text-sm font-medium rounded-md transition-all"
                  style={{
                    background: tab === id ? "var(--bg-surface)" : "transparent",
                    color: tab === id ? "var(--text-primary)" : "var(--text-muted)",
                    boxShadow: tab === id ? "var(--shadow-xs)" : "none",
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <>
                {/* Compliance Bar */}
                <div className="mb-5 p-4 rounded-xl" style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Overall Compliance</span>
                    <span className={`text-sm font-bold font-mono ${
                      analytics.complianceRate >= 80 ? "text-emerald-600 dark:text-emerald-400" : analytics.complianceRate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                    }`}>{Math.round(analytics.complianceRate)}%</span>
                  </div>
                  <div className="w-full rounded-full h-2" style={{ background: "var(--border-default)" }}>
                    <div className={`h-2 rounded-full transition-all duration-300 ${analytics.complianceRate >= 80 ? "bg-emerald-500" : analytics.complianceRate >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(analytics.complianceRate, 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    <span>{analytics.totalDays} total days tracked</span>
                    <span>{analytics.office + analytics.clientLocation + analytics.splitDay} in-office days</span>
                  </div>
                </div>

                {/* Status Counts - only non-zero */}
                <div className="section-label mb-2.5">Status Breakdown</div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
                  {statCounts.map((s) => (
                    <div key={s.label} className={`text-center p-2.5 rounded-lg border ${s.bg}`}>
                      <div className={`flex items-center justify-center mb-1 ${s.color}`}>{s.icon}</div>
                      <div className={`text-base font-bold font-mono ${s.color}`}>{s.value}</div>
                      <div className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Streak Info */}
                {(analytics.currentStreak > 0 || analytics.longestStreak > 0) && (
                  <>
                    <div className="section-label mb-2.5">Office Streaks</div>
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Flame size={15} className={analytics.currentStreak >= 3 ? "text-orange-500" : "text-gray-400"} />
                          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Current Streak</span>
                        </div>
                        <div className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                          {analytics.currentStreak} <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>days</span>
                        </div>
                      </div>
                      <div className="p-3.5 rounded-xl border" style={{ background: "var(--bg-inset)", borderColor: "var(--border-subtle)" }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Trophy size={15} className="text-yellow-500" />
                          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Best Streak</span>
                        </div>
                        <div className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                          {analytics.longestStreak} <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>days</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Activity Heatmap */}
                <div className="section-label mb-2.5">Last 30 Working Days</div>
                <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5 mb-2">
                  {recentDates.map((d) => {
                    const status = employee.statuses[d] || "";
                    const bg = STATUS_COLORS[status] || "#e5e7eb";
                    const dateObj = new Date(d + "T00:00:00");
                    return (
                      <div key={d} className="rounded-md p-1.5 text-center border transition-transform hover:scale-105"
                        style={{
                          backgroundColor: status ? bg + "20" : "var(--bg-inset)",
                          borderColor: status ? bg + "30" : "var(--border-subtle)",
                        }}
                        title={`${dateObj.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}: ${status || "No data"}`}>
                        <div className="text-[10px] font-bold font-mono" style={{ color: status ? bg : "var(--text-muted)" }}>
                          {dateObj.toLocaleDateString("en-IN", { day: "numeric" })}
                        </div>
                        <div className="text-[7px]" style={{ color: "var(--text-muted)" }}>
                          {dateObj.toLocaleDateString("en-IN", { weekday: "narrow" })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-3 mt-3">
                  {Object.entries(STATUS_COLORS).filter(([s]) => s !== "Pending").map(([status, color]) => (
                    <div key={status} className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                      {status}
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "weekly" && (
              <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
                {analytics.weeklyCompliance.slice().reverse().slice(0, 16).map((w) => (
                  <div key={w.weekStart} className={`flex items-center gap-3 text-xs p-3 rounded-lg border transition-colors ${
                    w.isCompliant
                      ? "bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/30"
                      : "bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30"
                  }`}>
                    <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: w.isCompliant ? "rgba(220,252,231,0.12)" : "rgba(254,226,226,0.12)" }}>
                      {w.isCompliant ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold" style={{ color: "var(--text-primary)" }}>{w.weekLabel}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{w.officeDays} of {w.requiredDays} required</div>
                    </div>
                    <div className="flex-1 hidden sm:block">
                      <div className="rounded-full h-1.5" style={{ background: "var(--bg-inset)" }}>
                        <div className={`h-1.5 rounded-full transition-all duration-300 ${w.isCompliant ? "bg-emerald-500" : "bg-red-400"}`}
                          style={{ width: `${Math.min((w.officeDays / 5) * 100, 100)}%` }} />
                      </div>
                    </div>
                    <span className={`font-bold font-mono text-sm ${w.isCompliant ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                      {w.officeDays}/{w.totalWorkDays}
                    </span>
                  </div>
                ))}
                {analytics.weeklyCompliance.length === 0 && (
                  <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>No weekly data available</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { EmployeeAnalytics } from "@/lib/types";
import { CheckCircle2, XCircle, AlertTriangle, Shield, X, Calendar } from "lucide-react";
import { useState } from "react";

interface Props {
  analytics: EmployeeAnalytics[];
  selectedDept: string;
  dates: string[];
}

type SortField = "name" | "department" | "officeDays" | "compliance" | "compliantWeeks";
type SortDir = "asc" | "desc";
type ViewFilter = "all" | "compliant" | "atRisk" | "nonCompliant";

export default function ComplianceTracker({ analytics, selectedDept, dates }: Props) {
  const [sortField, setSortField] = useState<SortField>("compliance");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");

  const filtered = selectedDept === "All"
    ? analytics
    : analytics.filter((a) => a.departments?.includes(selectedDept));

  const compliant = filtered.filter((a) => a.complianceRate >= 80);
  const atRisk = filtered.filter((a) => a.complianceRate >= 50 && a.complianceRate < 80);
  const nonCompliant = filtered.filter((a) => a.complianceRate < 50);

  const complianceRate = filtered.length > 0
    ? Math.round((compliant.length / filtered.length) * 100)
    : 0;

  const displayList = viewFilter === "all" ? filtered
    : viewFilter === "compliant" ? compliant
    : viewFilter === "atRisk" ? atRisk
    : nonCompliant;

  const sorted = [...displayList].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name": cmp = a.name.localeCompare(b.name); break;
      case "department": cmp = a.department.localeCompare(b.department); break;
      case "officeDays": cmp = (a.office + a.clientLocation + a.splitDay) - (b.office + b.clientLocation + b.splitDay); break;
      case "compliance": cmp = a.complianceRate - b.complianceRate; break;
      case "compliantWeeks": {
        const aWeeks = a.weeklyCompliance.filter(w => w.totalWorkDays >= 4);
        const bWeeks = b.weeklyCompliance.filter(w => w.totalWorkDays >= 4);
        const aCompliant = aWeeks.filter(w => w.isCompliant).length;
        const bCompliant = bWeeks.filter(w => w.isCompliant).length;
        cmp = aCompliant - bCompliant;
        break;
      }
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className={`ml-1 text-[10px] ${sortField === field ? "opacity-100" : "opacity-30"}`} style={{ color: sortField === field ? "var(--accent)" : "var(--text-muted)" }}>
      {sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  // Date range info
  const sortedDates = [...dates].sort();
  const firstDate = sortedDates.length > 0 ? sortedDates[0] : "";
  const lastDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : "";
  const totalWorkingDays = dates.length;

  const formatDate = (d: string) => {
    if (!d) return "";
    return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  // Calculate total weeks tracked
  const sampleAnalytics = filtered.length > 0 ? filtered[0] : null;
  const totalWeeksTracked = sampleAnalytics ? sampleAnalytics.weeklyCompliance.length : 0;
  const completeWeeks = sampleAnalytics ? sampleAnalytics.weeklyCompliance.filter(w => w.totalWorkDays >= 4).length : 0;

  const summaryItems: { label: string; count: number; icon: React.ReactNode; color: string; filter: ViewFilter }[] = [
    { label: "Compliant (≥80%)", count: compliant.length, icon: <CheckCircle2 size={14} />, color: "text-emerald-500", filter: "compliant" },
    { label: "At Risk (50-79%)", count: atRisk.length, icon: <AlertTriangle size={14} />, color: "text-amber-500", filter: "atRisk" },
    { label: "Non-Compliant (<50%)", count: nonCompliant.length, icon: <XCircle size={14} />, color: "text-red-500", filter: "nonCompliant" },
  ];

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
            <Shield size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Overall 4-Day Office Compliance</h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              % of weeks each employee met the 4-day office requirement (Office + Client + Split Day)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right mr-2">
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>Team Rate</div>
            <div className={`text-lg font-bold font-mono ${complianceRate >= 80 ? "text-emerald-600 dark:text-emerald-400" : complianceRate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
              {complianceRate}%
            </div>
          </div>
          <div className="w-11 h-11 relative">
            <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" className="text-gray-100 dark:text-slate-800" strokeWidth="2.5" />
              <circle cx="18" cy="18" r="15" fill="none"
                stroke={complianceRate >= 80 ? "#22c55e" : complianceRate >= 50 ? "#f59e0b" : "#ef4444"}
                strokeWidth="2.5" strokeDasharray={`${complianceRate * 0.94} 100`}
                strokeLinecap="round" className="transition-all duration-300" />
            </svg>
          </div>
        </div>
      </div>

      {/* Date range & tracking info */}
      <div className="flex flex-wrap items-center gap-4 mb-5 p-3 rounded-lg" style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <Calendar size={13} style={{ color: "var(--text-muted)" }} />
          <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {formatDate(firstDate)} – {formatDate(lastDate)}
          </span>
        </div>
        <div className="w-px h-4" style={{ background: "var(--border-default)" }} />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--text-secondary)" }}>{totalWorkingDays}</strong> working days tracked
        </span>
        <div className="w-px h-4" style={{ background: "var(--border-default)" }} />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--text-secondary)" }}>{completeWeeks}</strong> complete weeks (4+ working days)
          {totalWeeksTracked > completeWeeks && (
            <span> out of {totalWeeksTracked} total</span>
          )}
        </span>
      </div>

      {/* Summary Row */}
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {summaryItems.map((item) => (
          <button
            key={item.label}
            onClick={() => setViewFilter(viewFilter === item.filter ? "all" : item.filter)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: viewFilter === item.filter ? "var(--accent-light)" : "var(--bg-inset)",
              color: viewFilter === item.filter ? "var(--accent)" : "var(--text-secondary)",
              border: viewFilter === item.filter ? "1px solid var(--accent-muted)" : "1px solid transparent",
            }}
          >
            <span className={item.color}>{item.icon}</span>
            <span className="font-bold font-mono">{item.count}</span>
            <span>{item.label}</span>
          </button>
        ))}
        {viewFilter !== "all" && (
          <button onClick={() => setViewFilter("all")} className="ml-1 text-[11px] font-medium px-2 py-1 rounded-md transition-all"
            style={{ color: "var(--text-muted)" }}>
            <X size={12} className="inline mr-0.5" />Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="max-h-[400px] overflow-y-auto scrollbar-thin rounded-lg border" style={{ borderColor: "var(--border-subtle)" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10" style={{ background: "var(--bg-surface-secondary)" }}>
            <tr>
              <th onClick={() => toggleSort("name")} className="text-left py-2.5 px-3 font-medium cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                Employee <SortIcon field="name" />
              </th>
              <th onClick={() => toggleSort("department")} className="text-left py-2.5 px-3 font-medium cursor-pointer select-none hidden sm:table-cell" style={{ color: "var(--text-secondary)" }}>
                Department <SortIcon field="department" />
              </th>
              <th onClick={() => toggleSort("officeDays")} className="text-center py-2.5 px-3 font-medium cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                <span title="Total office days (Office + Client + Split Day) out of total working days">Office Days <SortIcon field="officeDays" /></span>
              </th>
              <th onClick={() => toggleSort("compliantWeeks")} className="text-center py-2.5 px-3 font-medium cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                <span title="Weeks with 4+ office days out of total complete weeks">Weeks Met <SortIcon field="compliantWeeks" /></span>
              </th>
              <th onClick={() => toggleSort("compliance")} className="text-center py-2.5 px-3 font-medium cursor-pointer select-none" style={{ color: "var(--text-secondary)" }}>
                <span title="Percentage of complete weeks where 4-day office requirement was met">Rate <SortIcon field="compliance" /></span>
              </th>
              <th className="text-center py-2.5 px-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((emp) => {
              const officeDays = emp.office + emp.clientLocation + emp.splitDay;
              const empCompleteWeeks = emp.weeklyCompliance.filter(w => w.totalWorkDays >= 4);
              const empCompliantWeeks = empCompleteWeeks.filter(w => w.isCompliant).length;
              return (
                <tr key={emp.email} className="table-row-hover" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`avatar w-7 h-7 text-[10px] ${
                        emp.complianceRate >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                        : emp.complianceRate >= 50 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                      }`}>
                        {emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </div>
                      <div>
                        <div className="font-medium text-[13px]" style={{ color: "var(--text-primary)" }}>{emp.name}</div>
                        <div className="text-[11px] sm:hidden" style={{ color: "var(--text-muted)" }}>
                          {emp.departments?.length > 1 ? emp.departments.join(", ") : emp.department}
                        </div>
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
                    <span className="font-semibold font-mono text-[13px]" style={{ color: "var(--text-primary)" }}>{officeDays}</span>
                    <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}> / {emp.totalDays}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`font-semibold font-mono text-[13px] ${empCompliantWeeks > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`} style={empCompliantWeeks === 0 ? { color: "var(--text-muted)" } : undefined}>
                      {empCompliantWeeks}
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}> / {empCompleteWeeks.length}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-14 rounded-full h-1.5" style={{ background: "var(--bg-inset)" }}>
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${emp.complianceRate >= 80 ? "bg-emerald-500" : emp.complianceRate >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(emp.complianceRate, 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold font-mono w-10 ${
                        emp.complianceRate >= 80 ? "text-emerald-600 dark:text-emerald-400" : emp.complianceRate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                      }`}>{Math.round(emp.complianceRate)}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {emp.complianceRate >= 80 ? (
                      <CheckCircle2 size={14} className="text-emerald-500 inline" />
                    ) : emp.complianceRate >= 50 ? (
                      <AlertTriangle size={14} className="text-amber-500 inline" />
                    ) : (
                      <XCircle size={14} className="text-red-500 inline" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No employees match this filter
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { Employee } from "@/lib/types";
import { Building2, Home, MapPin, ArrowLeftRight, Plane, TreePalm, Globe, AlertCircle, Users, TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  employees: Employee[];
  date: string;
  previousDate?: string;
}

export default function StatsCards({ employees, date, previousDate }: Props) {
  const counts = { Office: 0, Home: 0, "Client Location": 0, "Split Day": 0, Travel: 0, Leave: 0, Anywhere: 0, Pending: 0, "No Data": 0 };
  const prevCounts = { Office: 0, Home: 0, "Client Location": 0, "Split Day": 0, Travel: 0, Leave: 0, Anywhere: 0, Pending: 0, "No Data": 0 };

  employees.forEach((emp) => {
    const status = emp.statuses[date] || "No Data";
    if (status in counts) counts[status as keyof typeof counts]++;
    else counts["No Data"]++;

    if (previousDate) {
      const prevStatus = emp.statuses[previousDate] || "No Data";
      if (prevStatus in prevCounts) prevCounts[prevStatus as keyof typeof prevCounts]++;
      else prevCounts["No Data"]++;
    }
  });

  const total = employees.length;
  const responded = total - counts.Pending - counts["No Data"];
  const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;
  const inOffice = counts.Office + counts["Client Location"] + counts["Split Day"];
  const officeRate = total > 0 ? Math.round((inOffice / total) * 100) : 0;
  const pendingCount = counts.Pending + counts["No Data"];
  const pendingRate = total > 0 ? Math.round((pendingCount / total) * 100) : 0;

  const cards = [
    { label: "Total", value: total, icon: <Users size={16} />, accent: "stat-card-slate", iconBg: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400" },
    { label: "Office", value: counts.Office, icon: <Building2 size={16} />, accent: "stat-card-green", iconBg: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400", prevValue: previousDate ? prevCounts.Office : undefined },
    { label: "Home", value: counts.Home, icon: <Home size={16} />, accent: "stat-card-blue", iconBg: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400", prevValue: previousDate ? prevCounts.Home : undefined },
    { label: "Client", value: counts["Client Location"], icon: <MapPin size={16} />, accent: "stat-card-amber", iconBg: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400", prevValue: previousDate ? prevCounts["Client Location"] : undefined },
    { label: "Split", value: counts["Split Day"], icon: <ArrowLeftRight size={16} />, accent: "stat-card-violet", iconBg: "bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400", prevValue: previousDate ? prevCounts["Split Day"] : undefined },
    { label: "Travel", value: counts.Travel, icon: <Plane size={16} />, accent: "stat-card-pink", iconBg: "bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400", prevValue: previousDate ? prevCounts.Travel : undefined },
    { label: "Leave", value: counts.Leave, icon: <TreePalm size={16} />, accent: "stat-card-gray", iconBg: "bg-gray-100 dark:bg-slate-800/80 text-gray-500 dark:text-gray-400", prevValue: previousDate ? prevCounts.Leave : undefined },
    { label: "Anywhere", value: counts.Anywhere, icon: <Globe size={16} />, accent: "stat-card-cyan", iconBg: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400", prevValue: previousDate ? prevCounts.Anywhere : undefined },
    { label: "Pending", value: counts.Pending, icon: <AlertCircle size={16} />, accent: "stat-card-red", iconBg: "bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400", prevValue: previousDate ? prevCounts.Pending : undefined },
  ];

  const formattedDate = new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  return (
    <div>
      {/* Hero Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Today&apos;s Snapshot</h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{formattedDate}</p>
        </div>

        {/* KPI Rings */}
        <div className="flex items-center gap-6 card px-5 py-3.5">
          {/* Office Rate */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 relative flex-shrink-0">
              <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-gray-100 dark:text-slate-800" strokeWidth="2.5" />
                <circle cx="18" cy="18" r="14" fill="none"
                  stroke={officeRate >= 80 ? "#22c55e" : officeRate >= 60 ? "#f59e0b" : "#ef4444"}
                  strokeWidth="2.5" strokeDasharray={`${officeRate * 0.88} 100`}
                  strokeLinecap="round" className="transition-all duration-300" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {officeRate}%
              </span>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Office</div>
              <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {inOffice}<span style={{ color: "var(--text-muted)" }} className="font-normal">/{total}</span>
              </div>
            </div>
          </div>

          <div className="w-px h-9" style={{ background: "var(--border-default)" }} />

          {/* Response Rate */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 relative flex-shrink-0">
              <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-gray-100 dark:text-slate-800" strokeWidth="2.5" />
                <circle cx="18" cy="18" r="14" fill="none"
                  stroke={responseRate >= 80 ? "#6366f1" : responseRate >= 50 ? "#f59e0b" : "#ef4444"}
                  strokeWidth="2.5" strokeDasharray={`${responseRate * 0.88} 100`}
                  strokeLinecap="round" className="transition-all duration-300" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {responseRate}%
              </span>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Responded</div>
              <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {responded}<span style={{ color: "var(--text-muted)" }} className="font-normal">/{total}</span>
              </div>
            </div>
          </div>

          <div className="hidden sm:block w-px h-9" style={{ background: "var(--border-default)" }} />

          {/* Pending — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-3">
            <div className="w-11 h-11 relative flex-shrink-0">
              <svg className="w-11 h-11 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-gray-100 dark:text-slate-800" strokeWidth="2.5" />
                <circle cx="18" cy="18" r="14" fill="none"
                  stroke={pendingRate <= 20 ? "#22c55e" : pendingRate <= 50 ? "#f59e0b" : "#ef4444"}
                  strokeWidth="2.5" strokeDasharray={`${pendingRate * 0.88} 100`}
                  strokeLinecap="round" className="transition-all duration-300" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {pendingRate}%
              </span>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Pending</div>
              <div className="text-sm font-bold font-mono" style={{ color: "var(--text-primary)" }}>
                {pendingCount}<span style={{ color: "var(--text-muted)" }} className="font-normal">/{total}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-2.5">
        {cards.map((card) => {
          const diff = card.prevValue !== undefined ? card.value - card.prevValue : undefined;
          return (
            <div key={card.label} className={`stat-card ${card.accent} card-hover card p-3.5`}>
              <div className={`w-7 h-7 rounded-lg ${card.iconBg} flex items-center justify-center mb-2.5`}>
                {card.icon}
              </div>
              <div className="text-xl font-bold font-mono leading-none tracking-tight" style={{ color: "var(--text-primary)" }}>
                {card.value}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{card.label}</span>
                {diff !== undefined && diff !== 0 && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-semibold font-mono ${diff > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                    {diff > 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                    {diff > 0 ? "+" : ""}{diff}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

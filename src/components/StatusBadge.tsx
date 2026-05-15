"use client";

import { Building2, Home, MapPin, ArrowLeftRight, Plane, TreePalm, Globe, AlertCircle, Minus } from "lucide-react";

const STATUS_CONFIG: Record<string, { bg: string; icon: React.ReactNode }> = {
  "Office": {
    bg: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400",
    icon: <Building2 size={11} />,
  },
  "Home": {
    bg: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
    icon: <Home size={11} />,
  },
  "Client Location": {
    bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
    icon: <MapPin size={11} />,
  },
  "Split Day": {
    bg: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-400",
    icon: <ArrowLeftRight size={11} />,
  },
  "Travel": {
    bg: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-400",
    icon: <Plane size={11} />,
  },
  "Leave": {
    bg: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400",
    icon: <TreePalm size={11} />,
  },
  "Anywhere": {
    bg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-400",
    icon: <Globe size={11} />,
  },
  "Pending": {
    bg: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
    icon: <AlertCircle size={11} />,
  },
};

const DEFAULT_CONFIG = {
  bg: "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400",
  icon: <Minus size={11} />,
};

export default function StatusBadge({ status, size = "sm" }: { status: string; size?: "sm" | "xs" }) {
  const config = STATUS_CONFIG[status] || DEFAULT_CONFIG;
  const displayText = status === "Client Location" ? "Client" : status;

  return (
    <span className={`inline-flex items-center gap-1 font-medium ${config.bg} ${
      size === "xs" ? "px-1.5 py-0.5 text-[10px] rounded-md" : "px-2.5 py-1 text-xs rounded-lg"
    }`}>
      {config.icon}
      {displayText}
    </span>
  );
}

"use client";

import { LayoutDashboard, User } from "lucide-react";

/**
 * Admins are people too: they answer for themselves like anybody else. This is
 * the switch between the whole-company dashboard and their own attendance,
 * shown only to admins, in the header of both screens so it is always one
 * click back.
 */
export default function ViewSwitch({ view, onChange }: {
  view: "team" | "me";
  onChange: (v: "team" | "me") => void;
}) {
  const items = [
    { id: "team" as const, label: "Team", Icon: LayoutDashboard },
    { id: "me" as const, label: "My attendance", Icon: User },
  ];
  return (
    <div className="inline-flex rounded-lg p-0.5" role="group" aria-label="Choose view" style={{ background: "var(--bg-inset)" }}>
      {items.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => onChange(id)} aria-pressed={view === id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors"
          style={view === id
            ? { background: "var(--bg-surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-xs)" }
            : { color: "var(--text-secondary)" }}>
          <Icon size={13} /> <span className={id === "me" ? "hidden sm:inline" : ""}>{label}</span>
        </button>
      ))}
    </div>
  );
}

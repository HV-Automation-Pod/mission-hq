"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { LogOut, Shield, User, Loader2 } from "lucide-react";

/**
 * Who you are signed in as, and the way out.
 *
 * There was no way out. A `SignOut` component existed but nothing rendered it,
 * and it styled itself with `text-text-2` — a Tailwind colour mapped to a
 * `--text-2` variable this stylesheet does not define — so it had plainly
 * never been on screen.
 *
 * It also matters that this says WHO. The dashboard shows one person their own
 * row and another person all 376, and the difference is invisible: a member
 * seeing a single row cannot otherwise tell whether that is the whole company
 * or just them, and anybody on a shared machine has no way to check whose
 * session they are reading.
 */
export default function AccountMenu({ viewer, fullName }: {
  viewer: { email: string; role: string } | null;
  /**
   * Resolved by the caller from the data it already has, rather than fetched.
   * Falls back to the local part of the address for somebody who holds a
   * company account but is not in the employee feed.
   */
  fullName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!viewer) return null;

  const isAdmin = viewer.role === "admin";
  const name = fullName?.trim() || viewer.email.split("@")[0];
  const initials = name.split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  const signOut = async () => {
    setLeaving(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      await supabase.auth.signOut();
    } finally {
      // Navigate either way. A failed sign-out that leaves somebody sitting on
      // a dashboard they think they have left is the worse outcome, and the
      // middleware will send them back to /login if the cookie survived.
      location.href = "/login";
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${viewer.email}`}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg transition-all active:scale-95 hover:bg-[var(--bg-surface-hover)]"
      >
        <span className="avatar w-7 h-7 text-[10px]"
          style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
          {initials}
        </span>
        <span className="hidden lg:inline text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {name}
        </span>
      </button>

      {open && (
        <div role="menu"
          className="absolute right-0 mt-2 w-60 rounded-xl border overflow-hidden z-50 animate-fade-in"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", boxShadow: "var(--shadow-lg)" }}>
          <div className="px-3.5 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="text-[13px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>{name}</div>
            <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{viewer.email}</div>
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold"
              style={isAdmin
                ? { background: "var(--accent-light)", color: "var(--accent)" }
                : { background: "var(--bg-inset)", color: "var(--text-muted)" }}>
              {isAdmin ? <Shield size={10} /> : <User size={10} />}
              {isAdmin ? "Admin, sees everyone" : "Your own record only"}
            </div>
          </div>

          <button role="menuitem" onClick={signOut} disabled={leaving}
            className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
            style={{ color: "var(--text-secondary)" }}>
            {leaving ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

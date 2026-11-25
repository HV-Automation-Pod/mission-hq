"use client";

import { motion, useReducedMotion } from "framer-motion";
import { C, focusRing } from "./theme";
import { rise } from "./motion";
import { initialsOf } from "@/lib/format";

/** The surfaces and small controls every screen is made from. */

export function Card({ children, className = "", style, tone = "default", ...rest }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties; tone?: "default" | "tint" | "warn";
} & React.HTMLAttributes<HTMLElement>) {
  const bg = tone === "tint" ? C.selected : tone === "warn" ? C.warnSoft : C.surface;
  return (
    <section {...rest} className={`rounded-2xl p-5 sm:p-6 ${className}`}
      style={{ background: bg, border: `1px solid ${tone === "warn" ? "#EBD9A8" : C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)", ...style }}>
      {children}
    </section>
  );
}

/** A Card that rises in with its siblings when it is a direct child of <Stagger>. It is the grid item itself, so column spans still work. */
export function RiseCard({ children, className = "", style, tone = "default" }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties; tone?: "default" | "tint" | "warn";
}) {
  const reduce = useReducedMotion();
  const bg = tone === "tint" ? C.selected : tone === "warn" ? C.warnSoft : C.surface;
  return (
    <motion.section variants={reduce ? undefined : rise} className={`rounded-2xl p-5 sm:p-6 ${className}`}
      style={{ background: bg, border: `1px solid ${tone === "warn" ? "#EBD9A8" : C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)", ...style }}>
      {children}
    </motion.section>
  );
}

/** A card that lifts a little under the pointer, for the ones that lead somewhere. */
export function LiftCard({ children, className = "", style, ...rest }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
} & Omit<React.ComponentProps<typeof motion.button>, "children" | "style" | "className">) {
  const reduce = useReducedMotion();
  return (
    <motion.button {...rest} className={`text-left rounded-2xl w-full h-full ${focusRing} ${className}`}
      style={{ background: C.surface, border: `1px solid ${C.border}`, boxShadow: "var(--shadow-xs), var(--shadow-sm)", ...style }}
      whileHover={reduce ? undefined : { y: -3, boxShadow: "0 8px 22px rgb(23 43 44 / 9%)" }} whileTap={reduce ? undefined : { scale: 0.995 }}>
      {children}
    </motion.button>
  );
}

export function Pill({ children, color, bg, className = "" }: { children: React.ReactNode; color: string; bg: string; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full ${className}`} style={{ color, background: bg }}>{children}</span>;
}

export const btnPrimary: React.CSSProperties = { background: C.primary, color: "#fff", borderRadius: 10, minHeight: 44 };
export const btnOutline: React.CSSProperties = { background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 10, minHeight: 44 };
export const btnDanger: React.CSSProperties = { background: C.bad, color: "#fff", borderRadius: 10, minHeight: 44 };

export function Button({ children, variant = "primary", loading = false, className = "", style, disabled, ...rest }: {
  variant?: "primary" | "outline" | "danger" | "ghost"; loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = variant === "primary" ? btnPrimary : variant === "danger" ? btnDanger
    : variant === "outline" ? btnOutline : { color: C.text2, borderRadius: 10, minHeight: 44 };
  return (
    <button {...rest} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 px-5 text-[14px] font-semibold transition-[opacity,background-color,transform] active:scale-[0.98] hover:opacity-90 disabled:opacity-50 disabled:active:scale-100 ${variant === "ghost" ? "hover:bg-[#EEF3F1]" : ""} ${focusRing} ${className}`}
      style={{ ...base, ...style }}>
      {loading && <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ children, onClick, color = C.primary }: { children: React.ReactNode; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} className={`group inline-flex items-center gap-1.5 text-[13px] font-medium rounded ${focusRing}`} style={{ color }}>
      {children}
    </button>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: size, height: size, background: C.selected, color: C.primary, fontSize: Math.round(size * 0.32) }} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

/** `cap` segments, `used` of them filled. */
export function Segments({ cap, used, color = C.home }: { cap: number; used: number; color?: string }) {
  const reduce = useReducedMotion();
  const n = Math.max(1, Math.round(cap));
  return (
    <div className="flex gap-1.5" role="img" aria-label={`${used} of ${cap} used`}>
      {Array.from({ length: n }, (_, i) => (
        <motion.span key={i} className="h-2 flex-1 rounded-full"
          style={{ background: i < Math.floor(used + 0.001) ? color : i < used ? `${color}88` : C.inset }}
          initial={reduce ? false : { scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.15 + i * 0.025 }} />
      ))}
    </div>
  );
}

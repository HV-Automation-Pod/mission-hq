"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform, type Variants } from "framer-motion";
import { C, EASE } from "./theme";

/**
 * Motion is a courtesy, never a dependency. Every animation here lands on its
 * final state straight away when the person has asked for reduced motion, and
 * nothing waits on an animation before it is usable.
 */

/** A page's entrance: the whole page rises a little and fades in. */
export const pageMotion: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: "easeIn" } },
};

const stagger: Variants = { initial: {}, animate: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } } };
export const rise: Variants = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } } };

/** Children enter one after another. Wrap each child in <Item>. */
export function Stagger({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} style={style} variants={reduce ? undefined : stagger} initial="initial" animate="animate">{children}</motion.div>;
}

export function Item({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const reduce = useReducedMotion();
  return <motion.div className={className} style={style} variants={reduce ? undefined : rise}>{children}</motion.div>;
}

/** A number that counts up to its value, and counts between values when it changes. */
export function CountUp({ value, format: fmt = (n: number) => String(Math.round(n)), className, style }: {
  value: number; format?: (n: number) => string; className?: string; style?: React.CSSProperties;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (n) => fmt(n));
  useEffect(() => {
    if (reduce) { mv.set(value); return; }
    const controls = animate(mv, value, { duration: 0.8, ease: EASE });
    return () => controls.stop();
    // `fmt` is a fresh closure every render and must not restart the count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce, mv]);
  return <motion.span className={className} style={style}>{text}</motion.span>;
}

/** A bar that grows to its width when it scrolls into view. */
export function GrowBar({ pct, color = C.primary, track = C.inset, height = 8, delay = 0 }: {
  pct: number; color?: string; track?: string; height?: number; delay?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const width = `${Math.max(0, Math.min(100, pct))}%`;
  return (
    <div ref={ref} className="rounded-full overflow-hidden" style={{ background: track, height }} role="presentation">
      <motion.div className="h-full rounded-full" style={{ background: color }}
        initial={reduce ? { width } : { width: 0 }} animate={{ width: reduce || seen ? width : 0 }}
        transition={{ duration: 0.7, ease: EASE, delay }} />
    </div>
  );
}

/** A ring that draws itself to `pct`. */
export function GrowRing({ pct, size = 140, stroke = 11, color = C.primary, track = C.inset, children }: {
  pct: number; size?: number; stroke?: number; color?: string; track?: string; children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const r = 54, c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90" aria-hidden>
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth={stroke} stroke={track} />
        <motion.circle cx="64" cy="64" r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke={color} strokeDasharray={c}
          initial={reduce ? { strokeDashoffset: offset } : { strokeDashoffset: c }} animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.1 }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { C, EASE, focusRing } from "./theme";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog that behaves like one: it enters with a short rise, takes focus,
 * keeps Tab inside itself, closes on Escape or a click outside, and hands focus
 * back to whatever opened it. Put it inside <AnimatePresence> for the exit.
 */
export function Modal({ children, onClose, width = 640, label }: { children: React.ReactNode; onClose: () => void; width?: number; label: string }) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => opener.current?.focus?.();
  }, []);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !panel.current) return;
    const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const firstEl = nodes[0], lastEl = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  }, [onClose]);

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(23,43,44,0.45)", backdropFilter: "blur(3px)" }} onClick={onClose} onKeyDown={onKey}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="w-full max-h-[92dvh] overflow-y-auto p-6 sm:p-8 rounded-t-2xl sm:rounded-2xl outline-none"
        style={{ background: C.surface, boxShadow: "var(--shadow-lg)", maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.26, ease: EASE }}>
        {children}
      </motion.div>
    </motion.div>
  );
}

export function ModalHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <div className="text-[11px] tracking-[0.14em] font-semibold" style={{ color: C.primary }}>{eyebrow}</div>
        <h2 className="text-[28px] font-semibold tracking-tight mt-3 leading-tight">{title}</h2>
      </div>
      <button onClick={onClose} aria-label="Close" className={`p-2 -mr-2 rounded-lg hover:bg-[#EEF3F1] ${focusRing}`} style={{ color: C.muted }}><X size={20} /></button>
    </div>
  );
}

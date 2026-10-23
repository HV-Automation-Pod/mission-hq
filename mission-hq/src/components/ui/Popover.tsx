"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { C, EASE, FONT } from "./theme";

/**
 * A floating panel anchored to a trigger: the one thing the dropdown and the
 * calendar picker share.
 *
 * It renders in a portal on <body>, so a dialog's own scrolling or clipping can
 * never cut it off, and it positions itself against the trigger's rectangle,
 * opening upward when there is not room below. It follows the trigger while the
 * page or a dialog scrolls, and closes on an outside click.
 */
type Placement = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

function usePlacement(open: boolean, anchor: RefObject<HTMLElement | null>, minWidth?: number): Placement | null {
  const [p, setP] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!open) { setP(null); return; }
    const update = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const room = 12;
      const below = window.innerHeight - r.bottom - room;
      const above = r.top - room;
      const up = below < 280 && above > below;
      const width = Math.max(r.width, minWidth ?? 0);
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      setP(up
        ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(180, above) }
        : { left, width, top: r.bottom + 6, maxHeight: Math.max(180, below) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, anchor, minWidth]);

  return p;
}

export function Popover({ open, anchor, onClose, children, minWidth, label, className = "" }: {
  open: boolean; anchor: RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode;
  minWidth?: number; label: string; className?: string;
}) {
  const reduce = useReducedMotion();
  const place = usePlacement(open, anchor, minWidth);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  // A press anywhere outside both the trigger and the panel closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor.current?.contains(t) || panel?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, anchor, panel, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && place && (
        <motion.div ref={setPanel} role="dialog" aria-label={label}
          className={`fixed z-[80] rounded-xl overflow-hidden flex flex-col ${className}`}
          style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight,
            background: C.surface, border: `1px solid ${C.border}`, boxShadow: "0 12px 32px rgb(23 43 44 / 14%)", fontFamily: FONT, color: C.text,
            transformOrigin: place.top !== undefined ? "top" : "bottom" }}
          initial={reduce ? false : { opacity: 0, y: place.top !== undefined ? -6 : 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.16, ease: EASE }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

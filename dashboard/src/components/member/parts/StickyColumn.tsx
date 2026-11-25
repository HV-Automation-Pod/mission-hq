"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A column that sticks while a taller neighbour scrolls past it.
 *
 * A column taller than the screen cannot simply be `top: 24px`: its bottom
 * would stay below the fold until the very end of the page. So `top` is
 * negative by exactly the overhang, and the column pins when ITS BOTTOM reaches
 * the bottom of the screen. That is the whole trick, and it needs the column's
 * real height, which changes (dialogs, week/month view), hence the observer.
 */
export function StickyColumn({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(24);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTop(Math.min(24, window.innerHeight - el.offsetHeight - 24));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  return <div ref={ref} className={`lg:sticky ${className}`} style={{ top }}>{children}</div>;
}

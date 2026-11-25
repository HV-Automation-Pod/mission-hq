"use client";

import { C } from "./theme";

/**
 * The tooltip, everywhere. Our own, because the browser's `title=` waits a
 * second or two, cannot be styled, ignores the design, and never appears on a
 * touch screen. Several of the explanations in this app are the only place a
 * rule is written down, so they have to actually show up.
 *
 * Lives in `group`/`group-hover` rather than React state so that hovering a row
 * of them costs no re-renders. It also shows on keyboard focus.
 */
export function Tooltip({
  label, shortcut, side = "top", width, className, style, children,
}: {
  label: React.ReactNode;
  shortcut?: string;
  /** Flip it below the target when the target sits near the top of a scroll
   *  container, where a tooltip above would be clipped by the overflow. */
  side?: "top" | "bottom";
  /** Give a sentence-length explanation a width so it wraps instead of
   *  stretching off the side of the screen. */
  width?: number;
  /** Classes for the WRAPPER, for when the tooltip has to behave as a grid or
   *  flex child, such as `w-full` so a calendar cell still fills its track. */
  className?: string;
  /** Inline style for the WRAPPER: a proportional bar segment sets its flex-grow here. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const below = side === "bottom";
  return (
    <span className={`group relative inline-flex ${className ?? ""}`} style={style}>
      {children}
      <span role="tooltip"
        className={`pointer-events-none opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100 absolute left-1/2 -translate-x-1/2 z-[90] transition-[opacity,transform] duration-150 delay-100 ${below ? "top-full mt-2" : "bottom-full mb-2"}`}>
        <span className={`flex items-center gap-2 rounded-lg px-2.5 py-2 relative ${width ? "" : "whitespace-nowrap"}`}
          style={{ background: C.text, color: "#F7F8F5", boxShadow: "0 8px 24px rgba(23,43,44,0.25)", width: width ? `${width}px` : undefined }}>
          <span className="text-[11px] font-medium leading-snug text-left">{label}</span>
          {shortcut && (
            <kbd className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded leading-none flex-shrink-0" style={{ background: "#2A4243", color: "#CFE0DC", border: "1px solid #3A5758" }}>{shortcut}</kbd>
          )}
          <span className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${below ? "bottom-full" : "top-full"}`}
            style={{ background: C.text, [below ? "marginBottom" : "marginTop"]: "-4px" }} />
        </span>
      </span>
    </span>
  );
}

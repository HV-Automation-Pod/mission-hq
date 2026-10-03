"use client";

/**
 * The tooltip, everywhere.
 *
 * The browser's own `title=` is not a substitute: it waits a second or two
 * before appearing, it cannot be styled, it ignores the theme, and on a touch
 * screen it never appears at all. Several of the explanations in this app are
 * the only place a rule is written down — why a button is disabled, what a
 * number is counting — so they have to actually show up.
 *
 * Lives in `group`/`group-hover` rather than React state so that hovering a
 * row of them costs no re-renders.
 */
export default function Tooltip({
  label, shortcut, side = "top", width, className, children,
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
   *  flex child — `w-full` so a heatmap cell still fills its track. */
  className?: string;
  children: React.ReactNode;
}) {
  const below = side === "bottom";
  return (
    <span className={`group relative inline-flex ${className ?? ""}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 absolute left-1/2 -translate-x-1/2 z-50 transition-opacity duration-150 ${
          below ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        <span
          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 relative ${width ? "" : "whitespace-nowrap"}`}
          style={{
            background: "#0f172a",
            color: "#f1f5f9",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            width: width ? `${width}px` : undefined,
          }}
        >
          <span className="text-[11px] font-medium leading-snug text-left">{label}</span>
          {shortcut && (
            <kbd
              className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded leading-none flex-shrink-0"
              style={{ background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155" }}
            >
              {shortcut}
            </kbd>
          )}
          <span
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${below ? "bottom-full" : "top-full"}`}
            style={{ background: "#0f172a", [below ? "marginBottom" : "marginTop"]: "-4px" }}
          />
        </span>
      </span>
    </span>
  );
}

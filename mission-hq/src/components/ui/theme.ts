/**
 * Petrol & Oat: the palette.
 *
 * ONE PALETTE, TWO WAYS TO USE IT. The colours are exported as `C` for inline
 * styles. The same values are also written over the app's CSS variables by
 * `PETROL_VARS`, on the root of each view, so any existing class inside that
 * subtree (`.card`, `var(--bg-surface)`) takes the design's colours without
 * being rewritten and nothing outside the subtree changes.
 */
export const C = {
  canvas: "#F7F8F5", surface: "#FFFFFF", text: "#172B2C", text2: "#536467", muted: "#65767A",
  border: "#DDE5E2", primary: "#125B60", brand: "#16727A", selected: "#E9F3F1", inset: "#F0F3F0",
  accent: "#DCE6BA", office: "#18734B", officeSoft: "#EAF6EE", home: "#4338CA", homeSoft: "#EEF2FF",
  warn: "#995510", warnSoft: "#FFFAEB", bad: "#B42318", badSoft: "#FEF3F2", leave: "#5F6B6E", leaveSoft: "#EEF1F0",
} as const;

export const PETROL_VARS = {
  "--bg-app": C.canvas, "--bg-surface": C.surface, "--bg-surface-secondary": C.inset,
  "--bg-surface-hover": "#EEF3F1", "--bg-inset": C.inset,
  "--border-default": C.border, "--border-subtle": "#E7EDEA", "--border-strong": "#C3D0CC",
  "--text-primary": C.text, "--text-secondary": C.text2, "--text-muted": C.muted, "--text-faint": "#9AA9AC",
  "--accent": C.primary, "--accent-hover": "#0E4A4E", "--accent-light": C.selected, "--accent-muted": "#BFDAD5",
  "--shadow-xs": "0 1px 2px 0 rgb(0 0 0 / 4%)", "--shadow-sm": "0 2px 4px 0 rgb(0 0 0 / 2%)",
  "--shadow-lg": "0 12px 32px rgb(23 43 44 / 14%)", "--shadow-glow": "0 0 0 3px rgb(18 91 96 / 18%)",
  "--radius-lg": "16px",
  fontFamily: 'var(--font-geist), -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  letterSpacing: "0",
  background: C.canvas, color: C.text,
} as React.CSSProperties;

/** The font stack on its own, for UI that renders outside the styled root (a portal). */
export const FONT = PETROL_VARS.fontFamily as string;

/** The ease every motion in the app uses: quick out, soft in. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export function pctColor(pct: number | null): string {
  if (pct === null) return C.muted;
  // The report's own cut-offs (migration 50): 80+ is "just short" or better, 60-79
  // "some way short", under 60 "needs attention". Colours follow the same lines.
  return pct >= 80 ? C.office : pct >= 60 ? C.warn : C.bad;
}

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125B60]";

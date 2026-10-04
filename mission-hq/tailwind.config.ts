import type { Config } from "tailwindcss";

/**
 * Every colour is a CSS variable, so the theme switches without a class on
 * every element and a new palette is one file to edit.
 */
export default {
  /*
   * The toggle writes `class="dark"` onto <html>, so the `dark:` utilities
   * must read that class. Tailwind 3 defaults this to "media", which reads
   * `prefers-color-scheme` instead — two different sources of truth for one
   * theme.
   *
   * The result was a page that could be light and dark at once: the CSS
   * variables followed the toggle, so cards and the page went white, while
   * every `dark:` utility followed the operating system and stayed dark. On a
   * machine set to dark, picking the light theme produced white cards holding
   * dark status badges, a muddy amber alert banner, and near-black blocks
   * where an empty day should have been a pale dash.
   */
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      /*
       * These aliases point at the variables `globals.css` ACTUALLY defines.
       *
       * They used to name a parallel set — `--surface`, `--text-2`, `--office`,
       * `--radius`, `--shadow` — that no longer exists anywhere, so every
       * utility built on them resolved to an invalid value. The login page is
       * built almost entirely from them, which made it the one screen where it
       * showed: it is the first thing every person sees and the only one that
       * renders before anybody is authenticated.
       *
       * Kept as aliases rather than deleted, because the short names read well
       * at the call site. They just have to resolve.
       */
      colors: {
        bg: "var(--bg-app)",
        surface: "var(--bg-surface)",
        "surface-2": "var(--bg-surface-secondary)",
        inset: "var(--bg-inset)",
        border: "var(--border-default)",
        "border-soft": "var(--border-subtle)",
        text: "var(--text-primary)",
        "text-2": "var(--text-secondary)",
        "text-3": "var(--text-muted)",
        "text-faint": "var(--text-faint)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-soft": "var(--accent-light)",
        // Text ON the accent fill. White in both themes, because the accent is
        // dark enough in each for white to clear AA: 6.3:1 light, 6.1:1 dark.
        "accent-text": "#ffffff",
      },
      /*
       * `font-sans` is on <body> in layout.tsx. Without this it resolved to
       * Tailwind's default stack and OVERRODE the `body { font-family }` rule
       * in globals.css, because a class beats an element selector — so Poppins
       * was loaded on every page and applied on none of them.
       */
      fontFamily: {
        sans: ["var(--font-poppins)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        DEFAULT: "var(--radius-md)",
        card: "var(--radius-lg)",
      },
      boxShadow: {
        card: "var(--shadow-sm)",
        "card-lg": "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
} satisfies Config;

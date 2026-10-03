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
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        "border-soft": "var(--border-soft)",
        text: "var(--text)",
        "text-2": "var(--text-2)",
        "text-3": "var(--text-3)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        "accent-text": "var(--accent-text)",
        office: "var(--office)", "office-soft": "var(--office-soft)",
        home: "var(--home)", "home-soft": "var(--home-soft)",
        leave: "var(--leave)", "leave-soft": "var(--leave-soft)",
        pending: "var(--pending)", "pending-soft": "var(--pending-soft)",
        away: "var(--away)", "away-soft": "var(--away-soft)",
        danger: "var(--danger)", "danger-soft": "var(--danger-soft)",
      },
      borderRadius: { DEFAULT: "var(--radius)" },
      boxShadow: { card: "var(--shadow)" },
    },
  },
  plugins: [],
} satisfies Config;

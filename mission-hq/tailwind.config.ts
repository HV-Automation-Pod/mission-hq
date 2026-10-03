import type { Config } from "tailwindcss";

/**
 * Every colour is a CSS variable, so the theme switches without a class on
 * every element and a new palette is one file to edit.
 */
export default {
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

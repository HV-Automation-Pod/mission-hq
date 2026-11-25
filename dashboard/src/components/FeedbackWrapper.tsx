"use client";

import { FeedbackProvider, type FeedbackData } from "react-visual-feedback";
import { useTheme } from "@/lib/theme";

export function FeedbackWrapper({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <FeedbackProvider
      mode={theme === "dark" ? "dark" : "light"}
      onSubmit={async (data: FeedbackData) => {
        try {
          const res = await fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...data,
              pageUrl:
                typeof window !== "undefined" ? window.location.href : null,
            }),
          });
          if (!res.ok) {
            console.error(
              "[feedback] save failed:",
              res.status,
              await res.text(),
            );
          }
        } catch (err) {
          console.error("[feedback] save error:", err);
        }
      }}
    >
      {children}
    </FeedbackProvider>
  );
}

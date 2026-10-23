"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * The only client-side Supabase use in the app, and it holds nothing but the
 * anon key, which is public by design. Every read of attendance happens on the
 * server with the service role.
 */
export function SignIn({ next, variant }: { next?: string; variant: "primary" | "switch" }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next || "/")}`,
        // Narrows the Google account chooser to the company, which is a
        // convenience and NOT a security control: the real check is the
        // allowlist on the server.
        queryParams: { hd: "hyperverge.co", prompt: "select_account" },
      },
    });
  }

  const primary = variant === "primary";
  return (
    <button
      onClick={go}
      disabled={busy}
      className={`w-full h-11 rounded-xl text-[14px] font-semibold transition-all active:scale-[0.98] disabled:opacity-60 ${primary ? "text-white hover:brightness-110" : "mt-5 border hover:bg-[var(--bg-surface-hover)]"}`}
      style={primary
        ? { background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 6px 18px rgba(99, 102, 241, 0.35)" }
        : { borderColor: "var(--border-default)", color: "var(--text-primary)" }}
    >
      {busy ? "Opening Google..." : primary ? "Continue with Google" : "Sign in with a different account"}
    </button>
  );
}

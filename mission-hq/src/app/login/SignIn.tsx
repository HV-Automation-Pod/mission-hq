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

  return (
    <button
      onClick={go}
      disabled={busy}
      className={
        variant === "primary"
          ? "w-full h-10 rounded-[8px] bg-accent text-accent-text text-sm font-medium hover:opacity-90 disabled:opacity-60 transition"
          : "w-full h-10 rounded-[8px] border border-border text-sm font-medium mt-4 hover:bg-surface-2 disabled:opacity-60 transition"
      }
    >
      {busy ? "Opening Google…" : variant === "primary" ? "Continue with Google" : "Sign in with a different account"}
    </button>
  );
}

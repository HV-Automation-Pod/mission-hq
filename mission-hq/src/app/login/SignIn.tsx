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
      className="w-full max-w-[400px] h-14 rounded-[10px] flex items-center justify-center gap-3 text-[15px] font-semibold transition-colors hover:bg-[#F3F8F6] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#125B60]"
      style={{ background: "#FFFFFF", color: "#172B2C", border: "1px solid #125B60" }}
    >
      {/* Google's four-colour G, as the sign-in button convention expects. */}
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      {busy ? "Opening Google..." : variant === "primary" ? "Continue with Google" : "Sign in with a different account"}
    </button>
  );
}

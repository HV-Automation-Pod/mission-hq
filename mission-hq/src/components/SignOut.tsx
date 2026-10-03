"use client";

import { createBrowserClient } from "@supabase/ssr";

export function SignOut() {
  return (
    <button
      onClick={async () => {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        await supabase.auth.signOut();
        location.href = "/login";
      }}
      className="text-text-2 hover:text-text text-sm transition"
    >
      Sign out
    </button>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/server/session";

/**
 * Exchanges the OAuth code for a session cookie.
 *
 * `next` is validated rather than trusted: it arrives in a URL anybody can
 * craft, and forwarding it unchecked turns the sign-in flow into an open
 * redirect. Only same-site paths are honoured.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  let raw = "/";
  try {
    raw = decodeURIComponent(request.cookies.get("hq_next")?.value ?? "/") || "/";
  } catch {}
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  const done = (url: string) => {
    const res = NextResponse.redirect(url);
    res.cookies.set("hq_next", "", { path: "/auth/callback", maxAge: 0 });
    return res;
  };

  if (!code) return done(`${origin}/login`);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return done(`${origin}/login?error=${encodeURIComponent(error.message)}`);

  return done(`${origin}${next}`);
}

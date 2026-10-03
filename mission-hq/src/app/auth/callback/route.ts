import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/session";

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
  const raw = searchParams.get("next") || "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  if (!code) return NextResponse.redirect(`${origin}/login`);

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);

  return NextResponse.redirect(`${origin}${next}`);
}

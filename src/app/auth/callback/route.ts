import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Where email confirmation and PKCE links land (§D.9).
 *
 * A Route Handler rather than a Server Function because this is a GET from
 * outside the app: the browser follows a link in an email, and the handler
 * exchanges what the link carries for a session cookie.
 *
 * Supabase email templates send one of two shapes depending on the project's
 * template and flow, so both are handled:
 *   - `?code=...`                 → exchangeCodeForSession (PKCE)
 *   - `?token_hash=...&type=...`  → verifyOtp (the newer confirmation link)
 * §D.9 splits these across /auth/callback and /auth/confirm; folding them into
 * one handler means sign-up works whichever template the project has.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error
      ? failed(origin, error.message)
      : NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    return error
      ? failed(origin, error.message)
      : NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
  }

  return failed(origin, "That confirmation link is missing its token.");
}

/**
 * `next` comes from a URL, so it is untrusted input. Only same-site absolute
 * paths are allowed: without this check, `?next=https://evil.example` turns a
 * confirmation link into an open redirect that lands a freshly signed-in user
 * on someone else's page.
 */
function safeNext(next: string | null) {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

function failed(origin: string, message: string) {
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(message)}`,
  );
}

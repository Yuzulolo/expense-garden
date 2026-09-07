import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refreshes the Supabase auth cookie and decides where a request may go.
 *
 * This is UX, not a security boundary (§C). It exists so sessions don't expire
 * mid-form and so signed-out visitors see a login form instead of an error.
 * The real boundary is RLS in Postgres, backed by requireUser() in the
 * protected layout and in every Server Function.
 *
 * Next's own proxy docs make the same point: Server Functions are POSTs to the
 * route they live on, so a matcher change can silently remove proxy coverage —
 * "always verify authentication and authorization inside each Server Function
 * rather than relying on Proxy alone."
 */
export async function updateSession(request: NextRequest) {
  // The response the cookie writes land on, and the object we return.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Make the refreshed token visible to the route being rendered...
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          // ...and write it back to the browser on the response we return.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // @supabase/ssr >= 0.12 hands us the no-store cache headers that stop
          // a CDN caching one user's Set-Cookie and serving it to another.
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Must happen before the response is committed. A refresh that completes
  // after the response is sent cannot write its cookie and is lost, which is
  // what causes random logouts (§D.9).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    // API routes must answer with a status code, never a redirect: fetch()
    // follows a 307 transparently and hands the caller a /login HTML page with
    // status 200, which then fails to parse as JSON. Each route handler does
    // its own auth check and returns 401 itself.
    if (pathname.startsWith("/api/")) return response;
    return redirectPreservingCookies(request, response, "/login");
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return redirectPreservingCookies(request, response, "/dashboard");
  }

  return response;
}

/**
 * A fresh NextResponse.redirect() would drop the Set-Cookie headers the
 * refresh just wrote, so copy them across rather than losing the new token.
 */
function redirectPreservingCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

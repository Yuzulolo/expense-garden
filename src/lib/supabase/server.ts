import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Functions and Route Handlers.
 *
 * Same anon key as the browser client — the user's JWT arrives in the request
 * cookie, so queries run as that user and RLS still applies. There is no
 * elevated "admin client" in this project, by design (§D.4).
 *
 * A new client per request: never share one across requests (the cache headers
 * that keep auth responses out of a CDN are only emitted on a client's first
 * cookie write).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot write cookies — `cookies()` is read-only
            // outside Server Functions and Route Handlers. Safe to ignore here
            // because proxy.ts refreshes the session on every navigation and
            // writes the new cookie itself.
          }
        },
      },
    },
  );
}

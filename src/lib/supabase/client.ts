import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 *
 * Uses the publishable anon key, which is designed to be public and ships in
 * the browser bundle. Every request it makes is still subject to RLS — as
 * `anon` when signed out, as `authenticated` once a session cookie rides
 * along. The service_role key must never appear in this project (§B.7).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

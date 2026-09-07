import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * The app-level auth gate. Call it in every protected layout and at the top of
 * every Server Function that touches user data.
 *
 * getUser(), never getSession(): getSession() decodes the cookie without
 * contacting the auth server, so a forged or stale cookie can produce a
 * session-shaped object. getUser() validates the JWT (§D.9).
 */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/login");
  return user;
}

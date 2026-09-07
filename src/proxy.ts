import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`; the
 * functionality is unchanged. §C of docs/ARCHITECTURE.md calls this file
 * middleware.ts, which was written against Next 15.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Without a matcher, proxy runs on every request including static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

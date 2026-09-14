import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logOut } from "../(auth)/actions";
import { AppNav, SproutMark } from "./nav";

/**
 * The app-level gate for every page that shows data.
 *
 * This runs server-side on every request into the group and composes with
 * nested layouts, so it cannot be skipped by a proxy matcher typo — which is
 * why it exists in addition to proxy.ts (§C).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="app-nav sticky top-0 z-10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4 sm:px-10">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-sm text-[1.0625rem] text-ink"
          >
            <SproutMark />
            <span className="font-display font-semibold">Expense Garden</span>
          </Link>

          <AppNav />

          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden max-w-44 truncate text-xs text-ink-faint sm:block"
              title={user.email ?? undefined}
            >
              {user.email}
            </span>
            <form action={logOut}>
              <button
                type="submit"
                className="nav-button px-3 py-1.5 text-xs"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-10 sm:py-16">
        {children}
      </main>
    </div>
  );
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logOut } from "../(auth)/actions";

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
      <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <nav className="flex items-center gap-4">
          <Link href="/dashboard" className="font-semibold">
            Expense Garden
          </Link>
          <Link href="/expenses" className="text-sm underline">
            Expenses
          </Link>
          <Link href="/income" className="text-sm underline">
            Income
          </Link>
          <Link href="/chat" className="text-sm underline">
            Ask
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500">{user.email}</span>
          <form action={logOut}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

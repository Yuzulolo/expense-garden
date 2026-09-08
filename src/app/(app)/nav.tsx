"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Presentation only. Split out from the layout purely because the active route
 * has to be read on the client; the layout keeps requireUser() and the log-out
 * action on the server.
 */
const LINKS = [
  { href: "/dashboard", label: "Garden" },
  { href: "/expenses", label: "Expenses" },
  { href: "/income", label: "Income" },
  { href: "/chat", label: "Ask" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-baseline gap-1 sm:gap-2">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            /* The active route is marked by a rule under the word rather than a
               filled pill: it keeps the header quiet so the garden stays the
               loudest thing on the page. */
            className={`rounded-sm px-2 py-1 text-sm transition-colors ${
              active
                ? "text-ink shadow-[inset_0_-2px_0_0_var(--primary)]"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** A two-leaf sprout. The only ornament in the header. */
export function SproutMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M8 15V7"
        stroke="var(--vine)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8 8C8 8 4.6 8 3.4 5.6C5.9 4.4 8 6.2 8 8Z"
        fill="var(--vine)"
      />
      <path
        d="M8 7.2C8 7.2 8.4 3.6 11.4 2.8C11.8 5.6 9.8 7.2 8 7.2Z"
        fill="var(--vine-accent)"
      />
    </svg>
  );
}

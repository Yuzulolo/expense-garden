import Link from "next/link";
import { GardenVignette } from "../(app)/dashboard/garden";
import { SproutMark } from "../(app)/nav";

/**
 * The sign-in pages show the product rather than describing it: the panel on
 * the left draws the real six species at the real growth curve, so the first
 * thing a new person sees is the thing the app is for.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[1.15fr_1fr]">
      <section className="flex flex-col justify-between gap-8 overflow-hidden border-b border-rule bg-air px-6 pt-8 lg:border-b-0 lg:border-r lg:px-10 lg:pt-10">
        <div className="flex flex-col gap-5">
          <Link
            href="/login"
            className="flex items-center gap-2 self-start rounded-sm text-[1.0625rem]"
          >
            <SproutMark />
            <span className="font-display font-semibold text-ink">
              Expense Garden
            </span>
          </Link>

          <h2 className="font-display max-w-[22ch] text-[2rem] leading-[1.08] font-semibold text-ink lg:text-[2.75rem]">
            Say what you spent. Watch it grow.
          </h2>

          <p className="max-w-[46ch] text-sm leading-relaxed text-ink-soft">
            Type “spent 12 on coffee” and it lands in the right category, on the
            right date, without you sorting anything. Each category is a plant,
            and the more it takes this month, the taller it stands.
          </p>
        </div>

        {/* Bled to the panel edges: it is ground, and ground does not float. */}
        <div className="-mx-6 lg:-mx-10">
          <GardenVignette />
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-10 lg:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </div>
  );
}

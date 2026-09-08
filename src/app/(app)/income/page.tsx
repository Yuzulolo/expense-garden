import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/money";
import { createIncome, updateIncome, deleteIncome } from "./actions";
import { AddIncomeForm, IncomeRow, type Income } from "./income-forms";

export default async function IncomePage() {
  await requireUser();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("incomes")
    .select("id, source, amount_cents, description, occurred_on")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold">Income</h1>
        <p
          role="alert"
          className="border-l-2 border-danger pl-3 text-sm text-danger"
        >
          Could not load income: {error.message}
        </p>
        <p className="text-sm text-ink-soft">
          If this says a relation does not exist, the migrations have not been
          pushed yet.
        </p>
      </section>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []) as Income[];
  const total = rows.reduce((sum, i) => sum + i.amount_cents, 0);

  return (
    <section className="flex flex-col gap-7">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[2.125rem] leading-[1.1] font-semibold text-ink">
          Income
        </h1>
        <p className="max-w-[64ch] text-sm text-ink-soft">
          {rows.length === 0
            ? "Add what you earn and the Ask page can compare it against your spending."
            : `${rows.length} ${
                rows.length === 1 ? "entry" : "entries"
              }, totalling ${formatCents(total)} all time.`}
        </p>
      </header>

      <AddIncomeForm action={createIncome} today={today} />

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule px-4 py-6 text-sm text-ink-soft">
          Nothing recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col border-t border-rule">
          {rows.map((income) => (
            <IncomeRow
              key={income.id}
              income={income}
              updateAction={updateIncome}
              deleteAction={deleteIncome}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

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
        <h1 className="text-xl font-semibold">Income</h1>
        <p role="alert" className="text-red-700">
          Could not load income: {error.message}
        </p>
        <p className="text-sm text-zinc-500">
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
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Income</h1>

      <AddIncomeForm action={createIncome} today={today} />

      <p className="text-sm text-zinc-500">
        {rows.length} {rows.length === 1 ? "entry" : "entries"} · total{" "}
        {formatCents(total)}
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No income yet.</p>
      ) : (
        <ul className="flex flex-col">
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

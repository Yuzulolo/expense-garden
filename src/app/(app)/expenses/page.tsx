import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/money";
import { createExpense, updateExpense, deleteExpense } from "./actions";
import { logExpenseFromText } from "./ai-actions";
import { LogExpense } from "./log-expense";
import {
  AddExpenseForm,
  ExpenseRow,
  type Category,
  type Expense,
} from "./expense-forms";

export default async function ExpensesPage() {
  // Gated here as well as in the layout: every entry point that reads user data
  // does its own check rather than trusting an ancestor.
  await requireUser();

  const supabase = await createClient();

  // No `.eq('user_id', ...)` anywhere. RLS adds that predicate itself; writing
  // it here would suggest the filter is what protects the data. It isn't.
  const [{ data: expenses, error: expensesError }, { data: categories, error: categoriesError }] =
    await Promise.all([
      supabase
        .from("expenses")
        .select("id, category_slug, amount_cents, description, occurred_on")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("categories")
        .select("slug, label")
        .eq("is_active", true)
        .order("sort_order"),
    ]);

  const error = expensesError ?? categoriesError;
  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <p role="alert" className="text-red-700">
          Could not load expenses: {error.message}
        </p>
        <p className="text-sm text-zinc-500">
          If this says a relation does not exist, the migrations have not been
          pushed yet.
        </p>
      </section>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = (expenses ?? []) as Expense[];
  const cats = (categories ?? []) as Category[];
  const total = rows.reduce((sum, e) => sum + e.amount_cents, 0);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Expenses</h1>

      <LogExpense action={logExpenseFromText} />

      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm text-zinc-500">
          or enter manually
        </summary>
        <div className="pt-3">
          <AddExpenseForm
            categories={cats}
            action={createExpense}
            today={today}
          />
        </div>
      </details>

      <p className="text-sm text-zinc-500">
        {rows.length} {rows.length === 1 ? "entry" : "entries"} · total{" "}
        {formatCents(total)}
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No expenses yet.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              categories={cats}
              updateAction={updateExpense}
              deleteAction={deleteExpense}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

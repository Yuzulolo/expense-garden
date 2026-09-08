import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/money";
import { createExpense, updateExpense, deleteExpense } from "./actions";
import { logExpenseFromText } from "./ai-actions";
import { LogExpense } from "./log-expense";
import { PARSE_MODEL, formatModelSlug } from "@/lib/ai/models";
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
        <h1 className="font-display text-3xl font-semibold">Expenses</h1>
        <p
          role="alert"
          className="border-l-2 border-danger pl-3 text-sm text-danger"
        >
          Could not load expenses: {error.message}
        </p>
        <p className="text-sm text-ink-soft">
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
    <section className="flex flex-col gap-7">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[2.125rem] leading-[1.1] font-semibold text-ink">
          Expenses
        </h1>
        <p className="text-sm text-ink-soft">
          {rows.length === 0
            ? "Every expense you log will appear here, oldest at the bottom."
            : `${rows.length} ${
                rows.length === 1 ? "entry" : "entries"
              }, totalling ${formatCents(total)} all time.`}
        </p>
      </header>

      <LogExpense
        action={logExpenseFromText}
        modelLabel={formatModelSlug(PARSE_MODEL)}
        modelSlug={PARSE_MODEL}
      />

      <details className="group border-t border-rule pt-4">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm text-ink-soft transition-colors hover:text-ink">
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="h-2.5 w-2.5 transition-transform group-open:rotate-90"
          >
            <path d="M3 1L9 6L3 11Z" fill="currentColor" />
          </svg>
          Type it into a form instead
        </summary>
        <div className="pt-4">
          <AddExpenseForm
            categories={cats}
            action={createExpense}
            today={today}
          />
        </div>
      </details>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule px-4 py-6 text-sm text-ink-soft">
          Nothing logged yet. Say what you spent above — “spent 12 on coffee”
          is enough.
        </p>
      ) : (
        <ul className="flex flex-col border-t border-rule">
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

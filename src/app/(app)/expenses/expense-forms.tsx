"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";
import { centsToInput } from "@/lib/money";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export type Category = { slug: string; label: string };

export type Expense = {
  id: string;
  category_slug: string;
  amount_cents: number;
  description: string | null;
  occurred_on: string;
};

/* Fields sit quiet until focused: an editable row of six bordered boxes per
   expense turns a list into a wall of inputs. The controls are all still
   there, they just stop shouting. */
const input =
  "rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink hover:border-rule focus:border-water focus:bg-surface focus:outline-none focus-visible:outline-none";
const boxed =
  "rounded-md border border-rule bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-water focus:outline-none focus-visible:outline-none";
const quietButton =
  "rounded-md border border-rule px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-55";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <span role="alert" className="text-xs text-danger">
        {state.error}
      </span>
    );
  }
  if (state.message) {
    return <span className="text-xs text-ok">{state.message}</span>;
  }
  return null;
}

function CategorySelect({
  categories,
  defaultValue,
  boxed: isBoxed,
}: {
  categories: Category[];
  defaultValue?: string;
  boxed?: boolean;
}) {
  return (
    <select
      name="category_slug"
      defaultValue={defaultValue ?? ""}
      required
      aria-label="Category"
      className={isBoxed ? boxed : input}
    >
      <option value="" disabled>
        Category…
      </option>
      {categories.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function AddExpenseForm({
  categories,
  action,
  today,
}: {
  categories: Category[];
  action: Action;
  today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <CategorySelect categories={categories} boxed />
      <input
        name="amount"
        inputMode="decimal"
        placeholder="12.34"
        required
        aria-label="Amount"
        className={`${boxed} w-24 tnum`}
      />
      <input
        name="occurred_on"
        type="date"
        defaultValue={today}
        required
        aria-label="Date"
        className={boxed}
      />
      <input
        name="description"
        placeholder="Description (optional)"
        maxLength={280}
        aria-label="Description"
        className={`${boxed} min-w-44 flex-1`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-55"
      >
        {pending ? "Adding…" : "Add expense"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ExpenseRow({
  expense,
  categories,
  updateAction,
  deleteAction,
}: {
  expense: Expense;
  categories: Category[];
  updateAction: Action;
  deleteAction: Action;
}) {
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(
    updateAction,
    {},
  );
  const [delState, delAction, deleting] = useActionState<ActionState, FormData>(
    deleteAction,
    {},
  );

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule-soft py-1.5">
      {/* The id says which row to change. Ownership is not in this form at
          all — RLS decides whether the statement matches anything. */}
      <form
        action={saveAction}
        className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1"
        id={`edit-${expense.id}`}
      >
        <input type="hidden" name="id" value={expense.id} />
        <input
          name="occurred_on"
          type="date"
          defaultValue={expense.occurred_on}
          required
          aria-label="Date"
          className={`${input} tnum text-ink-soft`}
        />
        <CategorySelect
          categories={categories}
          defaultValue={expense.category_slug}
        />
        <input
          name="description"
          defaultValue={expense.description ?? ""}
          placeholder="No description"
          maxLength={280}
          aria-label="Description"
          className={`${input} min-w-40 flex-1`}
        />
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={centsToInput(expense.amount_cents)}
          required
          aria-label="Amount"
          className={`${input} tnum w-24 text-right font-medium`}
        />
        <button type="submit" disabled={saving} className={quietButton}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <form action={delAction}>
        <input type="hidden" name="id" value={expense.id} />
        <button
          type="submit"
          disabled={deleting}
          className="rounded-md border border-transparent px-2.5 py-1.5 text-xs text-ink-faint transition-colors hover:border-danger hover:text-danger disabled:opacity-55"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </form>

      <Feedback state={saveState} />
      <Feedback state={delState} />
    </li>
  );
}

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

const input = "border px-2 py-1";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <span role="alert" className="text-sm text-red-700">
        {state.error}
      </span>
    );
  }
  if (state.message) {
    return <span className="text-sm text-green-700">{state.message}</span>;
  }
  return null;
}

function CategorySelect({
  categories,
  defaultValue,
}: {
  categories: Category[];
  defaultValue?: string;
}) {
  return (
    <select
      name="category_slug"
      defaultValue={defaultValue ?? ""}
      required
      className={input}
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
      <CategorySelect categories={categories} />
      <input
        name="amount"
        inputMode="decimal"
        placeholder="12.34"
        required
        className={input}
      />
      <input
        name="occurred_on"
        type="date"
        defaultValue={today}
        required
        className={input}
      />
      <input
        name="description"
        placeholder="Description (optional)"
        maxLength={280}
        className={input}
      />
      <button type="submit" disabled={pending} className="border px-3 py-1">
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
    <li className="flex flex-wrap items-center gap-2 border-b py-2">
      {/* The id says which row to change. Ownership is not in this form at
          all — RLS decides whether the statement matches anything. */}
      <form
        action={saveAction}
        className="flex flex-wrap items-center gap-2"
        id={`edit-${expense.id}`}
      >
        <input type="hidden" name="id" value={expense.id} />
        <CategorySelect
          categories={categories}
          defaultValue={expense.category_slug}
        />
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={centsToInput(expense.amount_cents)}
          required
          className={input}
        />
        <input
          name="occurred_on"
          type="date"
          defaultValue={expense.occurred_on}
          required
          className={input}
        />
        <input
          name="description"
          defaultValue={expense.description ?? ""}
          placeholder="Description"
          maxLength={280}
          className={input}
        />
        <button type="submit" disabled={saving} className="border px-3 py-1">
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <form action={delAction}>
        <input type="hidden" name="id" value={expense.id} />
        <button type="submit" disabled={deleting} className="border px-3 py-1">
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </form>

      <Feedback state={saveState} />
      <Feedback state={delState} />
    </li>
  );
}

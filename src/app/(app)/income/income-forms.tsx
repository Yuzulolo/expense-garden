"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";
import { centsToInput } from "@/lib/money";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export type Income = {
  id: string;
  source: string;
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

export function AddIncomeForm({
  action,
  today,
}: {
  action: Action;
  today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="source"
        placeholder="Source (e.g. Salary)"
        required
        maxLength={80}
        className={input}
      />
      <input
        name="amount"
        inputMode="decimal"
        placeholder="1200.00"
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
        {pending ? "Adding…" : "Add income"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function IncomeRow({
  income,
  updateAction,
  deleteAction,
}: {
  income: Income;
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
      <form action={saveAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={income.id} />
        <input
          name="source"
          defaultValue={income.source}
          required
          maxLength={80}
          className={input}
        />
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={centsToInput(income.amount_cents)}
          required
          className={input}
        />
        <input
          name="occurred_on"
          type="date"
          defaultValue={income.occurred_on}
          required
          className={input}
        />
        <input
          name="description"
          defaultValue={income.description ?? ""}
          placeholder="Description"
          maxLength={280}
          className={input}
        />
        <button type="submit" disabled={saving} className="border px-3 py-1">
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <form action={delAction}>
        <input type="hidden" name="id" value={income.id} />
        <button type="submit" disabled={deleting} className="border px-3 py-1">
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </form>

      <Feedback state={saveState} />
      <Feedback state={delState} />
    </li>
  );
}

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

/* Same reasoning as the expense rows: fields stay quiet until focused so a
   list of entries reads as a list, not a wall of inputs. */
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
        aria-label="Source"
        className={boxed}
      />
      <input
        name="amount"
        inputMode="decimal"
        placeholder="1200.00"
        required
        aria-label="Amount"
        className={`${boxed} tnum w-28`}
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
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule-soft py-1.5">
      <form
        action={saveAction}
        className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1"
      >
        <input type="hidden" name="id" value={income.id} />
        <input
          name="occurred_on"
          type="date"
          defaultValue={income.occurred_on}
          required
          aria-label="Date"
          className={`${input} tnum text-ink-soft`}
        />
        <input
          name="source"
          defaultValue={income.source}
          required
          maxLength={80}
          aria-label="Source"
          className={`${input} font-medium`}
        />
        <input
          name="description"
          defaultValue={income.description ?? ""}
          placeholder="No description"
          maxLength={280}
          aria-label="Description"
          className={`${input} min-w-40 flex-1`}
        />
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={centsToInput(income.amount_cents)}
          required
          aria-label="Amount"
          className={`${input} tnum w-28 text-right font-medium`}
        />
        <button type="submit" disabled={saving} className={quietButton}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <form action={delAction}>
        <input type="hidden" name="id" value={income.id} />
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

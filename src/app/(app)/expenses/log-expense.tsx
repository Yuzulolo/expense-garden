"use client";

import { useActionState, useRef, useEffect } from "react";
import type { ActionState } from "./actions";

/**
 * The primary way to add an expense.
 *
 * This component holds no key and makes no model call — it posts a sentence to
 * the logExpenseFromText server action, which is passed in as a prop and
 * compiled to an action id, not to any of the action's code.
 */
export function LogExpense({
  action,
  modelLabel,
  modelSlug,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  modelLabel: string;
  modelSlug: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {},
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear the box only on success, so a rephrase after an error keeps the text.
  useEffect(() => {
    if (state.message && inputRef.current) inputRef.current.value = "";
  }, [state.message]);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-col gap-2">
        <label htmlFor="utterance" className="text-sm font-medium">
          Log an expense
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="utterance"
            ref={inputRef}
            name="utterance"
            placeholder="spent 12 on coffee with Sam"
            maxLength={500}
            autoComplete="off"
            required
            className="min-w-64 flex-1 border px-3 py-2"
          />
          <button
            type="submit"
            disabled={pending}
            className="border bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {pending ? "Reading…" : "Log it"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Plain English. Try “65 climbing pass yesterday” or “24.99 haircut”.
          <span title={modelSlug}> Read by {modelLabel}.</span>
        </p>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="text-sm text-green-700">{state.message}</p>
      ) : null}
    </div>
  );
}

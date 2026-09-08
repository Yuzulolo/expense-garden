"use client";

import { useActionState, useRef, useEffect } from "react";
import type { ActionState } from "./actions";

/**
 * The primary way to add an expense.
 *
 * This component holds no key and makes no model call — it posts a sentence to
 * the logExpenseFromText server action, which is passed in as a prop and
 * compiled to an action id, not to any of the action's code.
 *
 * Visually it is the app's water: the AI is what waters the garden, so the
 * water hue marks this input, the chat answers, and the watering animation,
 * and nothing else.
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
    <div className="flex flex-col gap-2.5">
      <form action={formAction} className="flex flex-col gap-2.5">
        <label
          htmlFor="utterance"
          className="font-display text-lg font-semibold text-ink"
        >
          What did you spend?
        </label>

        <div className="flex flex-wrap items-stretch gap-2">
          <div className="relative flex min-w-64 flex-1 items-center">
            <WaterDrop />
            <input
              id="utterance"
              ref={inputRef}
              name="utterance"
              placeholder="spent 12 on coffee with Sam"
              maxLength={500}
              autoComplete="off"
              required
              className="w-full rounded-md border border-rule bg-surface py-2.5 pr-3 pl-9 text-[0.9375rem] text-ink placeholder:text-ink-faint focus:border-water focus:outline-none focus-visible:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-5 py-2.5 font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-55"
          >
            {pending ? "Reading…" : "Log it"}
          </button>
        </div>

        <p className="text-xs text-ink-soft">
          Plain English — “65 climbing pass yesterday”, “24.99 haircut”. Read by{" "}
          <span className="text-water-ink" title={modelSlug}>
            {modelLabel}
          </span>
          , which picks the amount, category and date out of the sentence.
        </p>
      </form>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border-l-2 border-danger bg-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="rounded-md border-l-2 border-ok bg-surface px-3 py-2 text-sm text-ok">
          {state.message} Watch the bed.
        </p>
      ) : null}
    </div>
  );
}

/** Marks the input as the watering can. */
function WaterDrop() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="pointer-events-none absolute left-3 h-4 w-4"
    >
      <path
        d="M8 1.5C8 1.5 3.4 6.6 3.4 9.6a4.6 4.6 0 0 0 9.2 0C12.6 6.6 8 1.5 8 1.5Z"
        fill="var(--water)"
        opacity="0.9"
      />
    </svg>
  );
}

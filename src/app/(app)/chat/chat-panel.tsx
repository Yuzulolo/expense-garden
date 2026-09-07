"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ChatState } from "./actions";

/**
 * Holds no key and makes no model call. It posts a question to the
 * askAboutSpending server action, passed in as a prop and compiled to an
 * action id — none of that action's code reaches the browser.
 */
export function ChatComposer({
  action,
}: {
  action: (state: ChatState, formData: FormData) => Promise<ChatState>;
}) {
  const [state, formAction, pending] = useActionState<ChatState, FormData>(
    action,
    {},
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear only when the turn succeeded, so a failed question can be retried.
  useEffect(() => {
    if (!pending && !state.error && inputRef.current) inputRef.current.value = "";
  }, [pending, state.error]);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-wrap gap-2">
        <label htmlFor="question" className="sr-only">
          Ask about your spending
        </label>
        <input
          id="question"
          ref={inputRef}
          name="question"
          placeholder="How much did I spend on social last month?"
          maxLength={1000}
          autoComplete="off"
          required
          className="min-w-64 flex-1 border px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="border bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <p className="text-xs text-zinc-500">
        Answers come from your own recorded totals for the last 12 months.
      </p>
    </div>
  );
}

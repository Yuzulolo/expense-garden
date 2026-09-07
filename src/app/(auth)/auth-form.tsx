"use client";

import { useActionState } from "react";
import type { AuthState } from "./actions";

type Action = (state: AuthState, formData: FormData) => Promise<AuthState>;

export function AuthForm({
  action,
  submitLabel,
  passwordHint,
}: {
  action: Action;
  submitLabel: string;
  passwordHint?: string;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={
            submitLabel === "Log in" ? "current-password" : "new-password"
          }
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {passwordHint ? (
          <span className="text-xs text-zinc-500">{passwordHint}</span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-800 px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? "Working…" : submitLabel}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-400">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

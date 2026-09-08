"use client";

import { useActionState } from "react";
import type { AuthState } from "./actions";

type Action = (state: AuthState, formData: FormData) => Promise<AuthState>;

const field =
  "rounded-md border border-rule bg-surface px-3 py-2.5 text-[0.9375rem] text-ink focus:border-water focus:outline-none focus-visible:outline-none";

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
        <span className="text-sm font-medium text-ink">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={
            submitLabel === "Log in" ? "current-password" : "new-password"
          }
          className={field}
        />
        {passwordHint ? (
          <span className="text-xs text-ink-faint">{passwordHint}</span>
        ) : null}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-md bg-primary px-3 py-2.5 font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-55"
      >
        {pending ? "Working…" : submitLabel}
      </button>

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
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

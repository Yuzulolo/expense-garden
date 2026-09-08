import Link from "next/link";
import { AuthForm } from "../auth-form";
import { logIn } from "../actions";

export default function LoginPage() {
  return (
    <>
      <h1 className="font-display mb-1 text-2xl font-semibold text-ink">
        Log in
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        Pick up where your garden left off.
      </p>
      <AuthForm action={logIn} submitLabel="Log in" />
      <p className="mt-6 text-sm text-ink-soft">
        No account yet?{" "}
        <Link
          href="/signup"
          className="text-ink underline decoration-rule underline-offset-2 hover:decoration-water"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}

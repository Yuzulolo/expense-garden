import Link from "next/link";
import { AuthForm } from "../auth-form";
import { signUp } from "../actions";

export default function SignupPage() {
  return (
    <>
      <h1 className="font-display mb-1 text-2xl font-semibold text-ink">
        Create an account
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        Six plants, one per category. They start from seed.
      </p>
      <AuthForm
        action={signUp}
        submitLabel="Sign up"
        passwordHint="At least 8 characters."
      />
      <p className="mt-6 text-sm text-ink-soft">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-ink underline decoration-rule underline-offset-2 hover:decoration-water"
        >
          Log in
        </Link>
      </p>
    </>
  );
}

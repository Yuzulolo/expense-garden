import Link from "next/link";
import { AuthForm } from "../auth-form";
import { signUp } from "../actions";

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Create an account</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Plant your first garden.
      </p>
      <AuthForm
        action={signUp}
        submitLabel="Sign up"
        passwordHint="At least 8 characters."
      />
      <p className="mt-6 text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="text-emerald-800 underline dark:text-emerald-400">
          Log in
        </Link>
      </p>
    </>
  );
}

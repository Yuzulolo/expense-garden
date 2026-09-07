import Link from "next/link";
import { AuthForm } from "../auth-form";
import { logIn } from "../actions";

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Log in</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Your garden is waiting.
      </p>
      <AuthForm action={logIn} submitLabel="Log in" />
      <p className="mt-6 text-sm text-zinc-500">
        No account yet?{" "}
        <Link href="/signup" className="text-emerald-800 underline dark:text-emerald-400">
          Sign up
        </Link>
      </p>
    </>
  );
}

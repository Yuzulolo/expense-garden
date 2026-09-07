import { redirect } from "next/navigation";

export default function Home() {
  // Signed in → the dashboard renders. Signed out → the (app) layout's
  // requireUser() sends them to /login.
  redirect("/dashboard");
}

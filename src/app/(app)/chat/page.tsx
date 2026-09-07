import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { askAboutSpending } from "./actions";
import { ChatComposer } from "./chat-panel";

export default async function ChatPage() {
  // Gated here as well as in the layout: every entry point that reads user
  // data does its own check rather than trusting an ancestor.
  await requireUser();

  const supabase = await createClient();

  // RLS scopes this to the signed-in user's own conversation.
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Ask about your spending</h1>
        <p role="alert" className="text-red-700">
          Could not load the conversation: {error.message}
        </p>
        <p className="text-sm text-zinc-500">
          If this says a relation does not exist, the messages migration has not
          been pushed yet.
        </p>
      </section>
    );
  }

  const messages = data ?? [];

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Ask about your spending</h1>
        <p className="text-sm text-zinc-500">
          Questions are answered from your recorded totals — not from anything
          the model was trained on.
        </p>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-col gap-2 border border-dashed p-4 text-sm text-zinc-500">
          <p>Nothing asked yet. Try one of these:</p>
          <ul className="list-disc pl-5">
            <li>How much did I spend on social last month?</li>
            <li>Which category did I spend the most on this year?</li>
            <li>Am I spending more than I earn?</li>
          </ul>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {messages.map((m) => (
            <li
              key={m.id as string}
              className={
                m.role === "user"
                  ? "border-l-2 border-emerald-800 pl-3"
                  : "border-l-2 border-zinc-300 pl-3 dark:border-zinc-700"
              }
            >
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {m.role === "user" ? "You" : "Answer"}
              </p>
              <p className="whitespace-pre-wrap text-sm">{m.content as string}</p>
            </li>
          ))}
        </ol>
      )}

      <ChatComposer action={askAboutSpending} />
    </section>
  );
}

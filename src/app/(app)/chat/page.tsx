import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ChatComposer, type Turn } from "./chat-panel";
import { CHAT_MODEL, formatModelSlug } from "@/lib/ai/models";

export default async function ChatPage() {
  // Gated here as well as in the layout: every entry point that reads user
  // data does its own check rather than trusting an ancestor.
  await requireUser();

  const supabase = await createClient();

  // The database is the source of truth for the transcript. RLS scopes this to
  // the signed-in user's own conversation. The client component seeds its state
  // from this on mount and appends locally afterwards, so a completed answer
  // never has to round-trip back from the server to stay on screen.
  // Newest 200, not oldest 200: `ascending: true` with a limit would return the
  // start of a long conversation and hide everything recent. The index is
  // (user_id, seq desc), so this is also the ordering it serves directly.
  //
  // Ordered by seq, not created_at: both rows of a pair are written in one
  // insert and share a created_at to the microsecond, so created_at leaves the
  // order within a pair undefined and the grouping below can see an answer
  // before its question. seq is monotonic per insert.
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content")
    .order("seq", { ascending: false })
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

  // Back to chronological before handing over: the client groups turns into
  // question/answer pairs, which only works in write order. It reverses the
  // grouped exchanges itself for newest-first display.
  const initialTurns: Turn[] = (data ?? [])
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id as string,
      role: m.role as string,
      content: m.content as string,
    }));

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Ask about your spending</h1>
        <p className="text-sm text-zinc-500">
          Questions are answered from your recorded totals — not from anything
          the model was trained on.
        </p>
      </div>

      <ChatComposer
        initialTurns={initialTurns}
        modelLabel={formatModelSlug(CHAT_MODEL)}
        modelSlug={CHAT_MODEL}
      />
    </section>
  );
}

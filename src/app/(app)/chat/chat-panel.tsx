"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Holds no key and makes no model call. It POSTs a question to /api/chat — a
 * server Route Handler — and renders the text that streams back. The OpenRouter
 * call, the prompt, and the key all stay on the server; this component only
 * ever sees plain answer text.
 *
 * It owns the transcript for the lifetime of the page, seeded from the server.
 * That is what makes the end of a stream invisible: the finished answer is
 * moved into the same list, rendered by the same component, in one batched
 * state update — so the markup it produces before and after is identical.
 * The database is still the source of truth; a fresh load re-seeds from it.
 */

export type Turn = {
  id: string;
  role: string;
  content: string;
};

/** A question and the answer it produced, kept together. */
type Exchange = { id: string; question?: Turn; answer?: Turn };

/**
 * Group a chronological turn list into question/answer pairs.
 *
 * Reversing the flat list would pair every question with the PREVIOUS
 * exchange's answer, so grouping has to happen before any reordering. Turns are
 * written two at a time by the chat route, but an unpaired turn is handled
 * rather than dropped — a stray row should still be readable.
 */
function toExchanges(turns: Turn[]): Exchange[] {
  const exchanges: Exchange[] = [];

  for (const turn of turns) {
    const current = exchanges[exchanges.length - 1];
    if (turn.role === "user") {
      exchanges.push({ id: turn.id, question: turn });
    } else if (current && !current.answer) {
      current.answer = turn;
    } else {
      // An answer with no question before it.
      exchanges.push({ id: turn.id, answer: turn });
    }
  }

  return exchanges;
}

/** One rendered turn. Used for both persisted and in-flight turns, so the
 *  handoff between them changes nothing in the DOM. */
function TurnView({
  role,
  content,
  caret,
}: {
  role: string;
  content: string;
  caret?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div
      className={
        isUser
          ? "border-l-2 border-emerald-800 pl-3"
          : "border-l-2 border-zinc-300 pl-3 dark:border-zinc-700"
      }
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {isUser ? "You" : "Answer"}
      </p>
      <p className="whitespace-pre-wrap text-sm">
        {content}
        {caret ? <span className="ml-0.5 inline-block animate-pulse">▍</span> : null}
      </p>
    </div>
  );
}

/** A question and its answer as one visual unit, so they cannot drift apart. */
function ExchangeView({
  question,
  answer,
  caret,
}: {
  question?: Turn | { content: string };
  answer?: Turn | { content: string };
  caret?: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
      {question ? <TurnView role="user" content={question.content} /> : null}
      {answer || caret ? (
        <TurnView role="assistant" content={answer?.content ?? ""} caret={caret} />
      ) : null}
    </li>
  );
}

export function ChatComposer({
  initialTurns,
  modelLabel,
  modelSlug,
}: {
  initialTurns: Turn[];
  modelLabel: string;
  modelSlug: string;
}) {
  const router = useRouter();
  // Seeded once from the server-rendered transcript. Later turns are appended
  // locally, so a completed answer never has to be re-fetched to stay on screen.
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [question, setQuestion] = useState("");
  const [streamed, setStreamed] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = inputRef.current?.value.trim() ?? "";
    if (!text || pending) return;

    setPending(true);
    setError(null);
    setStreamed("");
    setQuestion(text);

    // Accumulated locally as well as in state, so the completed text is
    // available synchronously at the handoff without reading back from state.
    let full = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? `Request failed (${response.status}).`);
        setPending(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let saved = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Newline-delimited JSON: one event per line.
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const raw = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!raw) continue;

          try {
            const event = JSON.parse(raw);
            if (event.t === "delta") {
              full += event.v;
              setStreamed(full);
            } else if (event.t === "error") {
              setError(event.v);
            } else if (event.t === "done") {
              saved = true;
            }
          } catch {
            /* ignore a malformed line rather than losing the answer */
          }
        }
      }

      if (saved) {
        // The handoff. These three updates are batched into a single render,
        // and the two appended turns render through the same TurnView the
        // in-flight pair was using — so the output is byte-identical and
        // nothing visibly changes.
        const stamp = Date.now();
        setTurns((prev) => [
          ...prev,
          { id: `local-${stamp}-q`, role: "user", content: text },
          { id: `local-${stamp}-a`, role: "assistant", content: full },
        ]);
        setQuestion("");
        setStreamed("");
        if (inputRef.current) inputRef.current.value = "";

        // Purely to keep the cached RSC payload current for a later navigation.
        // It no longer affects what is on screen, so its latency is invisible —
        // this is what used to cause the flicker.
        router.refresh();
      }
    } catch {
      setError("The connection dropped before the answer finished.");
    } finally {
      setPending(false);
    }
  }

  const showInFlight = question !== "";
  // Grouped while chronological, then reversed: newest exchange first, with each
  // question still directly above its own answer.
  const exchanges = toExchanges(turns).reverse();

  return (
    <div className="flex flex-col gap-4">
      {/* The composer sits at the top so it stays reachable as the transcript
          grows, rather than being pushed below it. */}
      <form onSubmit={ask} className="flex flex-wrap gap-2">
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
          disabled={pending}
          className="min-w-64 flex-1 border px-3 py-2 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className="border bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-zinc-500">
        Answers come from your own recorded totals for the last 12 months ·{" "}
        <span title={modelSlug}>Powered by {modelLabel}</span>
      </p>

      {exchanges.length === 0 && !showInFlight ? (
        <div className="flex flex-col gap-2 border border-dashed p-4 text-sm text-zinc-500">
          <p>Nothing asked yet. Try one of these:</p>
          <ul className="list-disc pl-5">
            <li>How much did I spend on social last month?</li>
            <li>Which category did I spend the most on this year?</li>
            <li>Am I spending more than I earn?</li>
          </ul>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-live="polite">
          {/* The in-flight exchange is the newest, so it sits directly under
              the composer — and it is rendered by the same ExchangeView the
              saved turns use, so the handoff at stream end changes nothing. */}
          {showInFlight ? (
            <ExchangeView
              question={{ content: question }}
              answer={{ content: streamed }}
              caret={pending}
            />
          ) : null}
          {exchanges.map((x) => (
            <ExchangeView key={x.id} question={x.question} answer={x.answer} />
          ))}
        </ol>
      )}
    </div>
  );
}

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
 *  handoff between them changes nothing in the DOM.
 *
 *  The two roles are told apart by treatment, not by a label above each one:
 *  the question is set in the display face, the answer sits on the water tint
 *  the AI surfaces share. A visible "YOU" / "ANSWER" caption is chrome that
 *  repeats what the styling already says, so only a screen-reader label
 *  remains. */
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

  if (isUser) {
    return (
      <p className="font-display text-[1.0625rem] leading-snug font-semibold text-ink">
        <span className="sr-only">You asked: </span>
        {content}
      </p>
    );
  }

  return (
    <div className="rounded-md border-l-2 border-water bg-water-wash px-3 py-2.5">
      <p className="whitespace-pre-wrap text-sm text-ink">
        <span className="sr-only">Answer: </span>
        {content}
        {caret ? (
          <span className="ml-0.5 inline-block animate-pulse text-water">
            ▍
          </span>
        ) : null}
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
    <li className="flex flex-col gap-2 border-b border-rule-soft pb-4 last:border-b-0 last:pb-0">
      {question ? <TurnView role="user" content={question.content} /> : null}
      {answer || caret ? (
        <TurnView role="assistant" content={answer?.content ?? ""} caret={caret} />
      ) : null}
    </li>
  );
}

const EXAMPLES = [
  "How much did I spend on social last month?",
  "Which category did I spend the most on this year?",
  "Am I spending more than I earn?",
];

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

  function fillExample(text: string) {
    // Presentation only: it fills the box and hands over the cursor, it does
    // not ask anything.
    if (!inputRef.current) return;
    inputRef.current.value = text;
    inputRef.current.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The composer sits at the top so it stays reachable as the transcript
          grows, rather than being pushed below it. */}
      <form onSubmit={ask} className="flex flex-wrap items-stretch gap-2">
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
          className="min-w-64 flex-1 rounded-md border border-rule bg-surface px-3 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-faint focus:border-water focus:outline-none focus-visible:outline-none disabled:opacity-55"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-5 py-2.5 font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-55"
        >
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="rounded-md border-l-2 border-danger bg-surface px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <p className="text-xs text-ink-soft">
        Answered from your own recorded totals for the last 12 months by{" "}
        <span className="text-water-ink" title={modelSlug}>
          {modelLabel}
        </span>
        . It shows the figures it used, so you can check them.
      </p>

      {exchanges.length === 0 && !showInFlight ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-rule px-4 py-5">
          <p className="text-sm text-ink-soft">
            Nothing asked yet. Start with one of these:
          </p>
          <ul className="flex flex-col items-start gap-1.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => fillExample(example)}
                  className="rounded-md text-left font-display text-[1.0625rem] leading-snug font-semibold text-ink-soft transition-colors hover:text-water-ink"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="flex flex-col gap-4" aria-live="polite">
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

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildChatMessages, type ChatMessage } from "@/lib/ai/grounding";
import { CHAT_MODEL } from "@/lib/ai/models";

/**
 * Streaming chat endpoint.
 *
 * THE OPENROUTER CALL FOR CHAT HAPPENS HERE. `process.env.OPENROUTER_API_KEY`
 * is read inside this handler only. A Route Handler is server-only by
 * construction — Next never includes one in a client bundle — so the key cannot
 * reach the browser. The client posts a question and reads back text; it never
 * sees the key, the upstream URL, or the prompt.
 *
 * Why a Route Handler rather than a Server Function: Next's docs are explicit
 * that streaming a raw response outside React rendering is what Route Handlers
 * are for. A Server Function returns a value once; it cannot emit tokens as
 * they arrive.
 *
 * The cost of that choice is that Next's automatic Server-Action protections do
 * not apply here, so this handler does them itself: an explicit auth check and
 * an explicit same-origin check, both below.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_QUESTION_CHARS = 1000;

/** Newline-delimited JSON so the client can tell text from a mid-stream error. */
type Event =
  | { t: "delta"; v: string }
  | { t: "done" }
  | { t: "error"; v: string };

function line(event: Event): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * The hosts a browser may legitimately claim as its Origin.
 *
 * Not `x-forwarded-host` or `host`: those are request headers, so the caller
 * supplies them, and comparing Origin against another value from the same
 * caller proves nothing. `request.nextUrl.host` is built by Next from the
 * server's own configured hostname — or, where `trustHostHeader` is on (as on
 * Vercel), from `Host`, which fetch() forbids page scripts from setting — so it
 * is not attacker-supplied either way.
 *
 * Behind a reverse proxy that rewrites the host, set `APP_ALLOWED_HOSTS` to the
 * public host(s), comma-separated; it takes precedence when present.
 */
function allowedHosts(request: NextRequest): string[] {
  const configured = (process.env.APP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);

  return configured.length > 0
    ? configured
    : [request.nextUrl.host.toLowerCase()];
}

export async function POST(request: NextRequest) {
  // A Server Action gets an Origin/Host check from the framework. This does not,
  // so it checks for itself: without this, any site could POST here on a
  // signed-in user's behalf, spending their credits and writing to their history.
  //
  // Fail closed on a missing Origin too. A browser fetch() always sends Origin
  // on a POST, so a request without one did not come from this app's UI, and
  // skipping the check for it would leave the same hole open.
  const origin = request.headers.get("origin");
  let originHost: string | null = null;
  if (origin) {
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
  }
  if (!originHost || !allowedHosts(request).includes(originHost)) {
    return json({ error: "Cross-origin request refused." }, 403);
  }

  const supabase = await createClient();

  // getUser(), never getSession(): getSession decodes the cookie without
  // contacting the auth server, so a forged cookie can produce a session-shaped
  // object. requireUser() is not used here because it redirects, which is the
  // wrong response shape for a fetch().
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return json({ error: "Not signed in." }, 401);
  }

  let question = "";
  try {
    const body = await request.json();
    question = String(body?.question ?? "").trim();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  if (!question) return json({ error: "Type a question first." }, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: "That question is too long. Shorten it." }, 400);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ error: "Chat is not configured on this server." }, 500);

  const built = await buildChatMessages(supabase, question);
  if ("error" in built) return json({ error: built.error }, 500);

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        provider: { only: ["anthropic"] },
        max_tokens: 700,
        stream: true,
        messages: built.messages satisfies ChatMessage[],
      }),
    });
  } catch {
    return json({ error: "Could not reach the AI service." }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    // Read the body as text first — .json() throws on a non-JSON error page and
    // takes the body with it.
    const raw = await upstream.text().catch(() => "");
    // Upstream text is for the server log only. It can name the provider, the
    // routing decision, or the workspace guardrail — the guardrail's 404 body
    // carries a `configure_url` — none of which belongs in a browser response.
    console.error(
      `[chat] OpenRouter responded ${upstream.status}: ${raw.slice(0, 500)}`,
    );
    return json(
      {
        error: `The AI service returned an error (${upstream.status}). Try again in a moment.`,
      },
      502,
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  // Set by cancel() below. start() keeps running after a cancel, so without
  // this the loop would fall through to the insert with a truncated answer.
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let full = "";
      let failed: string | null = null;
      // OpenRouter reports why generation stopped. "stop" is a finished reply;
      // "length" means it hit max_tokens mid-sentence.
      let finishReason: string | null = null;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // OpenRouter streams OpenAI-style SSE, and also emits
          // ": OPENROUTER PROCESSING" keep-alive comment lines.
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);

            if (raw === "" || raw.startsWith(":")) continue;
            if (!raw.startsWith("data:")) continue;

            const payload = raw.slice(5).trim();
            if (payload === "[DONE]") continue;

            try {
              const chunk = JSON.parse(payload);
              if (chunk?.error) {
                // Logged, not forwarded — see the note on the non-2xx branch.
                console.error(
                  `[chat] OpenRouter mid-stream error: ${JSON.stringify(chunk.error).slice(0, 500)}`,
                );
                failed = "The AI service reported an error. Try again in a moment.";
                break;
              }
              const choice = chunk?.choices?.[0];
              if (typeof choice?.finish_reason === "string") {
                finishReason = choice.finish_reason;
              }
              const delta = choice?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                full += delta;
                controller.enqueue(line({ t: "delta", v: delta }));
              }
            } catch {
              // A partial JSON payload split across chunks — skip this line.
            }
          }
          if (failed) break;
        }
      } catch {
        failed = "The response was interrupted.";
      }

      // The client went away mid-answer. Nothing is saved, by design: `messages`
      // is append-only, so a half-answer could not be corrected or removed
      // afterwards. Returning here also avoids enqueuing onto a cancelled
      // controller, which throws.
      if (cancelled) return;

      // A reply that stopped at max_tokens is not an answer, it is the first
      // 700 tokens of one — and in a financial answer the cut can land
      // mid-figure. Treated exactly like the disconnect above: not saved, and
      // reported as a failure rather than handed over as final. `messages` is
      // append-only, so a half-answer written here could not be corrected.
      if (!failed && finishReason !== null && finishReason !== "stop") {
        failed =
          finishReason === "length"
            ? "That answer was too long to finish, so it was not saved. Try asking about a narrower period or category."
            : "The answer stopped before it was finished, so it was not saved. Try again.";
      }

      if (failed || full.trim() === "") {
        controller.enqueue(
          line({ t: "error", v: failed ?? "The AI service sent an empty response." }),
        );
        controller.close();
        return;
      }

      // Both rows written together, and only now — after a complete reply.
      // Never partway through the stream: `messages` is append-only, so a
      // half-saved answer could not be corrected or removed afterwards.
      const { error: insertError } = await supabase.from("messages").insert([
        { role: "user", content: question },
        { role: "assistant", content: full },
      ]);

      if (insertError) {
        controller.enqueue(
          line({ t: "error", v: `Answer shown but not saved: ${insertError.message}` }),
        );
      } else {
        controller.enqueue(line({ t: "done" }));
      }
      controller.close();
    },

    cancel() {
      // Client navigated away mid-answer. start() is still running; the flag is
      // what stops it short of the insert.
      cancelled = true;
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

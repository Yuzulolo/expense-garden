# AI code review — `feat/model-display-and-streaming`

**Reviewer:** Claude Code `ai-code-reviewer` subagent (read-only; made no edits)
**Base:** `main` @ `e2fae70`
**Date:** 2026-09-08

Two rounds, both recorded verbatim as returned by the subagent. Round 1 reviewed
`git diff main...HEAD`. Five findings were then fixed; Round 2 re-reviewed
`main` → working tree, verifying each fix and re-running the full review.

**Fixed after Round 1:** Critical 1 (origin check trusting `x-forwarded-host`),
Critical 2 (`/api/*` passing through the proxy unauthenticated), Warning 3
(partial answer persisted on client disconnect, plus an unhandled rejection),
Warning 4 (verbatim upstream error text sent to the browser), Warning 7 (stale
`CLAUDE.md` path). `npx tsc --noEmit`, `eslint` and `next build` are clean after
the fixes.

**Deliberately deferred:** Round 1 Warning 5 (transcript pairing depends on a
`created_at` tie) and Warning 8 (a streamed answer shown but never saved), and
all remaining suggestions. See the reviewer-accuracy note at the end.

---

## Round 2 — verification of fixes, and re-review

### Re-review: `feat/model-display-and-streaming` → working tree

Scope verified: `git diff main --stat` = 11 files, +676/−195 (`CLAUDE.md`, `src/app/(app)/chat/{page.tsx,chat-panel.tsx}`, `src/app/(app)/chat/actions.ts` deleted → `src/lib/ai/grounding.ts`, `src/lib/ai/models.ts`, `src/app/api/chat/route.ts`, `src/lib/supabase/proxy.ts`, dashboard/expenses pages, `log-expense.tsx`). Uncommitted fixes are in `CLAUDE.md`, `src/app/api/chat/route.ts`, `src/lib/supabase/proxy.ts`. `npx tsc --noEmit` and `npx eslint src` are both clean.

### Verification of the five fixes

**1. Same-origin check — FIXED, correct.**
`src/app/api/chat/route.ts:58-88`. `x-forwarded-host` is gone; Origin is compared against `APP_ALLOWED_HOSTS` or `request.nextUrl.host`, and a missing/unparseable Origin now 403s.

Is `nextUrl.host` client-controllable? No, verified against Next 16.3.4 in `node_modules`. `NextRequestAdapter.fromNodeNextRequest` builds the URL from the `initURL` request meta (`node_modules/next/dist/server/web/spec-extension/adapters/next-request.js:89-102`), and every producer of `initURL` derives the host from either the server's own configured hostname/port or, only when `experimental.trustHostHeader` is on, `req.headers.host` — never `x-forwarded-host`: `server/next-server.js:1280`, `server/lib/router-utils/resolve-routes.js:117`, `server/route-modules/route-module.js:384`. `trustHostHeader` is not set in `next.config.ts` and is auto-enabled only under `hasNextSupport` (`server/config.js:355`), i.e. Vercel. `Host` is a forbidden header name for `fetch()`, so a page script cannot forge it. The doc comment at lines 45-57 is accurate.

Does fail-closed break a legitimate caller? No. The only caller in the repo is the browser `fetch` at `src/app/(app)/chat/chat-panel.tsx:139`, which is same-origin and POST, so Origin is always present per the Fetch spec. There are no scripts, tests, or server-side callers (`grep` for `api/chat` finds only the panel and the old review doc). Two operational caveats are noted as Suggestions below.

**2. Proxy 401 for `/api/*` — FIXED, cookies preserved correctly.**
`src/lib/supabase/proxy.ts:79-81` plus `jsonPreservingCookies` at `:96-107`. `from.cookies.getAll()` returns cookies parsed out of the `Set-Cookie` header *with* their attributes (`node_modules/next/dist/compiled/@edge-runtime/cookies/index.js:253-284`), and `json.cookies.set(cookie)` reserializes name, value, path, `HttpOnly`, `Secure`, `SameSite` and expiry — the same mechanism the pre-existing `redirectPreservingCookies` relies on, and `response` is read after `setAll` has reassigned it, so the latest refreshed cookies are the ones copied. `Cache-Control: private, no-store` is set explicitly on the 401, so dropping the `@supabase/ssr` headers costs nothing here. No legitimate public API route is broken: the only route handlers are `src/app/api/chat/route.ts` (auth-required) and `src/app/auth/callback/route.ts`, which is under `/auth`, already in `PUBLIC_PATHS`, and not under `/api/`. The proxy matcher (`src/proxy.ts:13-18`) does cover `/api/*`, so the new branch is genuinely reachable and not dead.

**3. `cancelled` flag — FIXED for the reported bug; one narrow residual window.**
`src/app/api/chat/route.ts:166`, `:223`, `:251-256`. On cancel, `reader.cancel()` makes the pending `reader.read()` resolve done, the loop exits, and `if (cancelled) return` at `:223` short-circuits before both the error enqueue and the insert — so no truncated answer is written. A delta `controller.enqueue` racing the cancel throws inside the `try` at `:174-217`, is caught at `:215`, and still hits the `:223` guard. That is correct.

Residual: the flag is not re-checked after the `await` on the insert (`:236-239`). A disconnect during that await leaves `controller.enqueue` at `:242` or `:246` throwing on a cancelled controller, which rejects `start()` rather than being swallowed. The answer is already fully saved at that point, so it is a log-noise / unhandled-rejection issue rather than data loss. See Suggestion S1.

**4. Upstream error text — FIXED for OpenRouter; two Supabase leak paths remain.**
`:143-159` logs the upstream body server-side and returns only the status code, and `:196-203` logs `chunk.error` and substitutes a generic message. Both correct. But raw Supabase error text still reaches the browser at `:121` (`json({ error: built.error }, 500)`, where `built.error` is `readError.message` from `src/lib/ai/grounding.ts:147`) and at `:243` (`Answer shown but not saved: ${insertError.message}`). Both are carried over from `main`, not introduced here, but they are remaining paths that leak internal detail. See Warning W1.

**5. `CLAUDE.md` pointer — FIXED.**
`CLAUDE.md:98` now says `src/lib/ai/models.ts`, which exists and carries the guardrail note at `src/lib/ai/models.ts:15-21`. No stale references to `chat/actions.ts`, `askAboutSpending`, or `ChatState` remain anywhere in the tree (only in `docs/ai-code-review.md`, the previous review, which is excluded from review). Minor nit: the note in `models.ts` explains *why* Sonnet 5 is not used but does not literally say how to switch back, so `CLAUDE.md`'s "carries a comment on how to switch back" slightly oversells it.

### Findings

#### Critical

None.

#### Warning

**W1. Supabase error messages still forwarded to the browser — `src/app/api/chat/route.ts:121` and `src/app/api/chat/route.ts:243`**
`built.error` (a Postgres/PostgREST message from `src/lib/ai/grounding.ts:147`) and `insertError.message` go straight into the response body. These can name views, columns, or RLS policy failures. This is the same class of leak that fix 4 closed for OpenRouter, so closing it only on one side is inconsistent; carried over from `main` rather than newly introduced.

**W2. Provider pin contradicts the documented model fallbacks — `src/app/api/chat/route.ts:133`**
`provider: { only: ["anthropic"] }` is hard-coded next to `model: CHAT_MODEL`, while `CLAUDE.md:99-100` and `src/lib/ai/models.ts:12-21` present `google/gemini-2.5-flash` and `openai/gpt-5-mini` as one-edit alternatives. Changing `CHAT_MODEL` alone would produce a routing failure with no endpoints, which is exactly the confusing 404 the CLAUDE.md guardrail section exists to prevent re-investigating. The pin belongs alongside the slug in `models.ts` or should be derived from the slug's vendor prefix.

**W3. Truncation at `max_tokens` is saved as a complete answer — `src/app/api/chat/route.ts:134`, `:225-239`**
`max_tokens: 700` with no check of `finish_reason`. A reply cut off at the limit takes the success path: `done` is emitted, both rows are inserted, and the client appends it as final. Given the append-only `messages` table this is the one truncation case that *does* get persisted, which sits oddly next to the comment at `:219-222` justifying discarding truncated answers on disconnect. In a financial answer, a sentence severed mid-figure is worse than an error.

#### Suggestion

**S1. Re-check `cancelled` (or guard the enqueues) after the insert await — `src/app/api/chat/route.ts:236-248`**
As described under fix 3: a disconnect during the insert leaves `controller.enqueue` at `:242`/`:246` throwing outside any `try`, rejecting `start()`. A second `if (cancelled) return` after the await, or a `try/catch` around the final enqueue/close, closes the window.

**S2. `APP_ALLOWED_HOSTS` is documented only in a code comment — `src/app/api/chat/route.ts:55-56`**
There is no `.env.example`, and neither `README.md` nor `CLAUDE.md` mentions the variable. Deployed behind a reverse proxy without `trustHostHeader`, `nextUrl.host` is the internal hostname while the browser's Origin is the public one, so chat returns `403 Cross-origin request refused.` for every request with nothing in the diff pointing at the cause. The same bites in dev when the app is opened on `127.0.0.1:3000` rather than `localhost:3000`.

**S3. Error path leaves an empty "Answer" block on screen — `src/app/(app)/chat/chat-panel.tsx:132`, `:213`, `:271-277`**
`setQuestion(text)` runs before the fetch, and no error path clears it, so `showInFlight` stays true. On an HTTP error the transcript renders the question plus an `ANSWER` heading with no content and no caret. On a mid-stream `error` event the partial text stays visible indefinitely although nothing was saved, and silently vanishes on the next navigation.

**S4. Duplicated OpenRouter plumbing — `src/app/api/chat/route.ts:25` vs `src/app/(app)/expenses/ai-actions.ts:26`**
`OPENROUTER_URL` and the `Authorization`/`Content-Type`/`provider` request shape are now written out twice. `src/lib/ai/models.ts` was created precisely to centralise "a model change is one edit"; the endpoint and provider pin have the same argument for living there.

**S5. `MAX_QUESTION_CHARS` duplicated as a literal — `src/app/api/chat/route.ts:26` vs `src/app/(app)/chat/chat-panel.tsx:231`**
`1000` appears in both. They agree today; the client `maxLength` and the server bound should read one exported constant so they cannot drift into a state where the UI accepts input the server rejects.

**S6. `formatModelSlug` is broader than the two slugs it serves — `src/lib/ai/models.ts:24`, `:34-47`**
Both `PARSE_MODEL` and `CHAT_MODEL` are `anthropic/claude-haiku-4.5`, so the `:` variant strip, the version-number branch, and the `ACRONYMS` table are all currently unexercised; `xl` in particular matches nothing in the CLAUDE.md allowlist and is dead configuration. Defensible as forward-looking for the documented fallbacks, but `gpt` and `ai` cover those on their own.

**S7. No rate limit or per-user cap on the chat endpoint — `src/app/api/chat/route.ts:69`**
Any signed-in user can drive unbounded OpenRouter spend from a loop; the only bound is `max_tokens` per call. The move from a Server Function to a Route Handler makes this easier to hit than before, since a script can hold the connection open in a loop without React's action queueing. Not a Sprint-3 requirement, worth a note in the write-up.

**S8. `aria-live="polite"` wraps the whole transcript — `src/app/(app)/chat/chat-panel.tsx:267`**
The live region spans every exchange, not just the streaming one, so a screen reader may re-announce far more than the new tokens. Scoping the live region to the in-flight `ExchangeView` would announce the answer without replaying history.

**Reviewed and clean:** `src/lib/ai/grounding.ts` keeps the aggregate-only DATA block with no `user_id` predicate, no id, and no email in the prompt (`:88-95`, `:37-41`); the OpenRouter key is read only inside the Route Handler and the server action, never imported by a client component; `src/lib/ai/models.ts` holds no secret and is safe for the client props it feeds; the chat page's newest-first reordering (`src/app/(app)/chat/page.tsx:14-51`) is grouped before reversing, so questions stay attached to their own answers; no `service_role` key was added.


---

## Round 1 — findings as originally reported

_Recorded verbatim; items 1–4 and 7 were fixed, see Round 2._


Scope: 10 files, +604/−194. Streaming chat moved from a Server Function to a Route Handler, grounding extracted to a shared lib, model slugs centralised and surfaced in the UI, transcript rendering rewritten client-side and reordered newest-first.

The overall shape is good: the key stays server-side (`src/app/api/chat/route.ts:92`), grounding still runs through the `security_invoker` views with no `user_id` predicate and no id in the prompt, and the client only ever receives answer text. Findings below are about the edges of that move.

### Critical

**1. The same-origin check can be defeated by the caller — `src/app/api/chat/route.ts:49-63`**
The handler compares `Origin` against `x-forwarded-host ?? host`. `x-forwarded-host` is not a forbidden header name, so cross-site JavaScript can send `x-forwarded-host: evil.com` alongside its browser-set `Origin: https://evil.com` and the two will match. The check should compare against a trusted, server-side value (an expected host/allowlist from env, or `request.nextUrl.host`), not a request header the client controls. The comment at line 20-23 presents this as the replacement for the framework's Server Action protection, so the gap is easy to miss on later reads.

**2. Proxy now waves through every unauthenticated `/api/*` request — `src/lib/supabase/proxy.ts:73`**
The early `return response` is correct for the JSON-shape problem it describes, but it is written as a blanket rule for all current and future API routes while only `/api/chat` exists and only that route re-checks auth. Any route added under `/api/` later inherits an unauthenticated path by default, and nothing in the tree enforces the per-route check the comment promises.

### Warning

**3. Client disconnect persists a truncated answer and throws inside the stream — `src/app/api/chat/route.ts:207-211` (and `192-204`)**
`cancel()` only cancels the upstream reader; the `start()` loop then sees `done: true`, falls through with a non-empty `full`, and inserts the partial answer into the append-only `messages` table — the opposite of the "Nothing is saved, by design" comment. The subsequent `controller.enqueue`/`close` on the already-cancelled controller will also throw an unhandled rejection. A cancellation flag checked before the insert would fix both.

**4. Upstream error text is now forwarded verbatim to the browser — `src/app/api/chat/route.ts:122-129` and `161-163`**
`main` deliberately returned generic strings ("The AI service returned an error (status)", "The AI service reported an error"). The new code surfaces `parsed.error.message` and `chunk.error.message` straight to the client, which can expose provider names, routing/guardrail details, and account-level messages (the guardrail 404 message includes a workspace `configure_url`). This is a silent change of the error-disclosure posture, not visible from the diff's framing as a streaming change.

**5. Transcript pairing depends on an ordering Postgres does not guarantee — `src/app/(app)/chat/page.tsx:20-24` combined with `src/app/(app)/chat/chat-panel.tsx:36-56`**
Both rows are written in one `insert()`, so `created_at default now()` gives them an identical transaction timestamp; `order("created_at", { ascending: false })` has no tiebreaker, so the user/assistant pair can come back in either order. `toExchanges` assumes strict write order and will otherwise attach an answer to the wrong question or emit orphan exchanges. A secondary sort key (or a monotonic sequence column) is needed. The same tie affects the replayed history at `src/lib/ai/grounding.ts:139-142`, where a flipped pair changes what the model is told was asked.

**6. Provider pin contradicts the documented fallback models — `src/app/api/chat/route.ts:107`**
`provider: { only: ["anthropic"] }` is hardcoded while `src/lib/ai/models.ts:16-21` documents `google/gemini-2.5-flash` and `openai/gpt-5-mini` as the drop-in alternatives. Changing `CHAT_MODEL` alone — exactly the "one edit, not a search" the module was created for — produces a routing failure.

**7. Documentation now points at a deleted file — `CLAUDE.md:99`**
It says `CHAT_MODEL` lives in `src/app/(app)/chat/actions.ts`, which this branch removes; the constant and its guardrail comment are now in `src/lib/ai/models.ts:21`. Since that note exists specifically so nobody re-investigates the guardrail, the stale path defeats its purpose.

**8. A partial answer is shown but silently dropped on error — `src/app/(app)/chat/chat-panel.tsx:178-186`**
When an `error` event arrives mid-stream, `saved` stays false, so the streamed text remains on screen indefinitely as an apparently normal answer while never entering `turns` and never being persisted. It vanishes on the next question or reload with no indication it was never recorded. In a financial app, an unrecorded figure that looks recorded is the failure mode most worth being loud about.

### Suggestion

**9. Duplicated OpenRouter plumbing — `src/app/api/chat/route.ts:25` and `src/app/(app)/expenses/ai-actions.ts:26`**
`OPENROUTER_URL`, the `Authorization` header construction, the read-body-as-text-then-parse error handling, and the provider pin are now written twice. `src/lib/ai/models.ts` was introduced as the shared home for exactly this kind of constant; the endpoint at minimum belongs there.

**10. `router.refresh()` after every answer does no visible work — `src/app/(app)/chat/chat-panel.tsx:204`**
`turns` is seeded with `useState(initialTurns)` at line 117, so refreshed props are ignored by design. The refresh re-runs the page's 200-row query on every message purely to warm a cache that a later navigation would revalidate anyway. Worth confirming it earns its cost.

**11. Unused exports in the extracted module — `src/lib/ai/grounding.ts:17`, `:19`, `:26`**
`HISTORY_TURNS`, `WINDOW_MONTHS` and `SYSTEM_PROMPT` are all exported but referenced only inside `grounding.ts`. `export` on the prompt in particular widens the surface of a security-relevant string for no current caller.

**12. Formatter carries entries nothing can reach — `src/lib/ai/models.ts:24`**
`ACRONYMS` handles `ai` and `xl`, which appear in no slug the guardrail allowlist admits. With both `PARSE_MODEL` and `CHAT_MODEL` being the same literal, the general slug parser is more machinery than the feature currently needs.

**13. `aria-live="polite"` wraps the entire transcript — `src/app/(app)/chat/chat-panel.tsx:267`**
The live region encloses every past exchange, not just the streaming one, so token-by-token updates risk re-announcing surrounding content. Scoping the live region to the in-flight `ExchangeView` would be more predictable for screen readers.

**14. Loose prop types blunt the shared-component argument — `src/app/(app)/chat/chat-panel.tsx:61`, `:86-94`**
`TurnView.role` is `string` though only `"user"`/`"assistant"` are ever passed, and `ExchangeView` accepts `Turn | { content: string }`. Narrowing `role` to a union would let the compiler enforce the "same component renders both states" invariant the comments rely on.

---

## Note on reviewer accuracy

Two places where the reports needed adjudicating against the source rather than
taken at face value:

**Round 1, Critical 1 — severity overstated.** The mechanism is real:
`x-forwarded-host` was a caller-supplied header used as the trusted comparand,
and Next only fills it in when absent (`??=`, `next/dist/server/base-server.js:609`).
But the stated exploit — cross-site JavaScript sending that header alongside its
own `Origin` — is not reachable from a browser: the header is not
CORS-safelisted, so such a request triggers a preflight, and the route has no
`OPTIONS` handler, so the POST is never sent. A cross-site POST that omits the
header was already refused. The same Origin-vs-`X-Forwarded-Host` comparison is
what Next's own Server Action CSRF check does. Fixed regardless, as a
don't-trust-caller-input defect, not as an exploitable CSRF hole.

**Round 2 — Round 1's Warning 5 was not re-raised, and should have been.** Round
2 lists the chat page's ordering as "reviewed and clean" on the grounds that
grouping happens before reversing. That addresses the grouping logic, not the
original finding. The original finding stands and is unfixed: both rows of a
pair are written in one `insert()` and `created_at timestamptz not null default
now()` (`supabase/migrations/20260907194453_messages.sql:14`) gives them an
identical transaction timestamp, while `order("created_at", { ascending: false })`
(`src/app/(app)/chat/page.tsx:23`) has no tiebreaker. A flipped pair makes
`toExchanges` emit an orphan answer followed by an unanswered question, and skews
the history replayed to the model at `src/lib/ai/grounding.ts:139-142`. A
secondary sort key or a monotonic sequence column is the fix.

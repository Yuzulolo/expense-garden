@AGENTS.md

# Expense Garden — Sprint 3

## What this app is

An expense tracker where **the primary way to log spending is natural language**.
You type "spent 12 on coffee" and an LLM turns it into a structured expense — amount,
category, description, date — which is written to the same `expenses` table and RLS
policies the app already has. Typing into a form is the fallback, not the main path.

On top of that, a **chat feature answers questions about the user's real spending**:
"how much did I spend on social last month?", "what's my biggest category this year?",
"am I spending more than I earn?". Answers are grounded in that user's own data, read
through the existing `v_category_month_totals` and `v_month_expense_totals` views under
RLS — never invented, and never another user's figures.

### Why this app is pointless without the AI

The value is not that the app remembers your categories. The value is that **you don't
have to categorize anything yourself.**

Every expense tracker ever built already lets you fill in a form. That is precisely why
nobody keeps using them: the friction is not storage, it's the twelve seconds of
classification work per transaction — pick a category, pick a date, phrase a
description. Do that four times a day and you stop after a week. Strip the AI out of
this app and what's left is another form that loses to a spreadsheet.

The AI is not a feature layered on a working product. It is the input method. Remove it
and there is no product, only a database.

The same holds for chat. The data to answer "am I overspending on social?" is already
sitting in the views — but answering it today means knowing which view to read, what a
month boundary is, and how to compare two numbers. The AI is what turns a schema into
something you can ask a question.

## AI model calls

- All LLM calls must happen **server-side only**. Never call OpenRouter from browser code.
- `OPENROUTER_API_KEY` lives in `.env.local` and must never have a `NEXT_PUBLIC_` prefix
  or be passed to client components.
- Model: **`anthropic/claude-haiku-4.5`** for both parsing and chat. Sonnet 5 is the
  better fit for chat on the merits, but this workspace's OpenRouter guardrail
  blocks it. See below.

### Model choice

Verified against `GET https://openrouter.ai/api/v1/models` on 2026-09-07. Prices per 1M
tokens.

| Slug | Input | Output | Use |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | $1.00 | $5.00 | Parsing **and** chat (see the guardrail note) |
| `anthropic/claude-sonnet-5` | $2.00 | $10.00 | Preferred for chat — currently blocked |

### The guardrail constraint (verified 2026-09-07)

`anthropic/claude-sonnet-5` returns **HTTP 404** for this account, and so does
every other Sonnet and Opus slug. It is not a bad slug — the slug is live in
`GET /api/v1/models`. OpenRouter rejects it at the *"Filter by Guardrails"*
routing step with `model-ignored-by-guardrail`, excluding all 6 endpoints even
with the provider pin removed.

It is a **model allowlist**, not a price cap and not a provider rule. Probed live
across six vendors:

| Allowed (200) | Blocked (404) |
| --- | --- |
| `openai/gpt-4o-mini`, `openai/gpt-4.1-mini`, `openai/gpt-5-mini` | `openai/gpt-4o`, `openai/gpt-5` |
| `anthropic/claude-3-haiku`, `anthropic/claude-haiku-4.5` | `anthropic/claude-sonnet-4.5`/`4.6`/`5`, `claude-opus-4.8`/`5` |
| `google/gemini-2.5-flash` | `google/gemini-2.0-flash-001`, `google/gemini-2.5-pro` |
| — | all of `mistralai/*`, `qwen/*`, `deepseek/*`, `meta-llama/*`, `amazon/*`, `writer/*` |

Price is ruled out: `mistralai/mistral-nemo` at $0.03/M output is blocked while
`claude-haiku-4.5` at $5.00/M passes. Provider is ruled out: `gpt-4o-mini` and
`gpt-4o` share endpoints, and only the first passes. The allowlist names specific
model ids — `gemini-2.5-flash` passes where `gemini-2.0-flash-001` does not.

**RESOLVED: this is the school's policy, and it cannot be changed from here.**
The OpenRouter key is school-issued, so it belongs to the school's workspace and
inherits that workspace's guardrail. The allowlist is an institutional
cost-control setting — not visible to us and not ours to modify.

Two things follow, so nobody re-investigates:

- The `configure_url` in the 404 (`.../workspaces/default/guardrails`) is
  misleading: it resolves per-viewer and points at your own personal workspace,
  not the one the key belongs to. Checking it will always show nothing relevant.
- A management key does not help either — one issued on a personal account
  cannot read the school workspace's guardrails. Do not spend time on
  `GET /api/v1/guardrails`.

**Treat the allowlist as a fixed constraint of the environment.** The model
choice for this project is externally limited, which is worth stating plainly in
the write-up: Sonnet 5 was selected on the merits and is unavailable by policy,
so chat runs on Haiku 4.5 with the show-your-figures rule as the mitigation.

If the allowlist ever changes, `CHAT_MODEL` in
`src/lib/ai/models.ts` carries a comment on how to switch back.
Within the current allowlist, `google/gemini-2.5-flash` and `openai/gpt-5-mini`
are the alternatives if Haiku's arithmetic proves weak.

Until then, chat runs on Haiku 4.5 and the system prompt compensates: rule 3
requires it to **show the figures it used**, so a wrong sum is visible rather
than hidden inside a confident sentence. Spot-check chat answers against
`/expenses` totals while this is the case.

Both are cheaper and newer than the originally proposed `anthropic/claude-sonnet-4-6`,
which also is not a valid slug — OpenRouter uses dots (`claude-sonnet-4.6`), and that
model is previous-generation and *more* expensive than Sonnet 5 at $3.00 / $15.00.

**Haiku 4.5 for parsing.** "spent 12 on coffee" → one small JSON object against a fixed
schema, with six known categories. This is the cheapest and fastest kind of LLM task
there is; the parse runs on every single expense entry, so it's the highest-volume call
in the app and latency is felt directly — the user is waiting to see their expense
appear. Sonnet-tier reasoning buys nothing on a task this constrained.

**Sonnet 5 for chat, on the merits.** Chat replies are short, but the work behind them
isn't purely mechanical: choosing which month to compare, noticing that income and
expenses move in opposite directions, not misreading a category total. Arithmetic and
comparison over supplied numbers is where a cheaper model produces confidently wrong
answers, and a wrong number in a financial app is worse than a slow one. **This is
currently unavailable** — see the guardrail note above — so chat runs on Haiku 4.5 with
the show-your-figures rule as the mitigation.

Both slugs live in one module so a model change is one edit, not a search.

## Rules the AI features must not break

The security work from Sprint 2 stays load-bearing. `docs/ARCHITECTURE.md` is the full
design; these are the invariants the AI code touches:

- **Grounding goes through RLS.** Chat reads the `security_invoker` views as the
  signed-in user. No `service_role` key exists in this project and none is to be added —
  an LLM feature is not a reason to bypass row-level security.
- **Parser output is untrusted input.** A schema-valid object can still carry a bad
  amount or an unknown category. The `CHECK` constraints and the `categories` foreign
  key are the enforcement; validation in the action is for error messages.
- **No `user_id` from the client, ever** — not in a form, not in a server action
  signature, not in a prompt. Identity comes from the session cookie.
- **Don't send more than the answer needs.** Prompts leave our infrastructure: send
  aggregate figures, not raw transaction rows, and never a user id or email address.

## Scope note: migrations 6 and 7 are deliberately unpushed

`20260906190941_savings.sql` and `20260906190942_seal.sql` (savings_overrides,
monthly_closes, seal_month) are written and verified against a local stack, but
**deliberately not applied to the hosted project**. Nothing in Sprint 3 requires
monthly closes or a savings figure, and unused schema on the hosted database is
surface area to explain and maintain for no benefit.

They now live in `supabase/migrations-deferred/`, which the CLI does not scan, so
`npx supabase db push` cannot pick them up. See the README there for what they
contain and how to re-activate them. Do not move them back without deciding that
the hosted project should carry that schema.

## References

- `docs/ARCHITECTURE.md` — schema, RLS policies, folder structure, ranked risks
- `docs/openrouter-reference.md` — endpoint, headers, structured outputs, model slugs
- `supabase/tests/rls.sql` — the two-account RLS test

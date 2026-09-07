# OpenRouter reference

**Sources** (fetched 2026-09-07 — re-check before relying on any detail below):

- Quickstart: <https://openrouter.ai/docs/quickstart>
- Structured outputs: <https://openrouter.ai/docs/features/structured-outputs>
- Streaming: <https://openrouter.ai/docs/api_reference/streaming>
- Live model list (public, no auth): <https://openrouter.ai/api/v1/models>
- Model browser, filtered to structured-output support:
  <https://openrouter.ai/models?order=newest&supported_parameters=structured_outputs>

Everything in this file is transcribed from those pages. OpenRouter's API changes;
when something here disagrees with the live docs, the live docs win.

---

## Endpoint

```
POST https://openrouter.ai/api/v1/chat/completions
```

OpenAI-compatible. Their docs give two ways to call it.

## Headers

| Header | Required | Notes |
| --- | --- | --- |
| `Authorization: Bearer <OPENROUTER_API_KEY>` | yes | Server-side only. See the security notes below. |
| `Content-Type: application/json` | yes | |
| `HTTP-Referer` | no | Your site URL. Used for OpenRouter's app attribution/rankings. |
| `X-OpenRouter-Title` | no | Your site name, same purpose. |

Note the attribution header is `X-OpenRouter-Title` in the current quickstart. Older
guides and blog posts say `X-Title`; if attribution does not show up, that mismatch
is the first thing to check.

## Request body

```json
{
  "model": "anthropic/claude-haiku-4.5",
  "messages": [{ "role": "user", "content": "Your prompt here" }]
}
```

## Calling it from Next.js (server-side)

Per the quickstart, plain `fetch` needs no SDK:

```ts
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "HTTP-Referer": "<YOUR_SITE_URL>",
    "X-OpenRouter-Title": "<YOUR_SITE_NAME>",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "anthropic/claude-haiku-4.5",
    messages: [{ role: "user", content: "spent 12 on coffee" }],
  }),
});
```

This belongs in a Server Function (`"use server"`) or a Route Handler — never in a
component that could end up in the client module graph.

The OpenAI SDK also works against OpenRouter by overriding the base URL:

```ts
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

`fetch` is enough for two features and adds no dependency; the SDK is worth it only
if we end up wanting its streaming helpers and types.

## Structured outputs — for the natural-language parser

This is the mechanism that turns "spent 12 on coffee" into a row instead of prose.
Shape, verbatim from their docs:

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "your_schema_name",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "field_name": { "type": "string", "description": "Field description" }
        },
        "required": ["field_name"],
        "additionalProperties": false
      }
    }
  }
}
```

Two things their docs call out:

- "Structured outputs are supported by select models." Verify per endpoint on the
  filtered model browser linked above rather than assuming.
- To keep OpenRouter from routing to a provider that ignores the parameter, set
  `require_parameters: true` in provider preferences and list `response_format`
  among the required parameters.

A schema is not a trust boundary. A well-formed object can still hold a nonsense
amount or a category slug that does not exist, so parser output stays untrusted
input: validate it, and let the database's CHECK constraints and the
`categories` foreign key be what actually holds.

## Streaming

Supported; see the streaming page linked at the top. Not needed for parsing (the
output is one small object) and optional for chat.

## Model slugs

Slugs use **dots**, not dashes: `anthropic/claude-sonnet-4.6`, never
`anthropic/claude-sonnet-4-6`. A dashed slug is not a valid model id.

Verified against `GET https://openrouter.ai/api/v1/models` on 2026-09-07
(27 `anthropic/*` entries; prices per 1M tokens):

| Slug | Context | Input | Output |
| --- | --- | --- | --- |
| `anthropic/claude-haiku-4.5` | 200K | $1.00 | $5.00 |
| `anthropic/claude-sonnet-5` | 1M | $2.00 | $10.00 |
| `anthropic/claude-sonnet-4.6` | 1M | $3.00 | $15.00 |
| `anthropic/claude-opus-5` | 1M | $5.00 | $25.00 |

`:batch` variants exist at roughly half price for asynchronous work. They are not
usable here — both features are interactive and need a response now.

Re-run the models endpoint rather than trusting this table; it is a snapshot.

## Security notes

- `OPENROUTER_API_KEY` is a **secret**. It lives in `.env.local`, is read only in
  server code, and never takes a `NEXT_PUBLIC_` prefix — Next.js inlines every
  `NEXT_PUBLIC_*` value into the client bundle at build time, and that is not
  reversible.
- A leaked key is billable by whoever holds it. Set a spend limit on the key in the
  OpenRouter dashboard so a mistake has a ceiling.
- Prompts sent to OpenRouter leave our infrastructure. Send the aggregate figures
  the chat answer needs, not raw transaction rows, and never a user id or email.

/**
 * The single source of truth for which model powers which AI feature.
 *
 * Both the server code that calls OpenRouter and the UI that displays the model
 * name read these constants, so the label can never drift from the model that
 * actually ran.
 *
 * This module holds no secret — only slugs and a formatter — so it is safe to
 * import anywhere. The API key lives only in the files that make the HTTP call.
 */

/** Natural-language expense parsing. Narrow task, highest call volume. */
export const PARSE_MODEL = "anthropic/claude-haiku-4.5";

/**
 * Grounded chat over spending totals.
 *
 * Sonnet 5 is the better fit on the merits, but the school workspace's
 * OpenRouter guardrail allowlist does not include it. See CLAUDE.md.
 */
export const CHAT_MODEL = "anthropic/claude-haiku-4.5";

/** Words that should not be title-cased. */
const ACRONYMS: Record<string, string> = { gpt: "GPT", ai: "AI", xl: "XL" };

/**
 * "anthropic/claude-haiku-4.5" -> "Claude Haiku 4.5"
 * "openai/gpt-5-mini"          -> "GPT 5 Mini"
 * "google/gemini-2.5-flash"    -> "Gemini 2.5 Flash"
 *
 * The vendor prefix is dropped: the model name already identifies it, and the
 * exact slug is shown on hover wherever this is displayed.
 */
export function formatModelSlug(slug: string): string {
  const withoutVariant = slug.split(":")[0];
  const name = withoutVariant.slice(withoutVariant.indexOf("/") + 1);

  return name
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => {
      if (ACRONYMS[part]) return ACRONYMS[part];
      if (/^[\d.]+$/.test(part)) return part; // version numbers stay as-is
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

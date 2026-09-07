"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseExpense, parseId } from "@/lib/validation";

export type ActionState = { error?: string; message?: string };

/**
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * request — rendering the form on a gated page is not authorization. So each
 * action authenticates with requireUser() and lets RLS authorize:
 *
 *   - no action takes a userId parameter
 *   - no insert sets user_id; the column default is auth.uid()
 *   - update/delete pass only an id, and the RLS USING clause silently scopes
 *     the statement to rows the caller owns (0 rows for anyone else's)
 */

export async function createExpense(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = parseExpense(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  // Note the absence of user_id. It comes from `default auth.uid()`.
  const { error } = await supabase.from("expenses").insert(parsed.value);
  if (error) return { error: error.message };

  revalidatePath("/expenses");
  // The garden is derived from these rows, so it must be invalidated too.
  revalidatePath("/dashboard");
  return { message: "Expense added." };
}

export async function updateExpense(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const id = parseId(formData);
  if (!id.ok) return { error: id.error };

  const parsed = parseExpense(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .update(parsed.value)
    .eq("id", id.value)
    .select("id");

  if (error) return { error: error.message };
  // RLS returns no error for someone else's row — it just matches nothing.
  if (!data?.length) return { error: "That expense no longer exists." };

  revalidatePath("/expenses");
  // The garden is derived from these rows, so it must be invalidated too.
  revalidatePath("/dashboard");
  return { message: "Saved." };
}

export async function deleteExpense(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const id = parseId(formData);
  if (!id.ok) return { error: id.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id.value)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "That expense no longer exists." };

  revalidatePath("/expenses");
  // The garden is derived from these rows, so it must be invalidated too.
  revalidatePath("/dashboard");
  return { message: "Deleted." };
}

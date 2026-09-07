"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseIncome, parseId } from "@/lib/validation";

export type ActionState = { error?: string; message?: string };

/** Same contract as the expense actions: identity from the session, never the
 *  form; ownership from RLS, never a WHERE clause the client can influence. */

export async function createIncome(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = parseIncome(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.from("incomes").insert(parsed.value);
  if (error) return { error: error.message };

  revalidatePath("/income");
  return { message: "Income added." };
}

export async function updateIncome(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const id = parseId(formData);
  if (!id.ok) return { error: id.error };

  const parsed = parseIncome(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incomes")
    .update(parsed.value)
    .eq("id", id.value)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "That income entry no longer exists." };

  revalidatePath("/income");
  return { message: "Saved." };
}

export async function deleteIncome(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const id = parseId(formData);
  if (!id.ok) return { error: id.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incomes")
    .delete()
    .eq("id", id.value)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "That income entry no longer exists." };

  revalidatePath("/income");
  return { message: "Deleted." };
}

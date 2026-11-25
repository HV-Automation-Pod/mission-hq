"use server";

import { revalidatePath } from "next/cache";
import { requireDb } from "@/lib/server/db";
import { attempt, requireEditor, type ActionResult } from "./shared";

/** Actions on report groups. */

/** Replace a hand-kept roster. Refuses an empty list, like the SQL does. */
export async function setRoster(group: string, emails: string[]): Promise<ActionResult> {
  return attempt(async () => {
    await requireEditor();
    const clean = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (clean.length === 0) {
      throw new Error("A roster cannot be emptied: that is always a mistake, never an answer");
    }
    const { error } = await requireDb().rpc("replace_roster", { p_group: group, p_emails: clean });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/rosters");
  });
}

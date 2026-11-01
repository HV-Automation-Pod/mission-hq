"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireDb } from "@/lib/server/db";
import { getViewer } from "@/lib/server/session";
import { attempt, istDay, syncAnswerElsewhere, type ActionResult } from "./shared";

/** A member answering for themselves from the dashboard. */

/** How far back a missed day can still be answered. It is the Zoho push
 *  queue's window: a row older than this would be saved here but never reach
 *  Zoho, which is a worse outcome than refusing it. */
const BACKFILL_DAYS = 60;

/**
 * A member answers for themselves, from the dashboard.
 *
 * The rules are the product decision, so they live here and not in the UI:
 *   - the email is the SESSION's, never a parameter. Nobody can answer for
 *     anybody else through this.
 *   - a past day can be answered only while it is still Pending. Once answered
 *     it is a record, and changing it after the fact is an admin's call.
 *   - today can be answered and changed freely.
 *   - a day nobody asked about (no row) is not theirs to create.
 *   - approved leave belongs to Zoho and is not overwritten.
 *
 * Writes the same row the Slack webhook does, so the 19:30 sweep pushes it to
 * Zoho (`updated_at` is newer than `zoho_pushed_at`). `source` says it came
 * from the dashboard.
 */
export async function answerMyAttendance(day: string, value: string): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await getViewer();
    if (!viewer) throw new Error("Not signed in");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("That is not a valid day");

    const today = istDay();
    if (day > today) throw new Error("You cannot answer for a future day");
    if (day < istDay(-BACKFILL_DAYS)) throw new Error(`Days older than ${BACKFILL_DAYS} days cannot be answered here. Ask People & Culture.`);

    const db = requireDb();
    // Independent reads, so one round trip instead of two.
    const [{ data: row, error: readError }, { data: location }] = await Promise.all([
      db.from("attendance").select("status,source").eq("email", viewer.email).eq("day", day).maybeSingle(),
      db.from("locations").select("status").eq("value", value).eq("active", true).maybeSingle(),
    ]);
    if (readError) throw new Error(readError.message);

    if (!row) throw new Error("You were not asked about that day, so there is nothing to answer.");
    if (row.source === "zoho-leave") throw new Error("Approved leave comes from Zoho and cannot be changed here.");
    if (day < today && row.status !== "Pending") {
      throw new Error("That day is already answered. Past answers cannot be changed.");
    }

    if (!location) throw new Error("Pick one of the listed options.");

    const now = new Date().toISOString();
    const { error } = await db.from("attendance").upsert(
      { email: viewer.email, day, status: location.status, source: "dashboard", answered_at: now, updated_at: now },
      { onConflict: "email,day" },
    );
    if (error) throw new Error(error.message);
    revalidatePath("/");

    // Zoho, the Slack message and the Slack status, after the response has gone:
    // the person is not kept waiting on three other systems.
    after(() => syncAnswerElsewhere(viewer.email, day));
  });
}

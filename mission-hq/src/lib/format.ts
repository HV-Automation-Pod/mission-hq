/**
 * Small formatting helpers shared by the member and admin views. Dates are
 * yyyy-MM-dd strings throughout, and "today" is always IST: Vercel runs in UTC,
 * and between 00:00 and 05:30 IST the UTC date is still yesterday.
 */
import { format, parseISO } from "date-fns";

export const iso = (d: Date) => format(d, "yyyy-MM-dd");
export const dayLabel = (d: string) => format(parseISO(d), "EEE d MMM");
export const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
export const istToday = () => istNow().toISOString().slice(0, 10);

export const initialsOf = (name: string) =>
  name.split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";

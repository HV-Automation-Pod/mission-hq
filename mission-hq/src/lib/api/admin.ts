import type { AdminData } from "@/lib/domain/access-types";
import { apiGet } from "./client";
import { readCache, writeCache } from "./cache";

/**
 * Access list, directory, jobs, people and groups. Admins only: the server checks.
 *
 * An admin's screen needs this AND the attendance payload. Fetching it only
 * after the second one lands (when AdminApp mounts) put the two requests in a
 * row; `prefetchAdminData()` lets the dashboard start it at the same moment.
 * The prefetch is used once, and only while fresh.
 */
const PREFETCH_TTL = 15_000;
let early: { at: number; promise: Promise<AdminData> } | null = null;

export function prefetchAdminData() {
  const promise = apiGet<AdminData>("/api/admin");
  promise.catch(() => { /* the consumer reports it; an unused prefetch stays quiet */ });
  early = { at: Date.now(), promise };
}

export async function fetchAdminData(): Promise<AdminData> {
  const hit = early;
  early = null;
  const data = await (hit && Date.now() - hit.at < PREFETCH_TTL ? hit.promise : apiGet<AdminData>("/api/admin"));
  writeCache("admin", data);
  return data;
}

/** The last admin payload from this tab, to paint while the fresh one loads. */
export const cachedAdminData = () => readCache<AdminData>("admin");

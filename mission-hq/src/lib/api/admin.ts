import type { AdminData } from "@/lib/domain/access-types";
import { apiGet } from "./client";

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

export function fetchAdminData(): Promise<AdminData> {
  const hit = early;
  early = null;
  return hit && Date.now() - hit.at < PREFETCH_TTL ? hit.promise : apiGet<AdminData>("/api/admin");
}

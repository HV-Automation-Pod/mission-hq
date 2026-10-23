import { ApiResponse, parseDepartments } from "@/lib/domain/types";
import { apiGet } from "./client";

/** How far back the first load reaches: enough for the month, last month and a quarter's trend, and quick to build. */
export const DEFAULT_DAYS = 90;
/** The whole archive (it starts in May 2025), for an admin who asks for earlier months. The server allows up to 1000. */
export const FULL_HISTORY_DAYS = 800;

/**
 * The attendance payload for whoever is signed in, with allowances resolved per
 * person. `days` is how far back to read: a wider window costs more to build
 * (the whole archive is about a megabyte and a few seconds), which is why the
 * first load asks for 90 and the rest is on request.
 */
export async function fetchAllData(days: number = DEFAULT_DAYS): Promise<ApiResponse> {
  const data = await apiGet<ApiResponse>(days === DEFAULT_DAYS ? "/api/data" : `/api/data?days=${days}`);
  // Resolve each person's WFA allowance once, here, where the cap, the year
  // boundary and the window's dates are all in hand. Every screen then scores
  // with `scorePeriod(emp.statuses, someDates, emp.allowance)` and none of them
  // has to know the allowance exists.
  //
  // `wfaCap` arrives only once migration 38 is applied. Until then `allowance`
  // stays undefined and WFA scores as fully neutral — the lenient reading, and
  // the one this screen already had.
  const cap = data.wfaCap;
  const yearStart = data.yearStart;

  data.employees.forEach((e) => {
    e.departments = parseDepartments(e.department);
    if (typeof cap === "number" && yearStart) {
      e.allowance = {
        spentBeforeWindow: e.wfaBefore ?? 0,
        cap,
        windowDates: data.dates,
        yearStart,
      };
    }
  });
  return data;
}

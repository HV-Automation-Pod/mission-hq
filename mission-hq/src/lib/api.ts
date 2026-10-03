import axios from "axios";
import { ApiResponse, parseDepartments } from "./types";

export async function fetchAllData(): Promise<ApiResponse> {
  const { data } = await axios.get<ApiResponse>("/api/data");
  if (!data.success) throw new Error(data.error || "Failed to fetch data");
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

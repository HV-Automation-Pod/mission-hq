import axios from "axios";
import { ApiResponse, parseDepartments } from "./types";

export async function fetchAllData(): Promise<ApiResponse> {
  const { data } = await axios.get<ApiResponse>("/api/data");
  if (!data.success) throw new Error(data.error || "Failed to fetch data");
  // Populate parsed departments array for each employee
  data.employees.forEach((e) => {
    e.departments = parseDepartments(e.department);
  });
  return data;
}

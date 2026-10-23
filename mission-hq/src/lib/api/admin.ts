import type { AdminData } from "@/lib/domain/access-types";
import { apiGet } from "./client";

/** Access list, directory, jobs, people and groups. Admins only: the server checks. */
export const fetchAdminData = () => apiGet<AdminData>("/api/admin");

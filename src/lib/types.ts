export type LocationStatus = "Office" | "Home" | "Client Location" | "Split Day" | "Travel" | "Leave" | "Anywhere" | "Pending";

export interface Employee {
  name: string;
  email: string;
  department: string;
  departments: string[]; // individual departments parsed from comma-separated department field
  statuses: Record<string, LocationStatus | string>;
}

/** Parse a comma-separated department string into trimmed individual departments */
export function parseDepartments(department: string): string[] {
  if (!department) return [];
  return department.split(",").map((d) => d.trim()).filter(Boolean);
}

export interface ApiResponse {
  success: boolean;
  error?: string;
  dates: string[];
  employees: Employee[];
  totalEmployees: number;
  totalDates: number;
  fetchedAt: string;
}

export interface WeekCompliance {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  totalWorkDays: number;
  officeDays: number;  // Office + Split Day + Client Location count as "in-office"
  isCompliant: boolean;
  requiredDays: number;
}

export interface EmployeeAnalytics {
  name: string;
  email: string;
  department: string;
  departments: string[];
  office: number;
  home: number;
  clientLocation: number;
  splitDay: number;
  travel: number;
  leave: number;
  anywhere: number;
  pending: number;
  totalDays: number;
  complianceRate: number; // percentage of weeks meeting 4-day requirement
  weeklyCompliance: WeekCompliance[];
  currentStreak: number;          // consecutive recent office days (Office/Client/Split)
  longestStreak: number;          // longest office streak across all dates
  currentAttendanceStreak: number; // consecutive days with any reported status
  longestAttendanceStreak: number; // longest attendance streak
}

export const STATUS_COLORS: Record<string, string> = {
  "Office": "#22c55e",
  "Home": "#3b82f6",
  "Client Location": "#f59e0b",
  "Split Day": "#8b5cf6",
  "Travel": "#ec4899",
  "Leave": "#6b7280",
  "Anywhere": "#06b6d4",
  "Pending": "#ef4444",
};

export const STATUS_BG_COLORS: Record<string, string> = {
  "Office": "bg-green-100 text-green-800",
  "Home": "bg-blue-100 text-blue-800",
  "Client Location": "bg-amber-100 text-amber-800",
  "Split Day": "bg-violet-100 text-violet-800",
  "Travel": "bg-pink-100 text-pink-800",
  "Leave": "bg-gray-100 text-gray-600",
  "Anywhere": "bg-cyan-100 text-cyan-800",
  "Pending": "bg-red-100 text-red-800",
};

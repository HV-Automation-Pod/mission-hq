import { Employee, EmployeeAnalytics, WeekCompliance } from "./types";
import { startOfWeek, endOfWeek, format, parseISO, isWithinInterval, eachWeekOfInterval, isSameWeek } from "date-fns";

const OFFICE_STATUSES = ["Office", "Client Location", "Split Day"];

export function calculateWeeklyCompliance(
  statuses: Record<string, string>,
  dates: string[],
  requiredDays: number = 4
): WeekCompliance[] {
  if (dates.length === 0) return [];

  const sortedDates = [...dates].sort();
  const firstDate = parseISO(sortedDates[0]);
  const lastDate = parseISO(sortedDates[sortedDates.length - 1]);

  const weeks = eachWeekOfInterval(
    { start: firstDate, end: lastDate },
    { weekStartsOn: 1 } // Monday
  );

  return weeks.map((weekStart) => {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

    const weekDates = sortedDates.filter((d) => {
      const date = parseISO(d);
      return isSameWeek(date, weekStart, { weekStartsOn: 1 });
    });

    const officeDays = weekDates.filter(
      (d) => statuses[d] && OFFICE_STATUSES.includes(statuses[d])
    ).length;

    const totalWorkDays = weekDates.length;

    return {
      weekLabel: `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d")}`,
      weekStart: format(weekStart, "yyyy-MM-dd"),
      weekEnd: format(weekEnd, "yyyy-MM-dd"),
      totalWorkDays,
      officeDays,
      isCompliant: officeDays >= requiredDays,
      requiredDays,
    };
  });
}

export function computeEmployeeAnalytics(
  employee: Employee,
  dates: string[],
  requiredDays: number = 4
): EmployeeAnalytics {
  let office = 0, home = 0, clientLocation = 0, splitDay = 0, travel = 0, leave = 0, anywhere = 0, pending = 0;

  dates.forEach((d) => {
    const status = employee.statuses[d];
    if (!status) return;
    switch (status) {
      case "Office": office++; break;
      case "Home": home++; break;
      case "Client Location": clientLocation++; break;
      case "Split Day": splitDay++; break;
      case "Travel": travel++; break;
      case "Leave": leave++; break;
      case "Anywhere": anywhere++; break;
      case "Pending": pending++; break;
    }
  });

  const weeklyCompliance = calculateWeeklyCompliance(employee.statuses, dates, requiredDays);
  const completeWeeks = weeklyCompliance.filter((w) => w.totalWorkDays >= 4);
  const compliantWeeks = completeWeeks.filter((w) => w.isCompliant).length;
  const complianceRate = completeWeeks.length > 0 ? (compliantWeeks / completeWeeks.length) * 100 : 0;

  // Streak calculation
  const sortedDates = [...dates].sort();

  // Office streaks
  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 0;
  for (const d of sortedDates) {
    const s = employee.statuses[d];
    if (s && OFFICE_STATUSES.includes(s)) { streak++; if (streak > longestStreak) longestStreak = streak; }
    else { streak = 0; }
  }
  for (let i = sortedDates.length - 1; i >= 0; i--) {
    const s = employee.statuses[sortedDates[i]];
    if (s && OFFICE_STATUSES.includes(s)) currentStreak++;
    else break;
  }

  // Attendance streaks (any status except Pending or missing)
  let currentAttendanceStreak = 0;
  let longestAttendanceStreak = 0;
  let aStreak = 0;
  for (const d of sortedDates) {
    const s = employee.statuses[d];
    if (s && s !== "Pending") { aStreak++; if (aStreak > longestAttendanceStreak) longestAttendanceStreak = aStreak; }
    else { aStreak = 0; }
  }
  for (let i = sortedDates.length - 1; i >= 0; i--) {
    const s = employee.statuses[sortedDates[i]];
    if (s && s !== "Pending") currentAttendanceStreak++;
    else break;
  }

  return {
    name: employee.name,
    email: employee.email,
    department: employee.department,
    departments: employee.departments || [],
    office,
    home,
    clientLocation,
    splitDay,
    travel,
    leave,
    anywhere,
    pending,
    totalDays: office + home + clientLocation + splitDay + travel + leave + anywhere + pending,
    complianceRate,
    weeklyCompliance,
    currentStreak,
    longestStreak,
    currentAttendanceStreak,
    longestAttendanceStreak,
  };
}

export function getThisWeekDates(dates: string[]): string[] {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  return dates.filter((d) => {
    const date = parseISO(d);
    return isWithinInterval(date, { start: weekStart, end: weekEnd });
  });
}

export function getThisMonthDates(dates: string[]): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  return dates.filter((d) => {
    const date = parseISO(d);
    return date.getFullYear() === year && date.getMonth() === month;
  });
}

export function filterDateRange(dates: string[], from: string, to: string): string[] {
  return dates.filter((d) => d >= from && d <= to);
}

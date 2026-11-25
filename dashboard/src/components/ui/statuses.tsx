import {
  AlertCircle, ArrowLeftRight, Building2, Globe, Home, Leaf, MapPin, Plane, type LucideIcon,
} from "lucide-react";
import { C } from "./theme";

/**
 * One colour, one icon and one short word for every attendance status, so a day
 * reads the same in a calendar, a card and a dialog.
 */
export type View = { verb: string; short: string; Icon: LucideIcon; color: string; bg: string };
export const mk = (verb: string, short: string, Icon: LucideIcon, color: string, bg: string): View => ({ verb, short, Icon, color, bg });

const OFFICE = (v: string, s: string, i: LucideIcon = Building2) => mk(v, s, i, C.office, C.officeSoft);

export const VIEWS: Record<string, View> = {
  "Office":                OFFICE("In the office", "Office"),
  "Office + Client":       OFFICE("Office and client", "Office"),
  "Compensatory WFH":      OFFICE("Compensatory day", "Comp"),
  "Client Location":       OFFICE("At a client site", "Client", MapPin),
  "Travel":                OFFICE("Travelling", "Travel", Plane),
  "Home":                  mk("Working from home", "Home", Home, C.home, C.homeSoft),
  "Half Day WFH Leave":    mk("Half day, home", "Half", Home, C.home, C.homeSoft),
  "Split Day":             mk("Split day", "Split", ArrowLeftRight, C.brand, C.selected),
  "Leave":                 mk("On leave", "Leave", Leaf, C.leave, C.leaveSoft),
  "Half Day Office Leave": mk("Half day, office", "Half", Leaf, C.leave, C.leaveSoft),
  "Anywhere":              mk("Working from anywhere", "Anywhere", Globe, C.primary, C.selected),
  "Pending":               mk("Not answered yet", "Pending", AlertCircle, C.warn, C.warnSoft),
};

/** A status the Locations list adds later still gets a sensible (neutral) look. */
export const viewOf = (s: string): View => VIEWS[s] ?? mk(s, s, MapPin, C.leave, C.leaveSoft);

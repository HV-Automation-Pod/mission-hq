"use client";

import { type PageProps } from "../model";
import { PageHead, PersonalChip } from "../parts/PageHead";
import { MissingCard } from "../parts/MissingCard";
import { CalendarCard } from "../parts/CalendarCard";

export function AttendancePage(p: PageProps) {
  const missed = p.view.missed;
  return (
    <>
      <PageHead crumb="MY WORKSPACE / MY ATTENDANCE" title="My attendance" aside={<PersonalChip />}
        sub="Every day on record. Tap a day marked Answer to fill it in; past answers are read-only." />
      <div className="space-y-6">
        {missed.length > 0 && <MissingCard compact missed={missed} onAnswer={p.onAnswer} onReview={p.onReview} />}
        <CalendarCard {...p} />
      </div>
    </>
  );
}

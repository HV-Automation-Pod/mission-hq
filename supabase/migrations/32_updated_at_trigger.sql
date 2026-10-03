-- ===========================================================================
-- `updated_at` maintained by the database, not by whoever happens to be writing.
--
-- The Zoho push queue asks "has this row changed since we last sent it", which
-- is `updated_at > zoho_pushed_at`. That only works if every writer remembers
-- to set `updated_at`, and the edge function does — but a dashboard edit, a
-- correction typed into the SQL editor, or any future caller that forgets it
-- leaves the row looking already-pushed. Zoho then never hears about the
-- change, and the muster roll disagrees with the record in a way nobody can
-- see.
--
-- Proven rather than assumed: a PATCH setting only `status` left the row out of
-- `zoho_push_queue` entirely.
--
-- A trigger cannot be forgotten. `updated_at` is now the database's statement
-- about when the row last changed, which is what every reader already believed
-- it was.
--
-- `zoho_pushed_at` is deliberately exempt. Stamping a row as sent is not a
-- change to the attendance itself, and bumping `updated_at` there would put
-- the row straight back in the queue it just left, for ever.
-- ===========================================================================

create or replace function "mission-hq".touch_updated_at_()
returns trigger
language plpgsql
as $$
begin
  -- Marking a row as pushed is bookkeeping, not an edit. Without this guard the
  -- push stamps the row, the stamp bumps updated_at, and the row is owed again
  -- on the next run: an infinite push loop against a rate-limited API.
  if new.zoho_pushed_at is distinct from old.zoho_pushed_at
     and new.status      is not distinct from old.status
     and new.source      is not distinct from old.source
     and new.answered_at is not distinct from old.answered_at then
    return new;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch_updated_at on "mission-hq".attendance;
create trigger touch_updated_at
  before update on "mission-hq".attendance
  for each row execute function "mission-hq".touch_updated_at_();

comment on function "mission-hq".touch_updated_at_() is
  'Keeps attendance.updated_at honest so the Zoho push queue can trust it. '
  'Skips rows whose only change is zoho_pushed_at, or the push would re-queue '
  'everything it just sent.';

-- ===========================================================================
-- `delete from <table>` with no WHERE is rejected here.
--
-- Supabase runs the API roles with `safeupdate` on, which raises 21000
-- "DELETE requires a WHERE clause" on an unqualified delete. It is a guard
-- against exactly the accident this statement looks like, and being inside a
-- security-definer function does not exempt it — the setting follows the
-- session, not the function's owner.
--
-- `where true` says the same thing deliberately rather than by omission, which
-- is the distinction the guard is drawing.
--
-- The first run of migration 40's function failed on this, and nothing broke:
-- the snapshot stayed empty and migration 41's fallback kept the audit on the
-- old freshness rule. That was the point of writing the fallback.
-- ===========================================================================

create or replace function "mission-hq".sync_slack_accounts(p_rows jsonb)
returns table (total int, humans int, guests int, bots int, deactivated int)
language plpgsql
security definer
set search_path = "mission-hq", public
as $$
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'sync_slack_accounts: refusing to replace the snapshot with an empty list';
  end if;

  delete from "mission-hq".slack_accounts where true;

  insert into "mission-hq".slack_accounts
    (slack_user_id, email, display_name, is_bot, is_guest, deleted, synced_at)
  select
    r->>'id',
    lower(nullif(r->>'email', '')),
    nullif(r->>'name', ''),
    coalesce((r->>'is_bot')::boolean, false),
    coalesce((r->>'is_guest')::boolean, false),
    coalesce((r->>'deleted')::boolean, false),
    now()
  from jsonb_array_elements(p_rows) r
  where r->>'id' is not null
  on conflict (slack_user_id) do nothing;

  return query
    select count(*)::int,
           count(*) filter (where not is_bot and not is_guest and not deleted)::int,
           count(*) filter (where is_guest)::int,
           count(*) filter (where is_bot)::int,
           count(*) filter (where deleted)::int
      from "mission-hq".slack_accounts;
end $$;

grant execute on function "mission-hq".sync_slack_accounts(jsonb) to service_role;

# Code Review Rules - mission-hq

> The review standard for this repo. Applies to every review here, by a person or an agent.
> No change-specific content lives in this file: findings go in the report (§8) or on the PR,
> and what lands here is only the rule that outlived them.

**What this repo is now.** One Next.js dashboard and a set of Supabase Edge Functions, all
reading one Postgres schema. The Google Apps Script project it replaced is gone from these
rules; if you are reviewing a change that still touches `mission-hq-app-script/`, you are
reviewing legacy and should say so in the report rather than applying these rules to it.

```text
mission-hq/                     Next.js 16 dashboard (TypeScript, React 18) -> Vercel
supabase/functions/*            Supabase Edge Functions (Deno, TypeScript)
supabase/migrations/*.sql       The schema. "mission-hq" schema in the WeCare project.
```

| | |
|---|---|
| Production dashboard | https://mission-hq-dashboard.vercel.app |
| Supabase project | WeCare, `jsehiivvzalvcrlybmlf` |
| Schema | `"mission-hq"` (quoted everywhere; the hyphen is not optional) |
| Remote | `github.com/HV-Automation-Pod/mission-hq` - use `gh`, not `glab` |

---

## 0. Ground rules

- **Verify before asserting.** Every claim must be confirmed against the real files at the
  revision under review, not inferred from the diff, not from memory, and **not from
  `CLAUDE.md`**. CLAUDE.md is design intent and it drifts. If a claim cannot be reconfirmed
  against code, drop it or downgrade it to a question.
- **Verify the DEPLOYED thing, not only the diff.** A branch that is correct and a production
  that is serving something else are a normal state here, and the gap is invisible from the
  code. §4.0 is not optional.
- **Never commit, push, or edit as part of a review.** Review only.
- **One consolidated report**, not per-line notes, unless explicitly asked otherwise.
- **Work normally lands on a branch and a PR** for migrations and architecture; small fixes
  go straight to `main`. So the review target is a PR, a commit range, or a working tree.
  Handle all three (§1).
- **Em dashes: fine in code comments, commit bodies and these notes. NEVER in user-facing
  text** - Slack message copy, alert bodies, dashboard labels, tooltips, anything rendered
  to a person. An em dash in a user-visible string is a finding.
- **`Co-Authored-By:` trailers are the house style on commits.** Do not flag them. What must
  never carry AI attribution is anything **outward-facing**: a Slack DM to the org, a summary
  posted to a group channel.
- **A change to attendance semantics usually has to land in more than one place** (§3.6).
  Reviewing only the file that changed is how the divergences in this repo got created.

---

## 1. Gather

**Working-tree review (the default):**

```bash
git -C . status --short
git diff                     # unstaged
git diff --cached            # staged
git diff --stat HEAD
```

**PR review:**

```bash
gh pr view <N> --json title,body,headRefName,baseRefName,files
gh pr diff <N>
git log --oneline <base>..<head>
```

**Always also:**

```bash
git log --oneline -15                     # house style, recent intent
ls supabase/migrations | tail -8          # has the migration been applied?
```

Read the **whole** file for anything the diff touches. A hunk that looks safe is usually safe
because of something fifty lines away.

---

## 2. Verify mechanically

Before writing a word of the report:

```bash
cd mission-hq && npx tsc --noEmit -p .    # MUST be clean. Deploying past this has
npx next build                            # fired a real production alert before.
deno check supabase/functions/<fn>/index.ts
```

- **A migration is a claim about production until you check.** `create or replace view`
  cannot insert a column mid-list (42P16) and `create or replace function` cannot change a
  return type (42P13). Both need an explicit `drop` first. Check whether the migration under
  review has actually been applied, and say which.
- **`delete from <table>` with no `WHERE` is rejected** by Supabase's `safeupdate` guard
  (21000), including inside a `security definer` function. Write `where true`.
- **Reproduce the number.** If the change touches a reported figure, compute it both ways
  against the real database and put the comparison in the report. "345 of 348 matched, and
  the three misses were the WFA cap" is a review; "looks correct" is not.

---

## 3. Repo-specific hard rules

### 3.1 The lost-response invariant - the rule that matters most here

**Three states, and they are not interchangeable:**

```text
no row            nobody asked this person on this day. NOT a miss.
row = 'Pending'   asked, and they ignored it. IS a miss.
row = a status    answered.
```

| # | Rule |
|---|---|
| 1 | **A missing row is "never asked" and leaves the denominator; `'Pending'` is "asked and ignored" and stays in it.** Conflating them is what dragged a whole team to the bottom of a published ranking. 🔴 whenever it reaches a reported number. |
| 2 | **The row is written BEFORE the DM goes out**, so a crash between them leaves a person askable rather than silently marked. Any reordering is 🔴. |
| 3 | **A blank is never upgraded to `Pending` by a backfill.** |

### 3.2 Alerting

- Every scheduled job reports failure to the alert channel. A job that can fail silently is a
  job nobody knows is broken.
- **Alert bodies must not name individuals when the alert can fire per-row** - channel volume,
  and it is a shared engineering channel.
- No token, no full request payload, no signed URL in an alert body. Function name, counts,
  dates, a short reason.
- **A partial success is an alert.** "Refreshed 60 of 63" is the interesting case.

### 3.3 Postgres and PostgREST

| # | Rule |
|---|---|
| 4 | **The schema is `"mission-hq"`, quoted.** PostgREST needs `Accept-Profile` (reads) or `Content-Profile` (writes) to reach it. A call that omits them silently hits `public`. |
| 5 | **PostgREST caps a response at 1000 rows.** Any client-side aggregate over a table read without paging is wrong, and wrong in a way that looks plausible. This already made every report say "3 working days". Aggregate server-side or page explicitly. |
| 6 | **Plain CTEs are inlined since PG12 and re-run per reference.** `as materialized` on anything referenced more than once. The tell that this is the problem: a smaller window being *slower* than a larger one. This took `dashboard_payload` from 4-5s to 1.2s. |
| 7 | **A machine-owned table is replaced wholesale, and a replace that resolves to zero rows throws instead of blanking it.** `replace_roster` and `sync_slack_accounts` both refuse an empty list. A transient Slack failure must not empty a roster and take a report down with it. 🔴 to remove that guard. |
| 8 | **`security definer` functions set `search_path` explicitly.** |

### 3.4 Dates, IST, and the work calendar

| # | Rule |
|---|---|
| 9 | **Never `new Date("2026-08-19")`.** That parses as UTC and slips a day in IST, which would move the whole Wednesday rule by one weekday. Build from parts, or use an explicit `+05:30` offset. 🔴 if it feeds a weekday or a date lookup. |
| 10 | **"Today" is `today_ist()`, in SQL, once per query.** Not `now()`, not the runtime's clock. |
| 11 | **Weekends and holidays are the absence of an attendance row, not a hardcoded list.** A client-side `HOLIDAYS` set needs editing every January and disagrees with the database the moment PnC moves a holiday. A new hardcoded holiday array is 🔴. |

### 3.5 Attendance semantics - the numbers PnC reads out

**Anything that changes a number a person sees about themselves is automatically 🔴.** These
definitions were argued out with PnC and got publicly wrong twice.

```text
prompted    = days an attendance row exists
available   = prompted - leave - WFA within the annual cap
adherent    = office days + WFH days that fell on a WEDNESDAY
Standard    = adherent / available          (the ranking metric)
```

| # | Rule |
|---|---|
| 12 | **Wednesday WFH counts in full.** Wednesday is the *default* WFH day, not a deduction: four office days plus a Wednesday at home is **100%, not 80%**. WFH on any other weekday is the miss. No carve-outs, including the WFH half of a Split Day. Reintroducing a Wednesday penalty is 🔴. |
| 13 | **A day is not all-or-nothing.** Every status's weights sum to 1 (checked by a `do $$` block in migration 12). Counters are fractional - compare with a tolerance, never `===`, and render `9.5` / `10`, never `10.0`. A new status whose weights do not sum to 1 silently inflates a denominator. |
| 14 | **The WFA cap is consumed oldest-first** and lives in `settings`, not in code - it has already moved once (10 → 15). A hardcoded `15` in new copy is a finding. |
| 15 | **The top two tiers are day counts, not percentages.** That is the point of the standard: it is about *which* days. Do not "fix" it into a percentage threshold. |
| 16 | **Members with `available == 0` are not ranked** - a week of leave is not a failed week. They are noted, not dumped into the bottom tier. |
| 17 | **Group membership rules are not interchangeable.** A `column` matcher reads a Zoho-synced column and is overwritten on every sync, so a group nobody maintains in Zoho cannot be selected that way. A new `column` group needs an argument for why that column is actually maintained. 🔴 - it produces a confidently wrong report. |
| 18 | **State is written only after a successful REAL send.** Test and preview paths write nothing; a preview that saves scores corrupts the next delta, and the damage surfaces a fortnight later as *missing* deltas. |
| 19 | **Periods are non-overlapping halves, both fully finished, and neither includes the run day.** |

### 3.6 One rule, one answer

The dashboard and the fortnightly Slack report must not disagree about the same person. They
did: the dashboard counted `officeDays >= 4` while Slack counted
`(office + Wednesday WFH) / available`, so somebody following the policy exactly scored 3/4
on one screen and 100% on the other.

| # | Rule |
|---|---|
| 20 | **`mission-hq/src/lib/policy.ts` is a deliberate mirror of `member_metrics()`.** A change to either must land in both in the same commit. The file says so; keep that true. 🔴 when they diverge. |
| 21 | **Verify a port numerically, not by reading it.** The accepted evidence is a run of both against the real database with a count: "348 of 348". |
| 22 | **`OFFICE_STATUSES`-style literals must not reappear.** Scoring belongs in `policy.ts`; a component that re-derives "is this an office day" from a string list is the bug class above, coming back. |
| 23 | **A new status value lands in the `locations` table, the weights, and `DAY_WEIGHTS` in `policy.ts` together.** |

### 3.7 Edge functions

| # | Rule |
|---|---|
| 24 | **Slack's 3-second timeout is why the submit path is split.** The handler verifies, parses, hands off to `EdgeRuntime.waitUntil()` and returns. Any new `await` **before** that return is 🔴. |
| 25 | **`verify_jwt = false` is correct and must stay** for the Slack-facing function. Slack does not send Supabase JWTs; authenticity is the signature check. "Fixing" this breaks every interaction. |
| 26 | **A signature failure returns HTTP 200 with an empty body**, on purpose, so Slack does not retry what will never verify. Do not turn it into a 401. |
| 27 | **Never remove the signature check, never widen the replay window, never turn the constant-time compare into `===`.** 🔴 each. |
| 28 | **Errors can arrive inside a 200 body.** Zoho's `bulkImport` does exactly this. Checking only the HTTP status is 🔴. |
| 29 | **Loops over the org are paced and bounded.** Slack's `chat.postMessage` limit is per-channel, and every DM is its own channel - which is what makes the worker pool safe. A new unpaced call in a whole-org loop will 429 partway and leave the run half-done. |
| 30 | **A courtesy must not fail the thing it is reporting on.** The access-grant DM is sent after the write and cannot throw; the grant stands if Slack is down, and the reason is returned for the UI to show. |

### 3.8 Deployment - a pushed change is not a shipped change

| # | Rule |
|---|---|
| 31 | **Three things ship separately and none implies the others**: the migration (SQL editor or CLI), the edge function (`supabase functions deploy <fn> --project-ref <ref>`), and the dashboard (Vercel, on push). A report saying "deployed" must say *which*. |
| 32 | **A changed Supabase secret needs a function redeploy.** Setting the secret alone does nothing. |
| 33 | **Verify against the live URL, not the logs.** An unauthenticated request to production is the quickest proof of what it actually runs (§4.0). |
| 33a | **A scheduled job is not verified until a TICK has landed.** `cron.job` says what is scheduled and shows green whether or not it works; `cron.job_run_details` says what happened. That gap hid a dead cycle for its entire life. The name is on `cron.job` and the outcome on `cron.job_run_details`, so it is a join on `jobid` — `job_run_details` has no `jobname` column. And `status = 'succeeded'` means the HTTP POST was dispatched, not that the function did anything: `net.http_post` is asynchronous, so the function's own outcome is in the alert channel or `net._http_response`. |
| 34 | **A migration that adds a column the client reads must ship before the client that reads it**, or be written to degrade. The client-side WFA allowance does this: absent `wfaCap`, it scores WFA as fully neutral rather than breaking. |
| 35 | **A new dashboard env var goes in `.env.example` with a comment** and must be set in Vercel. `.env*` is git-ignored; `.env.example` is the source of truth for what is required. |

### 3.9 Dashboard conventions

| # | Rule |
|---|---|
| 36 | **`import "server-only"` stays** on `src/lib/db.ts`, `session.ts` and `admin-queries.ts`. It is the thing stopping the service-role key reaching the browser. Removing it to fix a build error is 🔴. |
| 37 | **No client file reads `process.env` except `NEXT_PUBLIC_*`.** |
| 38 | **Every server action re-checks the viewer.** A server action is a public endpoint with a generated name, not a private function: checking permission in the page that draws the button protects the button, not the action. 🔴 for a mutation that trusts its caller. |
| 39 | **Scoping is enforced in SQL, not in the UI.** `dashboard_payload(p_email)` means a member's request never loads another person's attendance into the process at all. A filter applied after fetching is a presentation choice, not a control. 🔴 to replace one with the other. |
| 40 | **Derivations over the full employee set stay in `useMemo`.** The search box re-renders on every keystroke; ~376 employees × ~350 dates in a component body is 🟡 minimum. |
| 41 | **Tooltips use the app's own `Tooltip` component, never `title=`.** `title=` cannot be styled, ignores the theme, never appears on touch, and is swallowed entirely by a disabled button - which is exactly where the explanations matter. |
| 42 | **Theme: `darkMode: "class"` in the Tailwind config, matching the `.dark` class the toggle writes.** The default is `"media"`, which reads the OS instead, and the result is a page that is light and dark at once. Any change that reintroduces two sources of truth for the theme is 🔴. |
| 43 | **Colour tokens are picked against a measured contrast ratio.** Body text ≥ 4.5:1 against its surface. Add the number to the report, do not eyeball it. |

---

## 4. Security review - no data leaked

Run this on every review, not only on ones that look security-shaped. State "nothing material"
rather than omitting it.

**These five are hard requirements. A change that weakens any of them is 🔴 and blocks.**

### 4.0 No data is exposed to the internet

**Check this against PRODUCTION, every review. The code being right is not the question.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://mission-hq-dashboard.vercel.app/api/data
curl -s -o /dev/null -w '%{http_code}\n' https://mission-hq-dashboard.vercel.app/api/admin
curl -s -I https://mission-hq-dashboard.vercel.app/ | head -1
```

- **Every one of those must redirect to `/login` or return 401/403 without a session cookie.**
  A `200` with a body is a live disclosure and the review stops there until it is fixed.
- **No endpoint returns org data to an unauthenticated caller. None.** Not a "public" summary,
  not a count, not a health check that names a person.
- **`cache-control` on anything viewer-scoped is `private, no-store`.** A `public` cache header
  on a per-viewer payload hands one person's view to the next caller through a CDN.
- **A new route under `src/app/api/` must call `getViewer()` as its first act** and return 401
  when it is null. Being behind middleware is not enough on its own - middleware is the outer
  door, the route check is the lock.

### 4.1 Authentication must be there

- **There is no anonymous path to anything.** `middleware.ts` redirects every unauthenticated
  request to `/login`, and its matcher covers `/api/*` - the only exclusions are static assets.
  Narrowing that matcher is 🔴.
- **Middleware decides SIGNED IN. `getViewer()` decides ALLOWED.** Middleware runs without
  database access, and an auth check that cannot see the allowlist is not an auth check. Both
  must stay.
- **The domain check is the membership test.** A company Google account is proof of
  employment, which is all a *member* needs to be. It is not proof of anything else.
- **Admin is a separate, explicit row in `dashboard_access`**, never inferred from a domain, a
  department, or a job title. `can_edit` is a third level again.
- **A member's request must never load another person's attendance into the process.** Enforced
  by passing the email into SQL, not by filtering the response (§3.9, rule 39).

### 4.2 No public data available

- **No table, view or function is reachable by `anon`.** The `"mission-hq"` schema is not
  granted to it at all; the correct response to an anon request is
  `42501 permission denied for schema "mission-hq"`. Verify, do not assume:

  ```bash
  curl -s "$URL/rest/v1/employees?select=*&limit=1" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Accept-Profile: mission-hq"
  ```

- **That check covers `public` too.** WeCare's `public.employees` and `public.identity_links`
  carry the same people. Both must deny `anon`.
- **A new `grant ... to anon` is 🔴 and needs an explicit argument.** There is currently none,
  and that is the design.
- **No Supabase storage object with `getPublicUrl()` may carry attendance data or a person's
  record.** Public URLs are unguessable-only, which is not a control.
- **RLS stays enabled** on every table in the schema.

### 4.3 Strict about the anon key and the URL

- **Nothing prefixed `NEXT_PUBLIC_` may be a secret.** `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` ship to the browser by design - they are what the auth
  client needs to sign a person in and out. A new `NEXT_PUBLIC_*_KEY` / `_SECRET` / `_TOKEN`
  is 🔴.
- **That is only safe because of §4.2.** The anon key is a public identifier of the project,
  not a credential, *as long as it can read nothing*. The two rules are one rule: if anon ever
  gains a grant, the key in the bundle becomes a disclosure. Re-run the §4.2 check whenever a
  grant changes.
- **`SUPABASE_SERVICE_ROLE_KEY` is unprefixed and server-only**, reached through a module that
  carries `import "server-only"`. It must never appear in a client component, a `NEXT_PUBLIC_`
  var, a log line, or an error returned to the browser.
- **No key, token, signing secret or project ref in code, in a log line, or in `CLAUDE.md`.**
  A literal `xoxb-…` or a JWT in the diff is 🔴 and needs the credential **rotated**, not just
  removed - it is in the reflog and in anyone's clone.
- **No real values in `.env.example`.** Placeholders only.
- **Scan the branch history, not just the tree**, before a PR:

  ```bash
  for p in "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" "xoxb-" "xoxp-" "SERVICE_ROLE_KEY="; do
    echo "$p -> $(git log main..HEAD -S"$p" --oneline | wc -l)"
  done
  ```

  A hit is 🔴 even if a later commit removed it.

### 4.4 No personal data in git

The database holds the whole org: full names, work emails, departments, locations, Zoho
employee ids, Slack user ids, and a day-by-day record of where every person physically was.
**None of it belongs in the repository.**

- **No real email address, employee name, employee id or Slack user id in a migration, a
  comment, a commit message, a test fixture or a markdown file.** This has gone wrong four
  times in this repo: twice in migrations that embedded named people with percentages, once
  in a migration comment naming a deactivated employee, and once in a comment listing three
  guest accounts by address. 🔴 each time.
- **The pull is always toward a real example**, because a real one makes the argument
  concrete. It is not needed. Counts and categories carry the same weight: "seven accounts
  deactivated in the previous fortnight" says what three names say.
- **Scan before every PR:**

  ```bash
  git log main..HEAD -p | grep '^+' | grep -ohE '[a-zA-Z0-9._%+-]+@hyperverge\.co' | sort -u
  ```

  Placeholders (`name@`, `example@`) are fine. Anything else is a finding.
- **Known exception, documented not excused:** `supabase/migrations/33_dashboard_access.sql`
  seeds one real address as the bootstrap admin, and it is already pushed. Somebody has to be
  able to sign in first. Worth parameterising; not worth rewriting pushed history for. **Do
  not let it become a precedent for a second one.**
- **The org-tree payload carries far more than the syncs use** - designation, employment type,
  reporting manager, date of exit, plus DOB, addresses, PAN, Aadhaar, personal email and
  mobile. **Never widen a sync into the personal fields.** 🔴.
- **`TeamEmailID` on a Zoho leave record is the reporting MANAGER's email, not the
  employee's.** Reading it as the employee marked a manager as `Leave` and silently
  suppressed their prompts. Matching is by `EmployeeId`, falling back to normalised name. Any
  change to that join is 🔴.
- **A Slack summary is read by more people than the dashboard is.** Group snapshots name
  individuals and rank them. Adding a field to a ranking row - a department, a location, a
  manager's name, an employee id - is a disclosure decision about a named person. Ask.
- **`POST /api/feedback` is unauthenticated** and writes user-supplied fields plus a
  screenshot and a screen recording to storage. Any change that puts attendance data or more
  page state into that payload widens it. 🟡, or 🔴 if it carries a person's record.

---

## 5. Correctness review

- **Trace every reader.** A change to a shared helper is a change to everything that calls it.
- **Ask what happens when the external thing is down.** Slack 429s, Zoho returns an error
  inside a 200, the sync has not run. Each should degrade to something a human can see, not to
  a wrong number.
- **Ask what happens on the second run.** Re-running a job must be safe; that is what makes
  recovery possible.
- **Check the boundary.** First of the month, a week clipped by the window, a person who
  joined mid-period, somebody with nothing available at all.
- **A fallback is a feature and needs its own check.** The one that kept the audit working
  when `slack_accounts` was empty earned its place the first time the populating job failed.

## 6. Performance, quota and cost

- **Per-employee API calls in a whole-org loop** are the recurring cost mistake. Cache the
  Slack user id; resolve through a join, not a lookup.
- **`dashboard_payload` is the hot path.** It is 90 days by default for a reason. A change
  that widens the default window needs a measurement.
- **PostgREST paging** (§3.3, rule 5) is a correctness issue before it is a performance one.

## 7. Severity rubric

| | |
|---|---|
| 🔴 | Data disclosure, a wrong number a person sees about themselves, a lost response, a silent write to the wrong record, a credential, personal data in git. |
| 🟡 | A failure that is invisible, a divergence between two surfaces, an unbounded loop, a missing guard that has not bitten yet. |
| 🟢 | Naming, duplication, a comment that no longer matches the code. |

## 8. Report format

```markdown
## Code review

**Scope.** <what was reviewed, at which revision>
**Verified.** <commands actually run, and what they returned>

### 🔴 High
#### H1. <one-line claim>
<file:line> - what is wrong, the concrete failure (inputs → wrong output), the fix.

### 🟡 Medium   ### 🟢 Low / polish

### 🔒 Security
<the five checks in §4, each with its result. "Nothing material" is a valid answer,
silence is not.>

### ⚡ Improvements
```

Rank most-severe first. Every finding needs a concrete failure scenario, not a category.

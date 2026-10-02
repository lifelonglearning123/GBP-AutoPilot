# GBP Autopilot bug review

Date: 2 October 2026. Code reviewed: commit `336021d`. No application code was changed.

## Summary

28 entries are listed, worst first within each group. 23 of them have a reproduction script in `docs/repro/` that fails today and will pass once the bug is fixed. Four more were reproduced by hand against the app in mock mode. The last (28) is a list read from the code and not run. One variant of bug 3 is marked suspected.

The ones that matter most to a paying client are the ones where the app writes to their Google profile when it should not:

- **Review replies can be wrong or unwanted.** A reply drafted for a 5-star review is still posted after the customer edits it to a complaint (bug 1). "Post all" overwrites a reply the owner wrote themselves on Google (bug 1). Switching on automatic replies for a newly linked business answers every old unanswered review at once, however old (bug 2).
- **Things already dealt with can be sent again.** A discarded post can be published, a rejected profile suggestion can be applied, a posted photo can be uploaded again, and two overlapping presses of Publish create two posts (bugs 4 and 5).
- **A failed weekly post repeats every five minutes** with a newly written post each time (bug 3).
- **A setting switched off during a scheduler run is ignored**, and the schedule is switched back on (bug 6).
- **Any web page open in the same browser can change settings**, including switching automatic replies on (bug 7).

The second group produces wrong numbers in client reports: a search outage is reported as "not found anywhere" or "0 listings" (bugs 9, 10, 11), correct listings are marked "Wrong details" (bug 12), and a business with 250 reviews is reported as having 200 (bug 13).

One bug deletes files: a website build can wipe every client report (bug 8).

## How this was done

- **Run first.** A copy of the app was installed from the lock file and run in mock mode (`GBP_MOCK=1`) on a spare port, so the real database and the real app on port 3320 were never touched. Typecheck passes. Every page was requested and every action in `src/app/api/action/route.ts` was triggered, including double submits. Pages were then opened in a browser; no console errors appeared.
- **Then read.** Every file in `src/lib` was read with the eight risk areas in mind.
- **Reproduction scripts.** Each script runs in a throwaway folder with its own empty database. Google, Serper and the AI are replaced by local stand-ins, so nothing real is contacted. Each script asserts the correct behaviour.

  ```
  npx tsx docs/repro/01-weekly-post-loop.test.mts
  ```

  `tsx` is not a dependency of the project; `npx` fetches it. Scripts 05 and 07 take 10 to 25 seconds because they wait out the app's own retries.
- **Limits.** No Serper key was used, so the live search paths were exercised only through stand-ins. Nothing was tested against a real Google profile.

---

## Writes to Google

### 1. Review replies do not follow the review

- **Where:** `src/lib/reviews.ts:37-39`, `:52`, `:103-111`, `:124-130`.
- **Trigger and result:**
  - (a) A customer leaves 5 stars, a reply is drafted, then the customer edits the review to 3 stars and a complaint. The next check stores the new text but keeps the old draft as "ready". "Post all" sends it. In the script, a review that now reads "the sockets stopped working" received the reply "So glad you loved the rewire!".
  - (b) If the AI is down when a new review is first seen, the review is marked `failed` and is never drafted again, because only reviews with status `none` are drafted (`:52`). With automatic replies on, that review is never answered.
  - (c) The owner replies on Google directly. Before the next hourly check, someone presses "Post all". The app's draft replaces the owner's reply, because `post()` sends without first checking whether Google already holds a reply.
- **Should happen:** a draft is discarded and rewritten when the review's text or rating changes; a failed draft is retried on the next check; nothing is posted over an existing reply.
- **How bad:** a cheerful reply under a complaint is public and embarrassing. Overwriting the owner's own words is worse.
- **Fix:** in the upsert, reset `draft_status` to `none` and clear `draft_reply` when `comment` or `rating` differs from the stored row. Treat `failed` like `none` at `:52`. In `postAll`, poll first (or re-read the review) and skip any that now has a reply.
- **Reproduction:** `14-stale-and-stuck-review-drafts.test.mts`.

### 2. Automatic replies answer every old review at once

- **Where:** `src/lib/reviews.ts:52-58`.
- **Trigger:** switch on "Reply to new reviews automatically" for a business before its first review check, which is the normal state of a newly synced or newly linked profile.
- **Result:** the first check replies to every unanswered review Google returns, with no age limit. In the script, replies went to reviews written in 2019, 2020 and 2021.
- **Should happen:** only reviews that arrive after the setting is on are answered without a person. Alerts already do this with a 14-day limit (`src/lib/alerts.ts:18`).
- **How bad:** a client sees dozens of replies appear on years-old reviews on day one, all in one minute.
- **Fix:** auto-post only when the review's `createTime` is within the last 14 days; older ones are drafted and left for approval.
- **Reproduction:** `22-auto-reply-answers-old-reviews.test.mts`.

### 3. A weekly post that fails is rewritten and resent every five minutes

- **Where:** `src/lib/posts.ts:118-123` (`runWeekly`).
- **Trigger:** Google refuses the weekly post, for any reason: a bad button link, a policy refusal, a server error.
- **Result:** `publish()` throws before the schedule is moved on, so `next_post_at` stays in the past. Every tick writes a new post with the AI and sends it again. After three ticks the script shows three posts written, three sends and three AI calls.
- **Should happen:** one attempt, the failure shown, the schedule moved on.
- **How bad:** AI spend every five minutes for as long as it fails, a Posts tab filling with failed drafts, and repeated calls to Google.
- **Suspected, worse variant:** if a call times out after Google has accepted the post, the post is marked failed and the same loop publishes a different post every five minutes. Not reproduced; it follows from the same code.
- **Fix:** move `next_post_at` on before generating, or in a `finally`. Leave the failed post for a person to retry.
- **Reproduction:** `01-weekly-post-loop.test.mts`.

### 4. Things already dealt with can be sent to Google again

- **Where:** `src/lib/posts.ts:88` (only `posted` is refused), `src/lib/suggest.ts:144-150` (no status check), `src/lib/extras.ts:29-35` (no status check).
- **Trigger:** an old tab, a second press, or a stale button.
- **Result:** a discarded post is published; a rejected description draft is written to the profile; a photo already posted is uploaded again. All three also happened by hand in the running app: a rejected categories suggestion was applied, a rejected post was published, and one photo was posted twice.
- **Should happen:** each write checks the row is still waiting.
- **How bad:** content a person explicitly rejected goes live on the client's profile.
- **Fix:** `publish` accepts only `draft` and `failed`; `apply` only `pending`; `postPhoto` only `queued`.
- **Reproduction:** `04-status-guards.test.mts`.

### 5. Two overlapping presses of Publish create two posts

- **Where:** `src/lib/posts.ts:85-96`.
- **Trigger:** two tabs, a double click, or the scheduler and a person at the same moment.
- **Result:** both calls read the status as `draft`, and both send. Google creates a new post on every call, so the profile shows the post twice.
- **Fix:** claim the row first with `UPDATE posts SET status = 'posting' WHERE id = ? AND status IN ('draft','failed')` and continue only if a row changed.
- **Reproduction:** `03-post-published-twice.test.mts`.

### 6. A setting switched off during a scheduler run is ignored, then switched back on

- **Where:** `src/lib/scheduler.ts:57` reads every business once and works from that copy; `src/lib/posts.ts:121-122` then acts on the stale `auto_post` and writes a new `next_post_at`.
- **Trigger:** save "weekly post: off" for a business while the tick is still busy with another business. A tick with several businesses takes many seconds.
- **Result:** the post is published anyway, and the schedule that was just switched off is given a new date.
- **Fix:** re-read the location at the start of each business's turn and again just before publishing.
- **Reproduction:** `21-auto-post-switched-off-mid-tick.test.mts`.

### 7. Another website open in the same browser can change settings

- **Where:** `src/app/api/action/route.ts:137-139`. The route accepts any POST whose body parses as JSON, whatever its content type or origin.
- **Trigger:** reproduced by hand: a request with `Content-Type: text/plain` and a foreign `Origin` header set `auto_reply` to on and `hold_low_stars` to off.
- **Result:** any page open in the same browser can trigger any action against the local app, including switching on automatic replies, publishing a post or applying a suggestion.
- **Fix:** refuse requests whose `Origin` is present and is not the app's own, and require `Content-Type: application/json`.
- **Reproduction:** by hand; no script.

## Lost data

### 8. Building a website can delete every client report

- **Where:** `src/lib/site.ts:256-259`. The folder name comes from Settings ("Folder name for the pages") and is used as a path, then emptied with `rmSync` before each build. `src/lib/locations.ts:156` accepts the value unchecked.
- **Trigger:** set the folder name to `reports` and build the site.
- **Result:** `output/reports/`, which holds every client's report, is deleted. A name of `..` would point the delete at the app folder; that was not tried.
- **Fix:** slugify the value on save, refuse `reports` and anything containing a path separator or dots, and build sites under their own parent such as `output/sites/<slug>`.
- **Reproduction:** `11-site-build-deletes-reports.test.mts`.

## Failures recorded as results

### 9. A failed map is reported as "not found anywhere"

- **Where:** `src/lib/grid.ts:242` records each point's failure, but `:254-256` marks the run `done` regardless and pushes the next re-map a month out.
- **Trigger:** Serper is out of credits or failing when a map runs.
- **Result:** the run is stored with a share of 0%. The page and the client report say "Not in the first 20 anywhere on the map … not even at the business's own address."
- **Should happen:** the README rule that a failure is never recorded as "no results". A run where most points failed should be `error`, not `done`.
- **How bad:** a client is told they are invisible on Maps when the truth is nobody looked.
- **Fix:** if more than a small share of points failed, mark the run `error`, do not move `next_grid_at`, and leave failed points out of the wording.
- **Reproduction:** `05-map-failure-reads-as-not-found.test.mts`.

### 10. A search outage during a citation audit is scored as "0 listings found"

- **Where:** `src/lib/citations.ts:159-162` swallows every search failure; `:274-275` carries on with an empty list.
- **Result:** the consistency check is scored 0 of 15 with the note "0 listings found", and 13 directories are listed as "Not listed on".
- **Fix:** count failed searches in `discover`; if all (or most) failed, throw, so no run is stored.
- **Reproduction:** `06-citation-search-failure-scored-as-zero.test.mts`.

### 11. Search checks store failures as results

- **Where:** `src/lib/keywords.ts:319`, `:377`, `:389` and `:226-229`, `:339`, `:383-384`.
- **Result:**
  - (a) When every search fails, a run is still stored with a share of 0% and the next check is moved a week out.
  - (b) When the AI intent check fails, the search is stored as judged "ok" permanently, because the default at `:339` is `ok` and judgements are never re-made.
- **Fix:** (a) store no run and leave the check due when every search failed. (b) Have `checkIntent` report failure; leave `keywords.intent` unset so it is judged on the next run.
- **Reproduction:** `07-keyword-failures.test.mts`.

## Wrong numbers and wrong matches

### 12. Citation audit: correct listings marked wrong, real listings dropped

- **Where:** `src/lib/citations.ts:254` and `:211-218`.
- **Result:**
  - (a) A profile with no postcode (a service-area business) has every listing that shows a postcode marked "Wrong details", because any postcode differs from an empty one. In the script, 3 of 3 listings were marked wrong although the phone matched.
  - (b) A listing showing an old phone and an old address is thrown away as search noise, and the directory is then reported as "Not listed on". The name test at `:214` cannot rescue it: `normName` removes all spaces, so `split(' ')` yields the whole name as one glued word that never appears in page text.
- **How bad:** (b) hides exactly the listings a citation audit exists to find.
- **Fix:** (a) compare postcodes only when the profile has one. (b) split the name into words before normalising each.
- **Reproduction:** `10-citation-false-mismatches.test.mts`.

### 13. A business with more than 200 reviews is reported as having 200

- **Where:** `src/lib/gbp.ts:249-260` stops reading at 200 reviews and never reads `totalReviewCount` or `averageRating`, which Google sends with every page. `src/lib/audit.ts:119-120` then counts and averages the stored rows.
- **Result:** Google says 250 reviews averaging 4.2; the audit says "200 reviews" and "5★ from 200 reviews". The rating is wrong because only the newest rows are averaged.
- **Fix:** store Google's `totalReviewCount` and `averageRating` on the location and use them in the audit, as the public-listing path already does.
- **Reproduction:** `13-review-count-capped-at-200.test.mts`.

### 14. Two businesses with the same name share one report file

- **Where:** `src/lib/report.ts:176`. The file name is the slug of the title plus the date.
- **Result:** the first business's "Report" link shows the second business's report.
- **Fix:** include the location's id (or its unique `site_slug`) in the file name.
- **Reproduction:** `12-report-file-collision.test.mts`.

### 15. The same Google listing added twice reads differently each time

- **Where:** `src/lib/public.ts:368-375`. Reviews are keyed by Google's review id alone, so the second copy's reviews collide with the first's and stay attached to the first. `src/lib/audit.ts:99-102` also tells every public listing its pin was "Placed by hand" when the coordinates came from Serper.
- **Result:** two copies of one listing store 20 and 0 reviews and score 63 and 52.
- **Trigger:** two prospect searches of the same town, or a prospect that is also hand-added.
- **Fix:** key reviews by `(location_id, id)`, or refuse a second business with the same `public_cid` and reuse the first. Word the pin note by source.
- **Reproduction:** `16-same-listing-twice.test.mts`.

### 16. A failed second page is cached for a day as the whole market

- **Where:** `src/lib/benchmark.ts:88` turns a failed page 2 into an empty list, and `:94-96` caches the result.
- **Result:** for a day, every business in that market sees only ten competitors, and anyone ranked 11th to 20th reads as "not in the first 20".
- **Fix:** if page 2 fails, return the ten without caching.
- **Reproduction:** `08-benchmark-half-result-cached.test.mts`.

### 17. "Previous 28 days" is 29 days

- **Where:** `src/lib/extras.ts:80-89`. The query reads 58 days back, the last 28 are taken, and everything before is called the previous period.
- **Result:** at a steady 10 calls a day, the last 28 days total 280 and the "previous 28" total 290. A flat month reads as a 3% fall.
- **Fix:** bound the previous period to the 28 days before the cut.
- **Reproduction:** `15-metrics-previous-period.test.mts`.

### 18. The monthly re-map changes the search wording

- **Where:** `src/lib/grid.ts:304-305`. "Keep the town" is guessed from the first point of the last map.
- **Result:** when that first search has no town in it, the guess is wrong. A map first searched as "plumber" is re-mapped as "plumber in St Albans", so the two are no longer comparable and the month-on-month change is lost.
- **Fix:** store `with_town` on the run and reuse it.
- **Reproduction:** `17-monthly-remap-changes-wording.test.mts`.

### 19. Matching edge cases

- **Where and result:**
  - `src/lib/nap.ts:12`: UK numbers with nine digits after the 0, written with +44, are not matched to their national form. "+44 800 800150" does not equal "0800 800150"; the same for 01204 and 016977 numbers. The length test `>= 12` is one too high.
  - `src/lib/nap.ts:19`: the postcode pattern has no word boundaries, so "Suite W1 1st Floor, … EC1A 1BB" is read as postcode "W1 1ST".
  - `src/lib/grid.ts:106`: a town that is also a word is removed from the wrong place. "bath resurfacing in Bath" is searched as "resurfacing in Bath".
  - `src/lib/benchmark.ts:136`: names with no Latin letters all normalise to an empty string, so any two of them "match" as the same business.
- **Fix:** accept `44` followed by 9 or 10 digits; add `\b` to the postcode pattern; remove the last occurrence of the town, or only one preceded by in/near/around; treat an empty normalised name as no match.
- **Reproduction:** `09-matching-edge-cases.test.mts`.

## Scheduler and background jobs

### 20. One refused photo uses up the whole photo queue

- **Where:** `src/lib/extras.ts:45-52`. `postPhoto` throws before `next_photo_at` is moved.
- **Result:** on the next tick, five minutes later, the next queued photo is tried, and so on. With Google failing for fifteen minutes, three photos meant to go out a fortnight apart are all marked failed.
- **Fix:** move `next_photo_at` on (or back off for some hours) when a photo fails.
- **Reproduction:** `02-photo-queue-burn.test.mts`.

### 21. A disconnected Google account comes back at the next start

- **Where:** `src/lib/gauth.ts:77` deletes the old `google_connection` row only when no logins remain. `src/lib/db.ts:402-412` copies that row back into `google_logins` at every start.
- **Trigger:** disconnect the first account while a second stays connected, then restart the app.
- **Result:** the first account is listed again, holding the token that was just revoked. Calls routed to it fail.
- **Fix:** delete the `google_connection` row whenever its email is the login being disconnected; or run the copy once and record that it was done.
- **Reproduction:** `19-disconnected-login-returns.test.mts`.

### 22. A prospect that was mid-audit when the app stopped stays "running" for ever

- **Where:** `src/lib/prospects.ts:129` sets `running`; Continue picks up only `queued` (`:114`) and Retry only `error` (`:91`).
- **Result:** the row is never audited. Map runs already handle this (`settle` in `src/lib/grid.ts`); prospects do not.
- **Fix:** at `start`, reset this batch's `running` rows to `queued` when the batch is not running in memory.
- **Reproduction:** `18-prospect-stuck-running.test.mts`.

### 23. Without an AI key the scheduler does nothing at all

- **Where:** `src/lib/scheduler.ts:38`.
- **Result:** jobs that never call the AI (performance stats, the photo check, the photo queue, weekly search checks, monthly maps) are skipped too.
- **Fix:** gate only the review and post jobs on the key.
- **Reproduction:** `20-scheduler-needs-llm-for-everything.test.mts`.

## Running it

### 24. `npm run build` fails

- **Where:** `package.json:7` runs `next build`. Next 16 builds with Turbopack by default and stops because `next.config.mjs` has a `webpack` block and no `turbopack` block.
- **Result:** the build exits with an error every time. `next build --webpack` gets past it.
- **Fix:** change the script to `next build --webpack`, matching `dev`.
- **Reproduction:** by hand.

### 25. A first build on an empty `data/` folder fails with "database is locked"

- **Where:** `src/lib/db.ts:7-12`. The build's seven workers each import `db.ts`, and each creates the schema at once.
- **Result:** the build failed both times it was run with no database present and passed three times in a row once one existed.
- **Fix:** set `PRAGMA busy_timeout` before the schema runs, and avoid opening the database at import time during a build.
- **Reproduction:** by hand: delete `data/` and `.next/`, then `npx next build --webpack`.

### 26. Pages for an unknown business log a server error

- **Where:** `location(locId(id))!` in the nine pages under `src/app/locations/[id]/`.
- **Result:** the layout returns a 404, but the page still runs and throws `TypeError: Cannot read properties of undefined`. The visitor sees the 404; the server log fills with errors.
- **Fix:** call `notFound()` in each page when the location is missing.
- **Reproduction:** by hand: open `/locations/999/map`.

## On a Linux host

### 27. The post hour and the score week follow the server clock, not UK time

- **Where:** `src/lib/posts.ts:107-115` (`nextPostAt` uses `setHours`), `src/lib/history.ts:10-14` (`weekOf`), `src/lib/gauth.ts:345` (Pipedream windows).
- **Result:** on a server in UTC, a 09:00 Monday post goes out at 10:00 UK time all summer, and the weekly score's week starts at 01:00 on Monday.
- **Fix:** work out the hour in `Europe/London` explicitly, or set `TZ=Europe/London` and say so in the README.
- **Reproduction:** `23-post-hour-on-a-utc-host.test.mts`.

### 28. Other things that assume this Windows PC

Read from the code; none was run on Linux.

- **`package.json:6,8`:** `set NODE_OPTIONS=…&&next …` is Windows syntax. On Linux the command still starts, but the option is not set, so the larger header limit is silently lost.
- **`npm run build`:** fails everywhere (bug 24).
- **`data/` and `output/`** are folders beside the app (`src/lib/db.ts:5`, `src/lib/site.ts:258`, `src/lib/report.ts:174`). On a host with a temporary or read-only disk, the database, reports and generated sites are lost on every deploy, or cannot be written at all.
- **`report_url` stores a full file path** (`src/lib/report.ts:176-178`). A database moved to another machine points at files that are not there; the report route then rebuilds each report on first view, which costs AI and search credits.
- **The scheduler, prospect batches and map runs live inside the web process** (`src/lib/scheduler.ts:125-129`, `src/lib/prospects.ts:99`, `src/lib/grid.ts`). They need one long-running process. On a serverless host they never run. With two instances, each has its own "already running" flag, so both would post and reply.
- **`node:sqlite`** needs a recent Node and prints an experimental warning; the host's Node version must match.

## Not covered

- Live Serper and live Google behaviour: only stand-ins were used.
- Schema changes on an existing database: `db.ts` history was compared between commits and produced bug 21; a full upgrade of a real old database was not run.
- Whether multi-step writes need transactions was not examined closely.
- The `platform/` and `pipedream/` folders.

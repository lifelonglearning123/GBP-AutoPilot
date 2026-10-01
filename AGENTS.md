<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# GBP Autopilot — project notes

- Read `README.md` first. Internal local-SEO tool for Google Business Profiles; local Next 16 + `node:sqlite`, port 3320, `next dev --webpack` (Turbopack breaks on this machine).
- All mutations go through `POST /api/action` (`src/app/api/action/route.ts`) and the `<Action>` client button. Do not add server actions; localhost cookie bloat breaks their transport here.
- `src/lib/gbp.ts` is the only file that talks to Google. `isMock()` is true while `GBP_MOCK=1` or Google is not connected; fixtures are in `src/lib/mock.ts` and must stay shaped like real API responses.
- Category suggestions must only ever use names returned by Google's categories list. Never let the LLM invent a `gcid`.
- Rows from `all()`/`one()` are spread into plain objects on purpose: `node:sqlite` rows have a null prototype and cannot be passed to client components.
- Verify with `npm run typecheck`, not `next build`, while the dev server is running.
- Schema lives in `src/lib/db.ts` and only runs at first connection. After adding a table, restart the dev server (the handle is cached on `globalThis`), or the new table will not exist.
- Citation audit needs `SERPER_API_KEY`; without it in mock mode it reads `MOCK_CITATION_PAGES` instead of the web.
- Manual businesses have `account = 'manual'` and ids `manual/<slug>`; `isLinked()` in locations.ts is the switch, and `assertLinked()` in gbp.ts blocks Google writes. Keep both when adding a Google call.
- Citation name matching is deliberately loose (accents, spacing, town, legal suffixes stripped; contains = variant). Only a genuinely different name is a mismatch.
- `parse()` in db.ts returns the fallback for a stored JSON `null` too; callers rely on that (profiles without categories/addresses).
- Prospect batches run in-process in the background (`prospects.start`); the batch page polls by refreshing every 5s while `isRunning()`.
- Column additions go in the migrations loop at the bottom of `init()` in db.ts, not just the CREATE TABLE.
- The dev/start scripts set `--max-http-header-size=131072`. Without it this PC's localhost cookie jar (every other local app's session cookies) overflows Node's 16KB header limit and the browser shows a bare "page isn't working" (HTTP 431). Keep the flag.
- Audit checks have THREE states: ok, fail, `unknown`. Never score something the app cannot see as a failure; that bug produced a "0 reviews, not verified" report for a 115-review profile. Anything filtering failing items must use `!i.ok && !i.unknown`.
- Hand-added businesses read their public Google listing through `src/lib/public.ts` (Serper /maps 3 credits, /reviews 1). `ensureFresh()` runs before citation audits and reports. Google's details overwrite the typed ones; the typed values live in `public_json.entered` and are shown only in the app, never in the client report.
- Maps cids exceed 2^53: always handle them as strings / BigInt, never Number.
- Always run scraped text and model-extracted fields through `decodeEntities()`; "J&#039;s" vs "J's" was flagged as a different business name.
- The in-app FAQ (`/help`) is generated from `src/lib/faq.ts`. When behaviour it describes changes, update the entry in the same change. `share-wrong` describes how share.google links are matched (fixed 2026-09-22: query values are read with URLSearchParams before any decoding, so "&" no longer cuts a name short, and a name-only link must match a listing's name, never "the first result"; name-only matches are recorded as matchedBy 'search' so the check warning shows).
- Scoring is graded (`points` 0-1 per item, `WEIGHTS` sum to 100). `ok` means points >= 0.8; lists of what needs attention should sort by points lost, `weight * (1 - points)`.
- Competitor benchmark (`src/lib/benchmark.ts`): never cache an empty Serper result (it flakes and returns nothing for valid searches); only swap to the category fallback for a freshly proposed phrase, never for one the user typed. Maps positions are approximate (no searcher location) and every report says so.
- The report's "website pages" section is our site-generator proposal, not a check of the business's real site. Never let the summary describe those pages as missing.
- Multi-search visibility lives in `src/lib/keywords.ts`. Keep: intent judged once per keyword and reused (`keywords.intent` ok|wrong); thin/error are per-run states that must never overwrite a judgement; run-to-run change uses `likeForLike` (searches scored in both runs); the leaderboard is cut to 10, so rank and field size come from `summary.rank` / `summary.field`, not the leaderboard length; branded searches (the business's own name) are filtered out of suggestions.
- Serper returns its own failures as HTTP 200 with a `message` and no `places`; `placesPage` throws on that so it is retried and never cached.
- Map grid (`src/lib/grid.ts`): zoom comes from `zoomFor`, which has two fixed groups (2026-09-22): close range 0.5/1/2 mi at 13z and wider area 3/5 mi at 11z, so a spot reads the same at any close-range distance (a zoom per distance made Nick Dyer 1st at 2 mi and 6th at 3 mi at the same spot). It zooms out further only if a far-north business would leave the screen. Store the zoom per run; never compare maps across different size/radius/zoom. An empty `/maps` response is a failed read (retry, then `error`), never a "not found". The map layout is plain positioned HTML over OSM tiles, shared by the app (`GridMap`) and the report; keep the OSM attribution.
- Map wording: `withTown` keeps the town in each map search; the stored per-point `query` records which. Never assume wording is irrelevant (one early test suggested it; Ridgeline disproved it). Compare maps only when `query` matches too.

## Brand (2026-09-21)
- Logo, icons, colour and type are documented in `BRAND.md`; exports in `public/brand/`, favicon `src/app/icon.svg`, `src/app/apple-icon.png`.
- The accent is Pilot indigo `#5646e8` (`--accent`); never Google blue. Accent-coloured text on the dark ground uses `--accent-text`.
- Sidebar logo is `public/brand/lockup-dark.svg`. A rename regenerates the outlined wordmark via `brand-src/gen_assets.py`.

## Google access: our own OAuth, approved project (2026-09-25)
- Google access is LIVE on our own connection. The approved Cloud project is `gold-courage-394715` ("Google My Business Automation", number 363054406149) — approved since 2023, 300 QPM on every My Business API plus the v4 private API. The newer `gbp-autopilot-509222` was never approved (0 QPM) and its request is redundant; do not wait on it. Approval is per PROJECT, not per OAuth client, so a new client inside an approved project inherits it.
- `.env.local` points `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` at the "GBP Autopilot" client in that project, redirect URI `http://localhost:3320/api/auth/google/callback`. `PIPEDREAM_TOKEN_URL` and `PIPEDREAM_TOKEN_SECRET` are commented out, which is the only switch: uncomment both and the app borrows tokens again. All the Pipedream code stays.
- SEVERAL Google accounts, our own OAuth: table `google_logins`, one row per account keyed by its email (the one-row `google_connection` is kept and its row copied across by the migration in `init()`). `listConnections()`, `connection(login)`, `disconnect(login?)`. `accessToken({resource})` picks the row by `loginFor(resource)` — the same `google_account_logins` account->login map the Pipedream path uses — else the first. Chao's 11 Google locations sit under two accounts (chao@macaws.ai has 7, ghlvideostudio83@gmail.com has 4 including J's Electrical), so one connection is never enough.
- `pruneAccountLogins()` drops map entries naming a login we no longer hold, and runs on connect (callback route, which then calls `listAccounts()` to relearn) and at the top of `listAccounts()`. Without it a stale map sends a call to the wrong account and Google answers "Requested entity was not found" — which is what the Pipedream-era `apn_...` entries did right after the switch.
- Refresh tokens belong to the OAuth client that issued them: changing `GOOGLE_CLIENT_ID` invalidates every stored login, so clear `google_logins` and reconnect.
- OAuth branding VERIFIED AND PUBLISHED (2026-09-27): the consent screen shows the app name, logo and links, with no "Google hasn't verified this app" interstitial. Status reads "Your branding has been verified and is being shown to users." Settled values: name `GBP AutoPilot`, support + developer `chao@macaws.ai`, home page `https://gbp.macaws.ai`, privacy `https://gbp.macaws.ai/privacy`, terms `https://gbp.macaws.ai/terms`, authorized domain `macaws.ai`, logo the macaws parrot. `business.manage` is non-sensitive on this project, so this was about not scaring agencies off, not about access.
- Learnt while doing it: editing the privacy/terms URLs within the already-authorized domain does NOT reset the verified status — save, then Publish. A verified-but-unpublished result expires in 7 days, and Publish is greyed out while the form has unsaved changes. Changing the LOGO is the thing that forces re-verification, so leave it alone.
- The links pointed at the old `macaws.ai` site until this was fixed: `www.macaws.ai/terms` was a 404 (its real page is `/terms-of-service.html`) and `www.macaws.ai/privacy-policy.html` never mentions Business Profiles. Google's check passed them anyway, so reachability and content are on us to get right.
- The old blocker is gone: review failed while the consent-screen name ("GBP AutoPilot") disagreed with the home page (`https://macaws.ai`, an AI-receptionist site). The home page is now `https://gbp.macaws.ai`, which is titled GBP AutoPilot and explains the scope. `marketing/gbp-autopilot.html` is obsolete.
- What the reviewer checks now exists on the platform and is pinned by `npm run verify`: a public `/privacy` and `/terms` (in `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts` — behind a login they are worthless), both linked from the home page footer, and a home page that names the app and states the one scope. Consent-screen logo: `public/brand/consent-logo-120.png` (120x120, flattened onto white).
- The privacy policy names four processors and what each receives; OpenAI gets the reviewer's display name and review text to draft a reply. If that ever changes, the page changes in the same commit.
- Writing it caught a false claim: the home page promised "the token is revoked with Google there and then" while `removeConnectionAction` only deleted our row, leaving the grant live. `revokeToken()` in the platform's `oauth.ts` now posts to Google's revoke endpoint BEFORE the delete that destroys the only copy of the token; an already-revoked token counts as success, and an unconfirmed revoke says so. Four checks in `verify.ts` hold that promise to the code.
- Performance metrics 403 on some profiles (Beauty brow spot salon) even though the listing and its 200 reviews read fine on the same account: a per-profile permission, not a project problem. The scheduler's 6-hour back-off already keeps it quiet.
- `tsconfig.json` excludes `platform/` and `marketing/`: the nested platform app has its own project and flooded `npm run typecheck` with false errors.

## Pipedream token mode (2026-09-22, now off)
- While Google has not approved our API access, `accessToken()` in `src/lib/gauth.ts` borrows a token from a Pipedream workflow (`pipedream/google-token.mjs`, setup in `pipedream/SETUP.md`) when `PIPEDREAM_TOKEN_URL` and `PIPEDREAM_TOKEN_SECRET` are set. Nothing else in the Google client changes; `call()` in gbp.ts retries once on 401 with a fresh token.
- The borrowed token is cached on `globalThis` until a minute before expiry, so the workflow runs about hourly (Pipedream credits). Never log or return the token to the browser; `borrowedToken()` strips it.
- `syncAll()` adopts hand-added businesses Google returns (place id, else Maps cid) via `rekeyLocation()` in db.ts, which re-points every `location_id` column in one transaction with deferred foreign keys. Public-listing reviews are deleted on adoption because their Maps ids differ from API review ids; the next scheduler tick polls the real ones.
- Free Pipedream = 3 credits/day (API: `daily_credits_quota`), 1 per token fetch. `pipedreamBudget()` counts fetches per UTC day in settings (`pipedream_fetches`); the token is persisted in settings (`pipedream_token`) so restarts are free. The scheduler calls `googleReady('scheduler')` only when Google work is due, fetches only inside `PIPEDREAM_WINDOWS` (default 9,14) and never spends the last token (kept for manual actions); reviews poll every 180 min in this mode. Manual ticks pass `{ manual: true }`.
- `pipedream/deploy.mjs` needs the PERSONAL API key: connected accounts are private to their owner, so the workspace OAuth client lists none. It seeds the app's token cache with its test token.
- Several Google logins (Pipedream mode): the token source is GENERATED by `pipedream/deploy.mjs` with one app prop per connected Google Business Profile account and returns `{ tokens: [{ id: apn_..., label, access_token, expires_in }] }` in one run. The app stores them as an array under `pipedream_token` (an old single object reads as login "default"). `listAccounts()` lists per login and records account -> login in settings `google_account_logins`; `call()` passes its URL to `accessToken({ resource })`, which picks the login by `accounts/N` in the URL, else by the `locations/N` row's account, else the first login. `pipedream/.deployed.json` records which logins the live source covers; deploy replaces the source when that set changes. Own-OAuth mode is still one login.

## Light theme and the Overview tab (2026-09-22)
- The app is light (white canvas, Paper sidebar, Ink text); tokens in `src/app/globals.css`, including text-safe status colours (`--good` #13804a etc.) and `-bg`/`-line` pairs for pills. Sora for headings (`h1-h3`, `.display`), DM Sans for body, loaded from Google Fonts in `layout.tsx`. No all-caps labels.
- Overview (the first tab) = `ScoreRuler` (100 points split by group weight) + `NextSteps` (failing checks sorted by points at stake, each with its action) + `BasicsForm` (phone, website, opening hours saved to Google via `location.basics` -> `saveBasics()`) + AI drafts (`SuggestionCard`) + recent changes from `job_log` + `Scorecard` rail. Field checks live in `src/lib/basics-check.ts`, shared by browser and server.
- Google PATCH rules learnt with `validateOnly=true`: the phone mask must be `phoneNumbers` (primary and additional together; `phoneNumbers.primaryPhone` alone is rejected), and some profiles refuse phone edits entirely (`PHONE_NUMBER_EDITS_NOT_ALLOWED`, macaws.ai does). `saveBasics` sends the phone in its own PATCH so a refusal cannot block website/hours, and records refused profiles in settings `phone_edit_blocked`. Hours: one period per slot, closing 00:00 is sent as 24:00 same day, earlier-than-opening closes on the next day; every existing period is shown and kept.
- Every Pipedream token fetch writes a `pipedream` row to the job log, so credit use can be traced.
- Category candidates for the AI draft (`candidateCategories` in suggest.ts) come from up to 14 searches of Google's list, with words from: an LLM call proposing words (words only, never names), the profile's current categories, the services on the Google profile, and the Configure services. Weak words are skipped. Macaws.ai went from 1 search / 5 candidates to 14 / 136. Each run logs a `categories` row listing the words used.
- The category picker (`CategoryPicker`, inside BasicsForm) searches via the `categories.search` action (`findCategories`, cached a day per word) and can only add names Google returned. Categories save in their own PATCH (mask `categories`), like the phone, so a refusal cannot block other fields; the server accepts only `categories/gcid:...` names, max 9 additional. Make primary moves the old primary into the additional list.
- Business details parts (`FormPart` inside `BasicsForm`): phone, website, categories and hours each close to a one-line summary once the audit scores them done (`done` map from the page) and the form sees no warning; they open themselves when they stop being done, when a Next steps anchor points at them, or on a failed save. Scorecard groups on full points render as closed `<details>`.
- Approving a categories draft MERGES (`mergeCategoryDraft` in `src/lib/cat-merge.ts`, shared by `suggest.apply` and `SuggestionCard`): draft primary, every extra already on Google, the old primary as an extra, then the draft's extras, capped at 9. It never removes. Before this, approving a draft written earlier wiped extras added by hand in the picker afterwards (macaws.ai, 2026-09-22). Category saves now log the names.
- Competitors' categories in the picker: `rivalCategories(l)` in keywords.ts reads the top 5 non-self businesses of the latest keyword run, their categories from `competitor_profiles`, minus the business's CURRENT categories and catch-all types, with counts and names (hover). Adding one calls `categories.resolve` (`resolveCategory`): the local `categories` table first, then a Google search for an exact display-name match; it never adds a name Google did not return. `searchCategories` in gbp.ts now fills the `categories` table on every search.

## Repository and scheduler (2026-09-22)
- This folder is its own git repository (branch `main`), listed in the parent `C:\python\.gitignore` like the other nested projects. `data/`, `output/`, `.env.local` and client PDFs in the root are ignored: they hold tokens and client data. Commit from inside this folder.
- The scheduler's timer (started once from `instrumentation.ts`) never calls `tick()` itself: it POSTs `scheduler.auto` to this app's own `/api/action` (port from `PORT`, else 3320), so ticks always run the current code; route handlers reload on change, instrumentation code does not. The running flag is `globalThis.__gbpTickRunning` so a reloaded module cannot start a second tick. A change to `start()` itself still needs one restart.

## Reviews, alerts, weekly score, photos (2026-09-22)
- Q&A removed: Google retired the Q&A API on 2025-11-03. The `qna` table is kept, unused; do not rebuild Q&A.
- Replies: `auto_reply` (1 = post automatically) plus `hold_low_stars` (default 1: in automatic mode, 1 and 2 star replies stay drafts). `reviews.postAll` posts every drafted reply except 1 and 2 star ones. Set on the Reviews tab (`ReplyMode`). `updateConfig` only accepts whitelisted keys (`CONFIG_KEYS`), because keys come from the browser.
- Alerts (`src/lib/alerts.ts`, table `alerts`, unique on kind+ref): `reviews.poll` calls `alertBadReview` for reviews new to the app with rating <= 2 and Google createTime within 14 days, so linking a business with old reviews does not flood alerts. Shown on the dashboard, the Reviews tab and as a sidebar dot until marked seen; GoHighLevel gets a task + note via `notifyBadReview` when the business has a `ghl_contact_id` (ghl is imported lazily).
- Weekly score (`src/lib/history.ts`, table `score_history`, one row per business per Monday-week): the scheduler calls `recordWeeklyScores()` every tick; the current week is refreshed at most every 6 hours. Shown by `ScoreTrend` under the score bar, as "Up N this week" on the dashboard, and as a line in client reports from two weeks on.
- Photos check: `syncPhotos` (extras.ts) reads v4 media (business photos) and customer media counts into `photos_*` columns daily in the scheduler and on Re-read from Google; the audit scores half for 10+ photos and half for a photo within 30 days (half credit within 90).
- Dashboard (`src/app/page.tsx`) is one list, not cards: business, score (+ weekly change), local search, "waiting for you" (bad-review alerts, reviews without a reply, suggestions, post drafts), biggest next step. The next step and its wording come from `src/lib/steps.ts` (`nextSteps`, `TODO`), shared with the Next steps panel; change wording there, not in either page. Columns switch on the list's own width (container query at 56rem), not the viewport, because the sidebar eats ~320px. Same name + postcode is flagged "Possible duplicate".

## Checks and fixes (2026-09-22)
- Dev watcher: `next.config.mjs` makes webpack ignore `data/`, `output/` and `*.tsbuildinfo`. Before, every database write (nearly every click and scheduler tick) and every saved report rebuilt the app, and a request landing mid-rebuild could read a half-written manifest: HTTP 500 "Unexpected end of JSON input", gone on retry. `onDemandEntries` keeps all pages compiled. A change to next.config restarts the dev server by itself.
- Browser-supplied objects never become column names unless whitelisted: `updateConfig` (`CONFIG_KEYS`) and `posts.edit` (`EDITABLE`). Keep that for any new edit action.
- `posts.publish` refuses a post already `posted`; Google creates a new post on every call.
- Scheduler back-off: a failed daily read (metrics, photos) rests that business for `RETRY_AFTER_FAIL_MINUTES` (6 h; in memory on `globalThis.__gbpFailures`) and does not count as Google work due, so it cannot spend a Pipedream token alone. Manual ticks ignore it. Before, a profile Google refused (403 on stats) was retried and logged every 5 minutes.
- Test harness used for this: a sandbox copy in the scratchpad (copied `src`, a `sqlite3` backup of the DB with Pipedream token and Google connection removed, `GBP_MOCK=1`, no Serper/GHL, `PORT=3399`, node_modules as a junction). Remove the junction with `rmdir` (never `rm -rf`, which follows it into the real node_modules).
- Business page wording (2026-09-22): tabs are Overview / Reviews / Posts / Website / Competitors / Map / Listings / Settings (the old Audit & fill, Citations, Configure). The Overview tab is one column: a plain-English verdict (`verdict()` in steps.ts) and score, `NextSteps` showing 3 with the rest folded, the details form, the AI drafts, then `ScoreRuler` + `Scorecard` inside a closed "Everything we check". Points shown to people are whole numbers via `worth()`; fractions stay in the checklist. Group names come from `GROUP_LABEL`, not the stored `AuditGroup` values. Send to GoHighLevel and Delete live on the Settings tab, not in the header.
- Map pin (`latlng`): Google's own field description says it "can only be updated by approved clients", is ignored at create when the address geocodes, and is returned only when a pin was accepted at create or moved by hand on the Google Business Profile website. So the app can never write it: do not build a pin editor. A missing pin means Google's automatic position, not a mistake, so the check is scored only when a hand-placed pin exists and is left `unknown` otherwise. Everything else the app writes (phone, website, hours, categories, description, services) carries no such restriction; the discovery document at `https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1` is free to fetch and settles questions like this without spending a Pipedream token.
- Map centre (`src/lib/geo.ts`): `storedCentre()` = Google's hand-placed pin (`latlng_json`), else the position worked out from the address and kept in `geo_json` (`{lat,lng,source}`) with `geo_at`. `ensureCentre()` fills it on the first Map tab view and before `grid.start`, using OpenStreetMap (free, needs the User-Agent, one call per business) then postcodes.io for GB postcodes; it never calls Serper, so it costs nothing. `geo_json` is cleared when a sync or a manual edit changes `address_json`. Do not write the worked-out position into `latlng_json`: the audit uses that to tell whether a real pin exists. The Map tab says what a non-pin centre is based on (`centreNote`).

## Stripe webhooks (2026-09-27)
- TEST mode now has the two endpoints the platform needs, created via the API on `api_version=2026-08-26.dahlia` (what the installed SDK pins; the account default is the much older 2022-08-01):
  - `we_1UKLONB13kWaEFPSGez3V5U9` -> `https://gbp.macaws.ai/api/stripe/webhook`, ACCOUNT events: checkout.session.completed, customer.subscription.created/updated/deleted, application_fee.created/refunded.
  - `we_1UKLOtB13kWaEFPSvF8Tg542` -> `https://gbp.macaws.ai/api/stripe/connect-webhook`, CONNECT endpoint (`connect=true`), 8 events: account.updated, account.application.deauthorized, checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed.
- Each endpoint has its OWN signing secret, set in Vercel production. Before this both env vars held the SAME `whsec_d4ba...`, which was a Stripe CLI secret from local `stripe listen` on 23-24 Sep: no endpoint for this platform existed in the account at all, so a real Stripe delivery would have failed the signature check in production. The six older `connect` rows in `stripe_events` came through the CLI, not from Stripe.
- The enabled events must match the `case` labels in each route. `application_fee.*` is easy to miss (it is how the platform's commission is recorded) and lives on the ACCOUNT endpoint, not the connect one.
- Proven end to end: unsigned POST -> 400 on both; a request signed with the deployed secret -> 200; and a real Stripe-delivered `customer.created` landed as `evt_1UKL...` with `endpoint='platform'`. Test rows were deleted afterwards.
- Env var changes need a REDEPLOY before they take effect.
- Still TEST mode (`sk_test_`). Going live needs: both endpoints recreated in live mode (new ids AND new secrets), `sk_live_` in STRIPE_SECRET_KEY, a fresh Connect onboarding (acct ids never cross modes), and every plan recreated because its price lives on the connected account.

## The platform caught up with the local app (2026-09-28)

The platform began as tenancy, billing and the audit; every Google feature this
folder's app has was missing. It has now been ported. What to know:

- `src/lib/gbp/google-api.ts` is the only file that talks to Google, and it now
  WRITES: `patchLocation`, `getLocation`, `searchCategories`, `listMedia`,
  `customerMediaCount`, `createPhoto`, `fetchDailyMetrics`. Performance figures
  come from a fourth host, `businessprofileperformance.googleapis.com`.
- `basics.ts` saves phone, website, hours and categories, each in its OWN
  request. Google's two undocumented rules are kept: the phone mask must be
  `phoneNumbers` with the primary and additional numbers together, and some
  profiles refuse phone edits entirely (`PHONE_NUMBER_EDITS_NOT_ALLOWED`),
  which is remembered in `gbp_profiles.phone_edit_blocked`. The whole location
  is stored in `gbp_profiles.raw` because a write has to send back fields it is
  not changing, and what is not kept cannot be sent back.
- Name and address are deliberately not editable: Google re-verifies after
  either, which can take a profile offline for weeks.
- `suggest.ts` drafts description, categories and services. The model NEVER
  writes a category name — it picks by id from candidates fetched from Google's
  list, searched with words from four places. Approving a categories draft
  MERGES (`cat-merge.ts`): it never removes, and existing categories fill
  Google's nine places before anything suggested.
- `categories.ts` caches Google's list in `gbp_categories`, shared across
  agencies because it is Google's list. Nothing may ever be set to a name
  Google did not return.
- `compare.ts` is the competitor report: share of local search weighted by
  position (`[100,70,50,30,25,20,16,13,11,10]`, 3 for 11-20), the leaderboard,
  the search-by-search matrix, and the gaps. Rank and field count EVERYONE, not
  the ten the table shows. A search that returned nothing is "left out", never
  scored as a zero.
- `geo.ts` works a position out from the address (OpenStreetMap, then
  postcodes.io) when Google gives no pin. Before this the searches ran from the
  middle of the country and named Birmingham businesses as a Swindon
  competitor. With no position at all a run now refuses rather than guesses.
- `extras.ts` reads photos and daily figures, and holds a photo queue released
  on a schedule. `daily.ts` runs the round (photos, figures, weekly post,
  weekly search re-check) from `/api/cron/gbp-daily`, guarded by CRON_SECRET; a
  failed read rests that business six hours.
- Linking a profile MUST record `googleAccount` as well as `googleLocationId`:
  every v4 endpoint (photos, reviews, posts) names a location under its
  account, and a link that forgets it 404s on all of them.
- Never hand a JavaScript Date to a query — `npm run verify` scans for it, but
  its heuristic only catches a Date in a plain variable. `syncPhotos` put one
  straight into `.set()` and the scan could not see it. Use `sql` with ISO
  text, `now()`, or `make_interval(...)`.
- EVERY new table goes in `supabase/migrations/0001_rls.sql`.
  `scripts/rls-check.ts` reports any table Supabase would publish without RLS.
- Deliberately NOT ported: the website generator (`site.ts`). The platform
  produces a site PLAN instead (`site-plan.ts`), which is the decision taken on
  2026-09-27 — clients build on their own site in their own stack. Also not
  ported: mock mode, which exists so the local app runs with no Google.

## The platform's business page, and hand-added businesses (2026-09-28)

- The page now carries the four pieces the local app has: `ScoreRuler` ("How the
  score adds up"), `NextSteps` (each job with the button that does it, the rest
  folded), `Scorecard` ("The full checklist", inside "Everything we check"), and
  `ListingPanel` for businesses added by hand. Components are
  `src/components/score-ruler.tsx`, `next-steps.tsx`, `listing-panel.tsx`,
  `status-icon.tsx`, `copy-link.tsx`.
- The ruler's earned fill is `var(--brand)`, which the workspace layouts
  override per agency; never hardcode the indigo there. Unchecked points are
  HATCHED and left out of the score — the same three-state rule as the local app.
- Status marks are drawn (tick, half, cross, dashed ring) so status never rests
  on colour alone. `StatusIcon` takes `AuditItem.grade` straight.
- The smallest group carries 5 of the 100 points, so the ruler's label row gives
  every column a `minWidth` floor. Without it "Posts and photos" truncates.
- Hand-added businesses: `public-listing.ts` reads and writes, `listing-match.ts`
  is the pure half (which listing is it, where do typed details disagree) and is
  what `verify.ts` exercises. Keep that split — importing the writing half into
  the checks drags in the database and the whole suite fails on env.
- A listing match needs the NAME **and** a postcode or phone to agree, uniquely,
  before it is treated as certain. Everything else goes to "Wrong business?".
  `matchedBy: 'search'` shows a warning on the panel.
- Google's public hours are TEXT ("8 am–5 pm"). Everything that reads hours reads
  `periods`, so `parsePublicHours` (`public-hours.ts`) converts them on the way
  in, in BOTH `public-listing.ts` and `from-link.ts`. Stored as text alone, a
  business with perfectly good hours scored as having none.
- A Maps link carrying only a NAME must match a listing's name, never "the first
  result" — the Mortlock & Joyce -> Mortlock Timber failure. `listingFromLink`
  refuses and names the closest matches instead.
- `ensureFresh()` runs before the client report and before a citation sweep, so
  both compare against what Google shows rather than what someone typed. It
  never throws.
- Candidate searches are held ten minutes in memory, keyed by what was searched
  for, because the page is reloaded while being read. An empty Serper result is
  never cached.
- The platform's `dev` and `start` scripts carry
  `--max-http-header-size=131072`, for the same reason the local app's do: this
  PC's localhost cookie jar overflows Node's 16KB limit and the dev server
  answers 431, which Chrome shows as a bare error page. Proven with a 17KB
  cookie header: 431 before, 307 after.

## Agency and portal are the same product (2026-09-28)

Whatever exists on the agency side exists in the client portal too. The only
difference is scope: an AGENCY sees every client in its workspace, a CLIENT
sees only its own Google Business Profile. This is a rule, not a preference —
the client is paying for the work and has to see it in the same words and the
same numbers, or the agency ends up explaining two versions of the truth.

- Build the `/portal/*` counterpart in the same change as anything new under
  `/agency/*`. Leaving it out is a decision to justify, not an oversight.
- Scope every client read and write with
  `getClientProfile(agencyId, clientId, profileId)`. The agency helpers pin the
  agency ALONE, which is right for an agency — it owns every client in it — and
  is a hole in the portal, because the clients inside one agency are strangers
  to each other. Anything taking a bare id (`applySuggestion` takes a
  suggestion id and checks only the agency) needs a second check that the row
  belongs to that client's profile.
- Repeat the subscription gate (`clientAccess`) on each portal page. A client
  keeps the link and reopens it after cancelling.
- Where the portal has no page for a step — replying to reviews, weekly posts,
  listings elsewhere are the agency's work — `NextSteps` takes a `pages` map
  and a `handled` line, and says "<agency> does this for you" instead of
  offering a button that leads nowhere.
- The client's working page is `/portal/business/[id]`; its actions live in
  `src/app/portal/gbp-actions.ts`, mirroring `src/app/agency/gbp/actions.ts`.
  Tabs come from `BusinessTabs`; reviews and posts render from `ReviewsPanel`
  and `PostsPanel`, which BOTH sides use, so neither can drift.
- Clients start their own keyword checks and map runs. These are the only
  actions in the portal that spend money, and what bounds them is the per-client
  allowance the agency sets, which `startKeywordRun` and `startGridRun` already
  enforce through `guardSpend`. The page prints what is left beside the button.
  Do not "protect" the agency by hiding these: a client who wants to know where
  they rank should not have to email somebody. Raise or lower the allowance.
- Nothing is agency-only any more. Photos (`PhotosPanel`) and the public
  listing of a hand-added business (`ListingPanel`) are on both sides, and the
  client starts their own searches and maps. Parity is now literal: if a feature
  is on one side and not the other, that is a bug.
- Shared panels take the audience with them. `ListingPanel` has an `audience`
  prop because two of its sentences are about US and a business owner reads them
  differently. Anything naming the platform, a Serper key or an API is agency
  wording, and needs a client sentence beside it.
- `NextSteps` used to take a map of which pages existed, so a step could say
  "<agency> does this for you" instead of linking nowhere. Every page now exists
  under both bases, so that is gone and `base` is the only difference between
  the two copies. If a step ever needs that treatment again, the page is missing
  from the portal — fix that instead of bringing the map back.
- A shared panel must take its `base` path as a prop. `ListingPanel` built
  `/agency/gbp/${id}` itself, and the portal's copy would have linked a client
  into the agency's pages.

## Long checks run themselves (2026-09-28)

- The three long jobs — searches, map, directories — are started and then
  advanced in batches. On serverless there is no background worker, so the
  BROWSER advances them: `RunProgress` calls `/api/gbp/run` over and over until
  the run is done, then refreshes. Never put a "Carry on" button back. A
  twenty-five point map needed five presses, nobody pressed five times, and
  because the button looked like it did nothing it got pressed again — J's
  Electrical had three identical map runs six seconds apart, all at 0 of 25.
- A batch runs its searches with `Promise.all`, not in series. Nine map points
  take about 7 seconds in two rounds; in series it was nine round trips.
  `POINTS_PER_ADVANCE` is 8 (Maps), citations 4 (each is a search, a fetch and
  a model call).
- `run-locks.ts` is a LEAF: run ownership, the duplicate guard and the reaper,
  with no import of the three workers, which import it. If it imported them
  back the cycle would bite at runtime rather than at the typecheck.
- Starting a run while one is live returns the LIVE one's id. A run nobody
  carried on for ten minutes is marked stopped, by the daily round or
  `npm run reap`.
- `workspaceUser()` in session.ts returns agency-or-client with `clientId` set
  only for a client, for the handful of endpoints serving both. Every read must
  pin it; `runBelongsTo` is the example.

## Searches, drafts, posts, photos (2026-09-28)

- `suggestKeywords` works from three sources because each is wrong alone:
  Google's categories are Google's words, the services are the owner's, and
  autocomplete is real phrasing full of jobs and courses. Eight are tracked by
  default; it never removes or switches off what somebody chose. Runs on
  linking so a new client is not asked to invent their own search terms.
  The rules are in `keyword-ideas.ts` (pure, checked); the asking is in
  `keywords-suggest.ts`.
- Every draft carries `evidence`, stored WITH it, never recomputed: what was
  there before, how many of Google's categories were searched and on what
  words, and which competitors hold the ones being added. "Three of the five
  beating you list this" is an argument; "a model thought so" is not.
- Posts: `postDay`/`postHour` schedule it properly (`nextPostAt`), and
  `postNotes` is what the owner says has been happening. That box is the only
  input describing what HAPPENED rather than what the business IS, and it is
  the difference between a post about this week and one about nothing. Used
  for `NOTES_FRESH_DAYS`, then ignored.
- Photos upload to Supabase Storage (bucket `gbp-photos`, public, made by
  `npm run photos:bucket`), because Google fetches a photo by URL and will not
  take bytes. `photo-rules.ts` is a LEAF with the file rules, because the
  browser needs them and `photo-store.ts` builds a service-role client — one
  careless import ships that key in the bundle, and a check in verify.ts walks
  every client component's imports to make sure none does.
- A 1 or 2 star review emails the owner AND the agency, with the draft reply
  already written, through the agency's own GoHighLevel. The alert insert is
  what decides the review is new, so an hourly poll cannot mail it twice.

## Video, and what a CRM post may do (2026-09-28)

- Videos go up the same queue as photos, with `gbp_photo_queue.kind` and
  `mediaFormat: "VIDEO"`. Google's cap is 30 SECONDS and it refuses after
  transcoding — hours later, on a queue nobody is watching — so the length is
  measured in the browser with a `<video>` element and sent with the upload.
  The server checks everything else and trusts only that one number.
- Video size is capped at 50MB, not Google's 100MB, because Supabase Storage
  caps an upload at 50MB on this project. A limit somebody meets at 52MB after
  waiting for the upload is worse than a smaller one stated up front. Re-run
  `npm run photos:bucket` to bring an existing bucket's settings up to date.
- Videos are not captioned: the caption model is given still images and a video
  URL is not one.
- `clients.crm_auto` reads the CRM before each weekly post. A post built that
  way is marked `gbp_posts.from_crm`, and `publishPost` REFUSES to publish it
  when called with `{ auto: true }` — the rule lives there, not only in the
  scheduler, so a future caller cannot skip it. The words came out of
  customers' own messages; the last look before public belongs to a person.
- Anything a page's server action does that calls a model needs
  `export const maxDuration`. Without it the platform kills the action part way
  and the button looks broken — which is exactly what "Write one" was doing:
  drafting takes 8 seconds, the drafts button 30.

## The agency's sales page, and the free check (2026-09-29)

`AgencyShopfront` is what a local business sees at `gbp.theiragency.com`. It is
dark end to end, and two rules hold it together:

- THE ONLY COLOUR IS THE AGENCY'S. Every accent reads `--sf-accent`, set per
  agency on the root element. A hardcoded indigo there is somebody else's brand
  on `gbp.leonardopower.com`, and `npm run verify` walks the file's hex codes to
  stop one being added. The three rank colours are the exception: they carry
  data, so they are the same everywhere.
- NOTHING ON IT IS INVENTED. No testimonials, no client logos, no numbers
  nobody measured. What stands in for proof is the visitor's OWN profile scored
  in front of them, and the map grid.

Motion: four monochrome loops in `public/motion/`, tinted per agency in CSS, so
one set serves every agency. `motion-src/README.md` has the prompts, the
Higgsfield model and the ffmpeg that makes them loop; read it before
regenerating one. `MotionPanel` fetches nothing until the panel is near the
screen and plays nothing under `prefers-reduced-motion` — the poster is the
real content.

The FREE PROFILE CHECK is the one thing on this platform a person with no
account can make it spend money on. Somebody types a business name, picks their
listing, and sees a score out of 100 with the three worst gaps.

- It ALWAYS asks which listing is theirs. A name and a town is never enough to
  be certain, and scoring a stranger against a rival with a similar name is the
  one mistake the page cannot recover from.
- `free-check-rules.ts` is pure and pinned: the cache (7 days, and it does most
  of the work), the visitor limit (8/hour), the agency limit (200/day), and the
  wording. A refusal never mentions limits or credits — the visitor is a plumber
  who pressed a button twice.
- The agency comes from the HOST, never from the form. A body naming an agency
  would let anyone spend any agency's credits.
- `guardSpend` still has the last word, and every call is `recordUsage`d —
  spend that is not recorded makes the allowance a lie.
- The visitor is stored as a salted SHA-256, never an address. `gbp_free_checks`
  is cache, rate limit and lead list in one; the leads show on `/agency/gbp`,
  one row per business, worst score first.
- `audit()` takes `AuditInput` (only the fields it reads) rather than a whole
  profile row, because answering a stranger must not write a profile into an
  agency's workspace.
- The score is what was earned of what could be SEEN. 95 with a coverage of 63
  is a well-kept profile, so `ctaFor()` says "Keep it there" and not "Get this
  fixed" — a button that argues with the sentence above it is how a page stops
  being believed.

Testing a page at phone width on this machine: headless Chrome will NOT render
below about 500px however `--window-size` is set, in either headless mode. The
screenshot comes back cropped and looks exactly like horizontal overflow that
is not there. Put the page in an `<iframe width=390>` inside a wide window
instead, or measure `document.documentElement.scrollWidth` in the page.

## What customers did, in detail (2026-09-29)

The daily figures the daily round already stores, read on the OVERVIEW page of
both sides by `MetricsPanel`, with `MetricChart` opening over the page from any
metric card. There is no activity tab and no activity route: a separate page for
the figures was built first and then folded into the cards, because a figure you
have to navigate away to see is a figure nobody looks at twice. Nothing here
calls Google, so a client may refresh as often as they like and it costs
nothing.

`activity-rules.ts` is pure and pinned, because these are the figures an agency
is judged on at the end of the month:

- A percentage needs something to divide by. Under five before is reported as
  too few to compare, because one call to three is not "up 200%".
- A day Google never answered for is never drawn as a zero. A gap is a gap, not
  a day the phone stopped ringing.
- The period claimed is the period reported: 61 days of figures over a 90 day
  range says "the 61 days Google has reported".
- Weeks are grouped back from the NEWEST day, so the most recent bar is a full
  week and not a stub that reads as a collapse.
- Shares always sum to 100; the largest absorbs the rounding.
- The action rate (calls + website + directions, per hundred views) needs fifty
  views before it is stated at all. It is the figure an owner actually wants:
  views on their own have sold a lot of local SEO that produced no work.

`syncMetrics` now asks Google for 90 days rather than 60 — the same one call.

**The proxy matcher excludes static files BY EXTENSION.** A type missing from
that list is answered with a redirect to `/login`, and on an agency's sales page
— read by signed-out strangers, which is the whole point of it — the asset then
simply does not appear. `.mp4` was missing, so the motion on every shopfront was
being sent to a login page while the `.jpg` posters beside it loaded and made
everything look right in a screenshot. A check in `verify.ts` reads every
extension in `public/` and fails if one is not excluded; add the extension when
adding a kind of file.

## Geotagging photos does nothing for Google — built anyway, and said so (2026-09-29)

Asked for, and checked against Google rather than against the blogs. Google
re-encodes every photo uploaded to a Business Profile and writes its own EXIF.
Reading back what Google actually serves for Nick Dyer Construction's nine
photos, every one carries exactly six tags:

    IFD0     Software, YCbCrSubSampling (0x0212), ExifIFDPointer
    Exif IFD ExifVersion (0x9000), PixelXDimension, PixelYDimension
    NO GPS IFD at all

No coordinates, no camera make or model, no original date, no description.
Whatever the uploader put in is gone. So writing GPS into a JPEG before sending
it achieves nothing that survives the upload, and there is nothing to add to the
photo queue.

It also would not help if it survived: the profile already carries a verified
address and, where Google accepted one, a hand-placed pin. A coordinate a
stranger wrote into a file is the weakest claim about where a business is that
Google holds, not the strongest.

How it was checked, if it ever needs doing again: `listMedia` returns a
`googleUrl` per item; fetch the bytes, find "Exif\0\0", read the TIFF header and
walk IFD0 for tag 0x8825 (GPSInfoIFDPointer). It costs one Google read and no
credits.

What DOES move the photos check: ten or more photos, and one within thirty days
(`syncPhotos`, scored half and half). The queue exists to keep the second half
true without anybody remembering to do it.

BUILT ANYWAY, on the client's decision, for a reason that is not Google: the
copy in our storage is also the copy a client downloads for their own website,
and there the tag survives. `geotag.ts` writes a complete APP1 segment holding
a GPS IFD rather than editing an existing one — rewriting somebody else's
offsets is where this corrupts a photo — and REPLACES any EXIF already there,
so tagging twice does not stack segments. JPEG only; a PNG or WebP comes back
untouched. The position is `storedCentre()`, read off the profile, so an upload
costs nothing extra. 0,0 is refused: the null island is never a business.

EXIF stores degrees UNSIGNED and the S and W reference letters are what make
them negative. Get that wrong and a Wiltshire builder is in the Indian Ocean;
the checks round-trip all four hemispheres.

The upload panel says, in these words, that Google removes it on upload and
that it changes nothing on Google. A check in verify.ts holds that sentence to
the page. Geotagging is sold as a ranking trick constantly, and a client who
believes that of us will believe the next thing too — do not quietly drop the
sentence to make the feature sound better.

## The business page, after a proper look at it (2026-09-29)

- SCORE RULER. The bar and the labels are ONE grid sharing ONE column template,
  because they were two flex rows carrying the same weights and that is not the
  same thing: a minimum width on the label row meant that once the smallest
  group hit the floor, every column after it slid out from under its own stretch
  of bar. Never give the labels their own widths. Below `md` it becomes a row
  per group — hiding the names left a row of coloured stripes meaning nothing.
  `GROUP_LABEL.Activity` is "Posts & photos" so the longest name wraps to two
  lines in the narrowest column.
- FIGURES. There is no separate figures page: a figure you have to navigate
  away to see is a figure nobody looks at twice. Each metric card is a button
  and opens `MetricChart` over the page. A LINE, not bars — the question a
  trend answers is which way it is going — with Week, Month and Quarter, and
  every value printed as well as drawn, because a number that exists only on
  hover does not exist on a phone or to a screen reader.
  It is a native `<dialog>` driven ENTIRELY by React state. Do not go back to
  listening for the element's own `close` event: it did not always fire, which
  left an invisible dialog mounted and the next card opened nothing. Every way
  out calls `onClose`. Tailwind's preflight zeroes the margin a dialog centres
  itself with, so `.chart-dialog` sets `margin: auto`.
- SAVING A DETAIL DOES NOT MOVE THE PAGE. `SavePart` and `SaveForm` use
  `useActionState` against `saveBasicsStateAction` /
  `clientSaveBasicsStateAction`, which RETURN a result instead of redirecting.
  A redirect reloads and drops the reader at the top, so on a page of eight
  sections every field cost you finding your place again. A saved section folds
  to its one-line summary — which is the saved value, so the fold is the proof;
  a refused one stays open with the reason. `router.refresh()` brings the score
  and the checklist up to date without moving anything.
  The save button belongs on a row with the INPUT. It used to sit in a flex row
  aligned to the bottom of a whole field, hint included, so it hung below the
  box it belonged to.
- THE DRAFT READS THE CLIENT'S WEBSITE. `site-read.ts`, fed into
  `candidates()` and recorded on the categories evidence. The profile's
  categories and services describe the PROFILE; the website is where the owner
  wrote down what they sell. Headings and list items only — body prose is
  reassurance and mining it finds words matching a hundred unrelated
  categories. Calls to action are refused (`looksLikeService`): "Apply For
  Finance - Get a decision within 60 seconds" is a good heading and a terrible
  service. Plurals fold, so "Loft Conversions" is not reported missing against
  "Loft conversion". Every phrase carries the page it came from, so a
  suggestion can be argued for rather than taken on trust.
  `missingFromProfile` is the one that earns its keep: Nick Dyer's site sells
  four things his Google profile has never mentioned.
  `pageHtml()` in serper.ts is the raw markup; `pageText()` strips the tags and
  so cannot see a heading.

## Posts and photos: a queue, not a weekly scramble (2026-09-29)

The weekly post was drafted and published on a timer, and the tab showed one
card with three buttons nobody could tell apart. The real fault was that a
weekly promise was being kept one week at a time: somebody had to turn up every
week, and the week nobody did, the profile went quiet.

- THE QUEUE. `gbp_posts.scheduled_for` and `approved_at`. A date is a plan;
  approval is a person, recorded. `publishDue` in `queue.ts` publishes one
  approved, due post a day at most — two landing together reads as a backlog
  being cleared. A post `fromCrm` still never publishes itself; the guard is in
  `publishPost` and `verify.ts` pins that the scheduled caller passes
  `{ auto: true }` so the guard can fire.
- `queue-rules.ts` is the pure half: slot dates from the profile's day and hour
  (the first slot is NEVER in the past — otherwise the whole queue publishes at
  once), the queue laid out including EMPTY weeks because the gap is the
  message, and low water measured on APPROVED posts. A queue of drafts nobody
  has read is a to-do list, not content.
- `placeUndated` runs on every read and dates any draft without one. Posts
  written before the queue existed would otherwise have vanished off the page
  they were written on.
- "Publish it without asking me" is GONE. Permission is per post now.
- REMINDERS (`remind.ts`): running low (under two approved) and gone quiet
  (nothing for 14 days), through the agency's GoHighLevel, once a week per
  profile. The alerts table's unique key on (profile, kind, week) IS the claim —
  `onConflictDoNothing().returning()` decides, so two rounds cannot both send
  and nothing depends on writing a timestamp. The CLIENT's wording never
  mentions a queue, a platform or an agency; a check fails if it ever does.
- The CRM connection lives on a per-business SETTINGS tab, both sides. Posts
  keeps one `SourcesLine` naming what it draws on, including what is NOT
  connected. A tab is shared, so `verify.ts` now opens every tab's page on both
  sides — a tab without its portal page is a 404 in a client's own portal.
- PHOTOS: caption (goes to Google, and now names the town) and alt text (for
  the client's own site, because a Business Profile has no alt text). Editable
  until the photo goes up; after that Google keeps no handle for changing it.
- THE DATE SCAN reads signatures now. Every queue date arrives as an argument,
  so there was no `new Date(` near the query to notice — the `syncPhotos` blind
  spot again. It flags a date in VALUE position only (`{ column: aDate }`);
  looser than that gave seven false positives and a check nobody can keep green
  is a check somebody turns off.

## Two rules from the posts and rankings work (2026-09-29)

### A client is never shown what a search costs us
Credits, allowances and zoom levels are the AGENCY's business. Telling the
person paying for the service that their map used 75 search credits, or 23p of
a 50p monthly allowance, invites a conversation about pennies instead of about
rankings — and it is our cost of goods, which no client should be reading.

- `MapPanel` takes an `audience`. The agency keeps the credits AND the zoom,
  because the zoom is what makes two maps comparable. The client gets "25 spots
  across your area, each one a fresh Google Maps search."
- Nothing under `/portal` calls `formatAllowance`. A check in `verify.ts` fails
  if an allowance or the word "credits" appears on a client page — it strips
  block comments first, so explaining WHY in a comment is still allowed.
- This REPLACES the earlier decision that the portal "prints what is left
  beside the button". The allowance still bounds a client's runs; they are just
  not shown the arithmetic. A refusal has to read as plain English, not as a
  quota message.

### A verdict carries the evidence for it
Anything the app concludes about a business is shown with what it concluded it
from. This is the same standard as the categories draft naming the page and
phrase a suggestion came from, and the free check naming which Google account
manages which listing.

- "Wrong kind of results" is judged from the Google CATEGORIES of the top ten
  results and NOTHING else — not names, not websites. `judgeIntent` in
  `competitors.ts` counts them, and the stored note now names them: "Google
  lists the results as: electric vehicle charging station x7". A verdict a
  reader cannot check is one they have to take on trust.
- A search judged "wrong" is LEFT OUT of the share of search, never scored as a
  zero. A search returning car parks says nothing about an electrician, and
  scoring it 0 would make the number a lie.

### Smaller corrections in the same pass
- Saving a post's words or a photo's caption answers IN PLACE
  (`editPostStateAction`, `editPhotoTextStateAction`). Approve, Publish now and
  Delete still navigate, because those change the list.
- A post `fromCrm` is not offered an Approve at all: it can never go out on a
  schedule, so approving it did nothing. Its mark reads "You publish this one".
  The old "Approved · needs a last look" said neither what it was nor what to
  do about it.
- A post opens UNDER its own week, inside that row's list item. Rendering it
  after the list meant clicking the second week scrolled you past eight rows.
- The photo panel does one thing at a time. Next runs server actions in series,
  so eight "Add now" presses queued eight page reloads and every button said
  "Adding…" at once — `useFormStatus` only knows its own form, so `Submit` takes
  a shared `busy` for a group.

## A run nobody watched finishes anyway (2026-09-29)

The three long jobs are advanced in batches by the OPEN PAGE — there is no
worker on serverless — which works while somebody is looking and fails the
moment they are not. J's Electrical had three directory checks in one afternoon,
all ending "Stopped: nothing carried it on for 10 minutes", and twelve rows
saying "Waiting" for ever.

- `carry.ts` sweeps stalled runs and ADVANCES them. The daily round calls it in
  place of `reapEverywhere`, and gives up only on what it could not finish. A
  run that was started was started for a reason.
- Its OWN cron, `/api/cron/gbp-carry`, every ten minutes. Riding the daily round
  would mean a run abandoned at nine finishing at twenty past seven the next
  day, which is an answer nobody sees.
- Bounded, because it shares a schedule: `CARRY_RUNS` 4 a round, `CARRY_BATCHES`
  12 each, one failure ends that run's turn and never the sweep. It lets a run
  go after `GIVE_UP_HOURS` (6), by which time nobody is waiting for it.
- `reapEverywhere` stays for `npm run reap` — a person clearing something on
  purpose, rather than a schedule deciding for them.
- A stopped run is now SAID on the listings pages ("The last check did not
  finish"), and an unread row reads "Not checked" rather than "Waiting".

Also fixed with it: publishing a photo now moves `gbp_profiles.photos_count`
and `photos_latest_at`. They only changed when the daily `syncPhotos` ran, so
the app put three photos up and then told the owner on the next screen that
their newest was five weeks old. Being wrong about something it has just done
itself is the worst kind of wrong this app can be.

## A verdict is only about the details it was given (2026-09-29)

Cylex read "Agrees with Google" on J's Electrical directly beneath a heading
quoting a phone number Cylex does not show. Both halves were true of different
numbers: the number had been changed in the app minutes after the check, the
edit had gone through (Google confirms `07883 307308` as the primary, and
`phone_edit_blocked` is false), and the check had compared the OLD one.

- The listings pages now quote the RUN's own snapshot (`gbp_citation_runs
  .canonical`), not today's details, and say "as they stood when it ran".
- `detailsChanged()` in `citations-rules.ts` names what has moved since. The
  page says so plainly and asks for a fresh check.
- The fifteen-point "Details elsewhere" check goes back to UNKNOWN when
  anything has changed. Coverage drops, which is the honest answer: nobody has
  looked since. Same three-state rule as everything else.
- The snapshot per run is deliberate — a verdict has to stay reproducible — so
  the fix belongs in what is SHOWN, never in rewriting the run.
- `showDigits()` puts a stored ten digits back the way a person writes them,
  and only groups a mobile: London's 020 split cannot be recovered from digits,
  and a confidently wrong grouping reads worse than none.

Found while doing it: `partial` was counted as `mismatch`, so four directories
printing no phone at all made the note read "5 listings found, 5 showing a
different name, address or phone". One did. A mismatch is a whole problem, a
listing showing too little to tell is half of one, and the sentence names both
separately or says none of them disagree. J's: 82 to 86.

Proving a platform commit deploys, without killing the dev server: `git
worktree add` into the scratchpad, robocopy `node_modules` into it (0.4GB, ~10s
— a junction is refused by Turbopack, "points out of the filesystem root"),
copy `.env.local`, `npx next build` there. Delete it by mirroring an empty
directory over it first; the paths are too long for `Remove-Item`.

## The standalone audit tool is folded in, starting with rank (2026-09-29)

`C:\python\Google Business Profile Audit` is a separate Next app built a few
months ago: a lead-magnet page that scores a stranger's profile, writes a
narrative with a model, renders a PDF and pushes the lead to GoHighLevel. The
idea was right, the arithmetic was not, and it was a SECOND audit engine. The
decision is to fold what it has into the platform's free check and retire it.

What was wrong with it, measured by running its own `lib/scoring.ts`:

- The grade moved with our scraper's luck. The same well-run profile scored 69
  (C) or 78 (B) depending only on whether the review sample came back, and
  Owner Responses silently changed weight from 15 to 10 with it, so two
  businesses were not on one scale. Posts and Q&A returned an invented 50.
  The platform's three-state rule is the answer and already exists.
- Its "services" were ATTRIBUTES. `apify.ts` filled them from additionalInfo
  "Service options", so "Onsite services" and "Online estimates" counted as
  services: a neglected profile scored 80 on Categories and Services and a
  well-run one 40.
- Nobody could reach an A. Completeness caps at 94 for a flawless profile and
  88 when the meta description is under 80 characters, and the scorecard then
  printed "No description detected" — the very thing `openai.ts` forbids the
  model from saying. One branch advised a "250+ word" description for a
  750-character field.
- The money figure was asserted, not measured: a flat 50% lost click share for
  everyone, with no rank input and no ceiling. Its own function gives £675,000
  a year for a London locksmith and £108,000 for a Swindon electrician.

Increment one, shipped: the free check now reads WHERE THEY RANK.
`rank-rules.ts` is the pure half. One Maps search from the listing's own
address at the grid's close-range zoom, then the position decides what may be
said — in the pack nothing is claimed to be lost, outside it the gap is sized
with `visibilityPoints`, the same weighting the client report uses, and "not in
the results at all" is said plainly. The three above them are named with their
review counts, and no claim is made about why Google ranks them higher.

- Costs `RANK_CREDITS` 3 on top of the 4, once a week per listing because the
  cache covers reloads, recorded through `recordUsage` like everything else.
- A rank that cannot be read shows no rank. No category means no search, no
  position means no search, a Serper flake means no search.
- Only the NUMBERS are stored on `gbp_free_checks`; the sentences are rebuilt on
  every read, so a week-old lead is described in today's words.
- `placeAddress` is split out of `ensureCentre`: one geocoder for the free check
  and the paid side, because two would drift.
- The agency's leads list shows the rank beside the score. That is the opening
  line of the phone call.

The one wart is the phrase, which is Google's own category: J's Electrical is
filed as "Electrical installation service" while the firm two streets away is
"Electrician". `PHRASE_NOTE` says where the search came from rather than hiding
it. Tried and rejected: autocomplete on a category stem, which returns
wholesalers for "electrical swindon" and a building society for "building
trowbridge". Choosing real phrases stays a paid-side job, where a model works
from autocomplete hints.

Still to fold: the PDF, the model narrative, the GoHighLevel lead push, and the
website signals (reachable, HTTPS, listed-as-http, a page per category). A
POUNDS figure needs two things the free check does not have — a search volume
source and the owner's average job value — so it stays unbuilt rather than
guessed.

## A button answers where it was pressed (2026-09-30)

"Check the map again" on "Where you show up" redirected with a flash. The map
is at the bottom of the page and a redirect lands at the top, so every press
cost the reader their place — and when the run was REFUSED (J's Electrical had
spent its allowance) the refusal was printed a screen and a half above the
button. From the button's point of view nothing happened. That was the report.

- `MapRunForm` (`src/components/map-run-form.tsx`) is a client component that
  takes the answer back through `useActionState` and prints it under the
  button; on success `router.refresh()` re-renders the section so the progress
  bar and the half-filled map appear right there without the scroll moving.
  `MapPanel` stays a server component. `startGridStateAction` and
  `clientStartGridStateAction` return `SaveState`; the redirecting twins are
  gone and verify pins that neither may redirect.
- Pressing again while a map is going starts nothing new — that was already
  the rule — and now SAYS so ("A map is already being checked. It is the one
  filling in above.") instead of leaving a page that did not change.
- Each progress bar sits with the thing it fills in: the map's under the
  "Street by street" heading, the searches' under the button that starts them.
  Both at the top of the page put "Checking the map 16 of 25" directly above
  the share-of-search card from a DIFFERENT run, which read as a contradiction.
- A map still running says "searched from 16 of 25 points so far", because
  every figure beside it is counted out of what has been read.

The rule, generally: a redirect-with-flash is only right for an action whose
result is at the top of the page. Anything pressed below the fold answers in
place, the way saving a detail already does. If a button "does nothing", first
look for a message that landed somewhere the reader was not.

Bash on this machine truncates a command over about 8K characters BEFORE
running it (the heredoc then never closes: "unexpected EOF while looking for
matching quote"), and PowerShell splits a `git commit -m` here-string on the
double quotes inside it (pathspec errors for each word). Long patches go in a
file via the Write tool and run with `python <file>`; commit messages go in a
file and `git commit -F` it.

## A business that paid and has no listing row is still offered Google (2026-09-30)

R&B Landscapes & Driveways signed up on Artificial Ignorance's page, paid,
and the subscription went active. They then landed on a portal saying
"Nothing yet. Artificial Ignorance Ltd will add your Google listing here",
with no button. The Connect Google card was gated on an unlinked PROFILE ROW
existing, and a self-signup that skips the optional Maps link (or pastes one
that could not be read, which was swallowed silently) has a client record and
nothing else. `linkClientProfile` then had nothing to match against and
returned "nothing to do"; `syncProfilesFor` puts unmatched locations in the
agency-wide `gbp_discovered` pile, never in the client's own list.

- `PortalHome` shows the card whenever nothing is LINKED, rows or no rows
  (`needsGoogle`), with wording that knows "we can see the public version"
  from "we have nothing yet".
- With nothing to match against, the listings the account manages ARE the
  answer. `adoptLocation` (sync.ts) builds the profile row from Google's own
  record, linked from birth. One listing is taken on outright; several are
  written to `gbp_discovered` and offered on the portal home as "Which of
  these is your business?"; none is said plainly. Existing rows are matched
  first, through the pinned rules in link-match.ts.
- `clientClaimListingAction` checks the chosen row back to a connection THIS
  client made. The pile is agency-wide; an id must not let one client claim
  another's branch.
- A Maps link that could not be read on `/start` is logged as a
  "listing from link" error, so a client with no listing is not a mystery to
  the agency later.

While tracing it: `sendGhlEmail` drops the from-name, from-address and
reply-to that `createInvite` passes; it sends subject and body only. An agency
without its own GoHighLevel (Artificial Ignorance, Leonardo Power) sends
invites through the PLATFORM's location, so the client sees macaws.ai's sender
and is created as a contact in macaws.ai's CRM. The invite LINK is white-label;
the envelope is not. Not fixed yet.

Two verify pins on link-client.ts are text-proximity heuristics: no `.limit(1)`
within 300 characters of the text `gbpGoogleConnections`. A type written as
`typeof gbpGoogleConnections.$inferSelect` trips it from a different query.
Use the named `GoogleConnection` type.

## Two review checks, one job; the target is the local pack (2026-09-30)

"Get more reviews" (total) and "Get new reviews every month" (pace) measure
different things and Google weighs both, so the CHECKLIST keeps them apart.
But the action is identical, so two rows with the same "Copy review link"
button split fifteen points and read as padding. `mergeReviewSteps` in
steps.ts, both apps, joins them in the TO-DO LIST only — after the failing
filter, so one failing alone stays as it was — into "Ask customers for
reviews", worth exactly what the two were, with a note that both halves are
behind. The score is untouched.

The platform also said "Around 200 is strong for most local businesses" to
everyone: `facts.market` was declared with a better sentence waiting on it and
was never filled in — the same universal-yardstick fault the standalone audit
tool was criticised for. `marketFor` in `src/lib/data/gbp.ts` now takes the
newest finished search run, the search the client tracks first, and the same
`searchInDetail` maths the visibility page uses. Nick Dyer's target is the
pack average of 24 for "building firm trowbridge", not 200. No search run, or
a thin one, keeps the fallback rather than inventing a number. The local app
already had this through benchmark.ts.

## A rule stated on a page says why, right there (2026-09-30)

"The name and address are not editable here" stood alone above the details
form and read as a limitation of ours. `HelpNote` (`src/components/help-note.tsx`)
is a circled question mark beside a sentence like that, opening the reason in
place: a native `<details>` with a drawn mark, so it works in a server
component with no script, and `label` goes to screen readers. Use it wherever
a sentence states a rule without room to say why — "left unscored", "we could
not see this" — rather than sending people to a help centre. `BasicsForm` is
shared by both sides, so the words are the same for the agency and the client.

The sentence itself was overstated and has been corrected everywhere it
appeared, including this file's own earlier note: re-verification LOCKS a
profile for weeks and sometimes suspends it. "Offline" is the suspension
case, not the usual one; a profile under re-verification normally stays
visible to customers while the owner cannot manage it and edits queue. The
help panel says which is which, what Google asks for (a video, a call or a
postcard), what to do instead on the Google Business Profile website, and
that everything else on the page saves to Google straight away.

A wording check on JSX must tolerate line wrapping: Prettier breaks prose
across lines, so `/saves to Google straight away/` never matches a source
that reads `saves to\n              Google`. Write `\s+` where the phrase has
a space.

## A category search answers under its box (2026-10-01)

Searching Google's category list on the details form redirected with the word
in the address bar (`?cat=`): the page reloaded at the top, a categories
section already scored as done started folded so the results sat inside a
closed box, "no match" landed as a flash a screen away, and the results were
poured into the same radio and checkbox lists as the categories already on
Google with nothing to say which was which. R&B's owner met all four.

- `CategoryPicker` (`src/components/category-picker.tsx`) is a client
  component. The search is its own form answering under its own box through
  `useActionState`; nothing navigates. `searchCategoriesStateAction` and
  `clientSearchCategoriesStateAction` return `CategorySearchState`; the
  redirecting twins are gone and verify pins that neither page reads the word
  from the address bar.
- TWO LISTS, LABELLED: "Your categories now" and "Google's categories matching
  <word>", the second holding only what the search found. One save, as
  before, because Google takes categories as one field, and only names Google
  returned can be chosen — the server still refuses anything else.
- The nine-extra limit is met at the box (`MAX_ADDITIONAL` from cat-merge.ts,
  a leaf safe in the browser), not as Google's refusal after the save.
  "Make primary" on a found category keeps the old primary as an extra: nobody
  means "remove my main category" by pressing it.
- The rule from 2026-09-30 covers search boxes as well as buttons: a redirect
  with a flash is only right when the result is at the top of the page.

The paragraph over the client's details form still said a name or address
change could take the profile "off Google for weeks", after the form's own
sentence had been corrected. Both now say lock, and sometimes suspend.

## Categories are chosen with verbs, not tickboxes (2026-10-01)

The first in-place picker was tickboxes: a pre-ticked box captioned "Also,
remove" beside every existing category and a box captioned "Also" beside
every search result. An owner searching to ADD a category unticked the first
boxes she saw, removed three she meant to keep, and never found how to add
the one she wanted. A tickbox describes state; it does not say what pressing
it does. That was the wrong model, not the wrong labels.

`CategoryPicker` is now built around what a person does here — nearly always
add one, sometimes change which is primary, rarely remove one:

- No tickboxes or radios. Every control is a verb: Add, Make primary, Remove,
  Undo, Use as primary, Search for it. An added category appears in "Your
  categories now" marked "added, not saved yet"; a removed one stays visible,
  struck through, with Undo. A line above Save says exactly what will change.
  Nothing reaches Google until Save; the chosen set travels in hidden inputs.
- The picker is keyed on `profile.categories`, so a save remounts it on
  Google's truth rather than leaving "not saved yet" on screen.
- "Categories the businesses above you use": `cachedRivalCategories` in
  competitors.ts reads the last search run's leaders and ONLY the rivals
  already cached in `gbp_competitors`, so opening the form never spends. A
  name is offered as an Add button only when `resolveCachedCategory` knows
  Google's id for it; otherwise it becomes a search, never a guess. Nick Dyer
  is offered eight (General contractor, 2 of 5, id known); R&B none until a
  search run exists.
- Search results lead with what the word begins: "Electrician" before
  "Electrical supply store".

Verify pins: no `type="checkbox"` or `type="radio"` in the picker, every verb
named, "Not saved yet:" present, the old primary kept as an extra on Make
primary, and no `rivalProfile(`/`fetch(`/`recordUsage` inside the cached read.

## The website argues for categories (2026-10-01)

A third source in `CategoryPicker`, "From your website": what the site sells
that the profile is not filed under, each offer carrying the line on the site
that argues for it. `site-categories.ts` is the pure join between site
phrases and Google's list; `websiteCategoryHints` in categories.ts feeds it.

- PRECISION OVER RECALL. The first cut offered a landscaper "Fencing school"
  (the sport), an electrician "Battery store" for "battery storage", a
  builder "Garden" (a public garden) for "Garden Walls", and an education
  company "Group home" for "SEND SCHOOL GROUP ACTIVITIES". Each was
  linguistically right and humanly absurd. Four rules, each pinned by a check
  built from one of those: a category whose LAST word names a place is
  dropped unless the business's PRIMARY category is a place; a name with no
  trade word left after form and place words go argues for nothing; a single
  bare noun is a place unless it is the whole phrase or ends the way trades
  do (-er, -or, -ist, -ian); every trade word must appear, or two of three or
  more; stems join only at five letters or more.
- The site read (`ensureSiteRead`) is free but slow, so it is cached on
  `gbp_profiles.site_read` for a week. A page open waits eight seconds at
  most; a read that finishes later is still kept for next time. The time is
  written by `sql\`now()\``, never a JavaScript date.
- Google's list is searched by STEM ("fenc"), so both readings of a word come
  back for the rules to judge. Those lookups are free on the approved API and
  fill `gbp_categories`, which held 86 rows when this began.
- Compare against the profile's CATEGORIES only. Comparing against the
  description dropped every real service on R&B's site — the description
  mentions paving and patios — and left town names to search with.
- Single-word footer links ("Legal", "Blog") are rejected by
  `looksLikeService` through the `NAV` set; "Legal" had become "Legal services".

Live: R&B is offered Deck builder, Fence contractor, Landscaper and Landscape
designer — the last two being the categories the tickbox picker cost them.
Nick Dyer gets Garage builder and Gardener. Three sites with nothing to argue
for get nothing.

## Categories: one step, kept honest (2026-10-01)

Writing to Google on every press of Add in the category picker was asked
for, considered and refused. Google takes categories as ONE field: every save
replaces the whole set, so four Adds would be four full rewrites of a live
listing inside a minute and Remove-then-Undo two more. Category edits go
through review, a burst of them can hold a profile pending, a changed primary
can trigger re-verification, and a slip — the fault that caused the rebuild —
would be public before the finger lifted. The summary line is the last look,
which every other write on the platform keeps.

So the save moved rather than the write. The "Not saved yet" line appears the
moment a change is made and carries the button ("Save 2 changes to Google");
it sticks to the bottom of the section while anything is unsaved; and there
is no other save button, because with nothing changed there is nothing to
press. `SaveForm` has `button="none"` for a form that places its own, and the
bar reads pending state through `useFormStatus`. If write-as-you-go is ever
wanted, the honest version is a timer that coalesces changes with an Undo
shown until it fires — never a write per click.

## "Fill the empty weeks" wrote one post and said it wrote none (2026-10-01)

`draftPost` returned the post's SUMMARY while being typed as `Promise<string>`.
`draftBatch` dated each new post by what came back, so it ran
`update gbp_posts set scheduled_for = … where id = "A good job starts…"`,
Postgres refused a paragraph as a uuid, the loop stopped at its first post,
and the count stayed at zero — "Nothing could be written just now", having
written one, undated. `placeUndated` dated them on the next read, which is
why they appeared at all. The job log carried the exact answer, params and
all; look there first when a button says nothing happened.

The insert now hands back the row and the id is returned; verify pins the
return and the batch's use of it. The lesson is general: a function typed as
returning a string can return the WRONG string and typecheck. Return the row,
or the id, never the words, from anything that writes.

## Posts are written one request at a time, with a bar that tells the truth (2026-10-01)

Eight posts take a minute and a half. One request wrote all of them, so the
button read "Writing…" for ninety seconds with nothing else changing — a
button somebody presses again.

- `draftNext` in queue.ts writes ONE post at the next free week. `draftBatch`
  loops over it and stays for callers with nobody watching (the daily round).
  The page drives the batch itself through `draftNextStateAction` /
  `clientDraftNextStateAction`: one request per post, `router.refresh()` after
  each so the new post appears where it will go out, and a bar saying
  "Writing post 3 of 8". A closed tab keeps what was written.
- THE ESTIMATE IS MEASURED, never typed. "About 50 seconds left" comes from
  the posts written so far in this run; before the first lands it says "the
  first takes about ten seconds". Verify fails on any constant multiplied by
  the posts left.
- The CRM is read on the first post of a batch only (`refreshCrm: step === 0`)
  and whether it was used travels back with the answer (`usedCrm`) so later
  posts are marked the same way.
- The redirecting batch actions are gone. Same rule as the map, the search and
  the categories: a redirect with a flash is only right when the result is at
  the top of the page.

## A post names only a place the profile knows, and only a job the owner reported (2026-10-01)

Six posts went into R & B Landscapes and Driveways' queue describing
driveways laid in Watford. Nothing points there: the Google service area is
Bath, Wells, Calne, Frome, Swindon and Corsham, the description and the
website say Trowbridge, no review mentions it. R&B is a service-area business
with no street address; the post writer took the town from the address
alone, told the model the firm was "in the local area", and then told it to
name the town once or twice. Given an order to name a town and no town to
name, the model invented one. The same posts described finished jobs that
never happened, because the "a job you finished recently" angle was offered
with nothing reported; and all took that angle, because the rotation counted
a list capped at eight posts.

- `post-rules.ts` is the pure half, pinned. `placeFor` takes the place from
  what is KNOWN, in order: the address, then the owner's description ("in
  Trowbridge"), then the service area with postcode districts stripped
  (`townOfPlace`), and when nothing is known the prompt says "Name NO town,
  city or area at all" — a wrong one is worse than none.
- The prompt forbids invention outright: no jobs, customers, dates, prices,
  guarantees or events that were not given. `angleFor` rotates by how many
  posts the business has EVER had (`count()`), skips "a job you finished"
  until the owner's notes say what happened, and skips "an area you serve"
  when no place is known.
- The six unapproved Watford drafts were deleted. One post written with the
  fix reads "In Trowbridge, we help with resin driveways, tarmac, block
  paving…" and names no job.

The general rule: a model told to produce a fact it has not been given will
produce one. Every "name the X" instruction must be paired with the X, or
with an instruction to name none.

## The website says where the business works (2026-10-01)

Trowbridge, Bradford-on-Avon, Westbury and Bath were in R&B's site read all
along; what the read lacked was a way to tell a town from a service, since
"Westbury" and "Decking" are the same kind of phrase to a reader of HTML.

- `placesNamed` in site-read.ts checks each place-like phrase (one to three
  capitalised words) against the free UK places lookup
  (`api.postcodes.io/places?q=`) and keeps only an EXACT match on the name:
  real towns come back under their own names, "Decking" and "Block Paving"
  come back as nothing. The confirmed towns are kept on `SiteRead.places`, in
  the site's order. Up to 25 lookups a read, in parallel, never throwing.
- `placeFor` takes the areas from the website first, then adds what Google's
  service area has that the site did not, once each. When neither the
  address nor the description names home, the first town the site names is
  home (`source: "website"`).
- A post reads the site before deciding where it is: `draftPost` calls
  `ensureSiteRead` (cached a week, eight-second wait) and builds the voice
  from the placed profile. A read taken before places were kept
  (`held.places` not an array) is read again.
- `LIKELY` keeps the home and services pages within the four fetched, then
  the area pages ("/areas-we-cover", "/areas"); a check pins that "/services"
  is among the four.

Live: R&B's read holds Trowbridge, Bradford-on-Avon, Westbury, Melksham,
Frome, Warminster, Chippenham, Devizes and Bath, and a post written with it
names Trowbridge, serves those, and describes no job.

## Every prompt that may name a place is given one, or told to name none (2026-10-01)

The post writer was fixed for Watford; the description draft and the review
reply had the same hole. `suggest.ts` fed the model "Town: unknown" and then
ordered it to "front-load where (town names)"; `replies.ts` said the business
was "in the local area" and then told the model to "echo the town naturally".
One of R&B's PUBLISHED replies reads "the front path and patio in the local
area" — the prompt's own placeholder echoed back under a customer's name. A
description is more permanent than a post; a reply sits on a review for good.

- All three prompts take their place from `placeFor` in post-rules.ts (the
  address, the owner's description, the website's confirmed towns, Google's
  service area, in that order) and, when nothing is known, say so in terms
  the model cannot misread: "Home town: NOT KNOWN. Name no town, city or
  area." The reply reads the site first (`ensureSiteRead`), as the post does.
- One sentence shared by all three, pinned: "Do not invent. No jobs,
  customers, dates, prices, guarantees, events or places that are not in
  what you are given."
- The description's evidence (`townInFirst250`) judges the town that was
  actually known, not the address alone.

The rule, generally: never write a prompt that says "name the X" without
supplying the X or saying "name none". A model asked for a fact it has not
been given will produce one, and the hole shows up on whichever field is
most permanent. The Theresa reply is still live as written; changing a
published reply is the agency's call, not the software's.

## Serper ran out of credits, and every map finished "done" and empty (2026-10-01)

At about 12:45 on 30 September the platform's Serper account ran out of
credits. From then on every map point, keyword search and free check was
answered `400 {"message":"Not enough credits"}`. `mapsAt` threw "Serper
answered 400." without the body; the map advance treated each refusal as a
point that could not be read, marked the run "done" once every point had
been attempted, and drew an empty map. Nine runs across three businesses
reported success. "Check the map still doesn't generate the map results" was
the whole account, not the button.

- `SerperUnavailable` now carries Serper's own message and a `fatal` flag
  when the refusal is about the ACCOUNT (credit, key, quota, or 401/402/403)
  rather than the search; `refused(res)` reads the body. No refusal discards
  its reason.
- The map (`advanceGridRun`), the searches (`advanceKeywordRun`) and the
  directory check (`advanceCitationRun`) each stop on a fatal refusal: the
  run is marked `error` with "The search service has refused the platform:
  … Nothing can be searched until that is put right", points and rows are
  left unread for a later run, and nothing is recorded as spend.
- A map search doubled the town ("… cambridge cambridge"); `startGridRun`
  now folds it with `tidyPhrase`.

Two lessons. Read the BODY of a refusal; the status alone said nothing.
And "done" must mean read, not attempted: a run whose every point errored is
not finished, it is stopped, and the page must say which. Topping the Serper
account up is the only cure for the refusal itself; the platform cannot.

## A service-area business is centred on the town it names (2026-10-01)

R & B Landscapes works from a van and has no address, so the map page said
Google had given it no position and offered no button, and "Suggest
searches" refused it with "no town on its profile". Its town was in its
description, on its website and at the head of its Google service area.

- `ensureCentre` falls back, after the address, to the home town decided by
  `placeFor` — the SAME rule the posts, the replies and the description use,
  so the map and the words never disagree about where a business is —
  looked up on OpenStreetMap as `source: "town"`. The last resort is the
  middle of the first postcode district in the Google service area
  (`fromServiceArea`, postcodes.io `/outcodes/`), `source: "service area"`.
  `storedCentre` keeps both sources; `centreNote` has words for each.
- Both visibility pages call `await ensureCentre(profile)` on view, so the
  centre is worked out the first time rather than read only from what was
  stored. The button appears.
- `suggestKeywords` takes the town from `placeFor` too, and refuses only when
  no town is named anywhere, saying which four places would do.

Live, with the credits back: R&B centred on Trowbridge from the town it
names; a nine-point map for "driveways trowbridge" read every point and
placed it first or second at each; eight searches suggested, all in
Trowbridge. The rule, generally: there is ONE answer to "where is this
business", `placeFor`, and anything that needs a town asks it.

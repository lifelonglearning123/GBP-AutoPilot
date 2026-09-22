# GBP Autopilot

Local Next.js app that runs the local SEO checklist against every Google Business Profile the
agency account manages. Internal tool first; the code is shaped so a white-label version is a
hosting change, not a rewrite.

| Rule (from the checklist) | Where it lives | Automation |
|---|---|---|
| 1. Claim and fill every field | Audit & fill tab | Claim/verification is manual. Description, categories, services are proposed by gpt-5.5, approved, then written via the API. |
| 2. Reviews and replies echoing services/town | Reviews tab, hourly job | Polled hourly. Drafts a reply per new review; posts automatically if auto-reply is on, otherwise waits for approval. |
| 5. Every category | Audit & fill tab | Candidates come from Google's own category list; the model picks, never invents. |
| 6. Weekly Google Post | Posts tab, weekly job | Rotating angles (service, seasonal, review story, FAQ, behind the scenes, local). Draft or auto-publish. |
| 4, 7, 8. Service × location pages, schema, directions | Website tab | Generates a static site: home, contact, per service, per area, per service×area. LocalBusiness + Service + FAQ + Breadcrumb JSON-LD and a Get Directions button on every page. |
| 3. NAP consistency | Citations tab | Serper finds every page mentioning the business, gpt-5.5 extracts the NAP each page shows, the app diffs it against the profile and lists key UK directories with no listing. Read-only: pushing fixes is a first-party API (Facebook, Bing, Apple) or a partner (Synup / BrightLocal). |

## Scoring and the competitor benchmark

The score is out of 100 and **graded**: each check earns part of its weight on a sliding scale.
Reviews 40 (count 12, rating 10, new in 90 days 10, replies 8), consistency 15, profile 20,
categories 12, activity 5, basics 8. Basics are deliberately light because every business Google
Maps shows already has them. Review count uses a log scale; rating is pulled towards 4.3 when there
are few reviews. Weights live in `WEIGHTS` in `src/lib/audit.ts`.

The **Competitors** tab searches Google Maps (Serper Places, 2 pages = 20 businesses, 2 credits,
cached per phrase for 24h) for the phrase a customer would type, proposed by the LLM from what the
business sells ("garden rooms in Nuneaton", not Google's "glass merchant"). Review count in the score
is judged against the first three businesses shown. Prospecting batches rank each business inside the
search they came from. Fewer than 5 results is treated as a bad phrase and left out of the score.

## Multi-search competitor analysis

The Competitors tab tracks about 8 customer searches per business (suggested from services, Google
categories and Google autocomplete; tick, untick or add your own). Each is checked on Google Maps
(first 20, cached per phrase for a day) and scored by position: 1st 100 points, 2nd 70, 3rd 50,
falling to 10 at 10th, 3 for 11th-20th, 0 if absent. The average is the **share of local search**,
computed for every business that appears, which gives the "Who shows up most" leaderboard. The top 5
competitors' full profiles (cached a week) are compared to find category gaps, searches it claims a
category for but does not rank in, and review gaps.

Each search's intent (are the results businesses like this one?) is judged once by the LLM and the
verdict reused, so the share does not move because the model changed its mind. Serper failures
("Scraping failed", returned as a 200) are errors retried next run, never "no results". Run-to-run
change is measured only on searches scored in both runs. Every run is stored in `keyword_runs` /
`keyword_ranks`; tracked clients re-check weekly, prospects only on demand or when a report is built.
Not built yet: the map grid (rank from points around the business), which needs Serper `/maps` with
`ll` (3 credits a call; `/places` ignores a searcher location).

## Map grid

The Map tab checks rank from a grid of points (3x3, 5x5 or 7x7; 0.5 to 5 miles) around the business
for chosen searches, via Serper `/maps` with a searcher location (`ll`), 3 credits per point, in the
background with progress. The town is dropped from the phrase ("electrician", not "electrician in
Swindon"). Rendered over OpenStreetMap tiles with plain positioned HTML (no map library), in the app
and in the report.

Zoom is chosen from the radius (`zoomFor`: 14 up to 1 mile, 13 for 2, 12 for 3, 11 for 5). Serper
searches with a landscape screen (about 1280x800, inferred), so a fixed zoom made businesses vanish
2 miles north/south but not east/west, which is screen shape, not ranking. Wider maps therefore search
a wider area and look more even; 1 mile or less shows distance decay most faithfully. Maps are only
compared with earlier maps of the same size, radius, zoom and wording.

Wording can matter as much as location. By default the town is dropped from each search ("roofer",
as typed by someone nearby); "Keep the town in each search" searches "roofer in Chippenham" to match
the Competitors tab. Ridgeline Roofing is nowhere for "roofer" but 5th for "roofer in Chippenham" and
"roofing company"; J's Electrical ranks the same for all three electrician wordings. Empty Serper responses are retried and
then marked "could not be read", never "not found". Optional monthly re-map repeats the last settings.

## Help / FAQ

User-facing questions live in the app at `/help` (sidebar: Help), sourced from `src/lib/faq.ts`.

## Hand-added businesses and the public Google listing

The best way to add a business is **Add a business → Paste Google link**. Maps address-bar URLs,
maps.app.goo.gl and share.google links all resolve to the exact listing (a Maps URL carries a feature
id whose second half is the cid). Every detail then comes from Google, via Serper, with no Business
Profile API needed: name, address, phone, all categories, hours, place id, map pin, rating, review
count and the 20 newest reviews with whether the owner replied.

Typed-in businesses are auto-matched to a listing only when the name agrees **and** the postcode or
phone agrees; anything weaker is left unlinked with candidates to pick from. Once matched, Google's
details become the reference for the citation audit, and whatever was typed is kept aside and shown
to you (never in the client report) where it differs.

The audit has three states per check: pass, fail, and **not checked**. Description, services, posts
and photos are not visible publicly, so for hand-added businesses they are not checked and are left
out of the score. The score shows the share of the checklist it covers; under 50% it is shown grey.

## Manual businesses

"Add a business by hand" on the dashboard creates a location with no Google side (id `manual/...`).
The citation audit, website generator and AI suggestions work on it; every Google write path refuses
it with a clear message. Use it to audit a prospect before you manage their profile.

## Prospecting, reports and GHL

- **Prospecting** (sidebar): paste a CSV or search Google Maps via Serper ("electricians in St Albans"). Each
  business becomes a manual location and gets a citation audit, up to the batch budget. Ranked worst-first.
- **Report**: every location header has Build report → a self-contained branded HTML page
  (score, findings, three actions, checklist, citation table, missing pages). Files land in `output/reports/`.
  Agency name, logo and colour come from Settings.
- **Push to GHL**: upserts the contact in the configured sub-account, uploads the report to the Media
  Library, adds a note with the findings, and creates an opportunity if a pipeline stage is set. Needs a
  Private Integration token (contacts, opportunities, medias scopes) on Settings.

## Google-side extras (live once API access is approved; mocked now)

- **Q&A tab**: gpt-5.5 drafts owner-seeded questions and answers, posted as question + owner answer.
- **Photo queue** (Posts tab): public image URLs with captions, released one every N days by the scheduler.
- **Performance stats**: Business Profile Performance API synced daily; 28-day views, calls, website
  clicks and directions with the change on the previous 28 days, on each location and the dashboard.

## Run

```
copy .env.local.example .env.local     # add OPENAI_API_KEY + SERPER_API_KEY
npm install
npm run dev                            # http://localhost:3320
```

The dev script raises Node's HTTP header limit, because a browser with many localhost apps sends a cookie
header bigger than the 16KB default and every request then fails with a 431 that renders as a blank error page.

`next dev --webpack` is deliberate: Turbopack panics on Windows ARM64 with Google fonts. Node 24
supplies `node:sqlite`, so there is no native build step. The database is `data/gbp.db`, the
generated sites land in `output/<slug>/`. Both are git-ignored.

## Mock mode

`GBP_MOCK=1` makes the Business Profile client serve two fixture locations, six reviews and a small
category list, so every screen and job can be exercised without Google. It is opt-in: with it unset,
the app runs for real, and anything needing Google says so plainly instead of inventing data.

Without Google access you can still add businesses by hand and use citation audits, reports,
the website generator and prospecting. Deleting a location only removes it from this app; a later
sync re-adds any profile the connected account still manages.

## Google access through Pipedream (while Google reviews API access)

Google gives the project zero Business Profile API quota until it approves the access request.
Meanwhile the app can borrow Pipedream's approved Google app: a small Pipedream workflow
(`pipedream/google-token.mjs`) hands the app a short-lived token for the Google account connected
there, guarded by a shared secret. Setup steps are in `pipedream/SETUP.md`.

- On when both `PIPEDREAM_TOKEN_URL` and `PIPEDREAM_TOKEN_SECRET` are set in `.env.local`; the
  sidebar then says "Google: via Pipedream". Clear the URL to go back to the app's own OAuth.
- Settings has a **Test Google access** button that lists accounts and locations.
- The first sync links hand-added businesses to their Google profiles (matched on place id or Maps
  cid) and moves their history across; their public-listing reviews are replaced by the API's.
- Performance stats may fail through Pipedream if its Google project lacks that API.

## Going live

1. Google Cloud: create a project, submit the Business Profile API access request from an account
   that manages a verified profile. Wait for approval (days to a couple of weeks).
2. Enable the seven "My Business" APIs. Consent screen scope `business.manage`, audience
   **Internal** with Workspace, otherwise **External published to "In production"** (External in
   Testing expires the refresh token after 7 days, which kills the scheduler a week later).
   OAuth client: Web application, redirect
   `http://localhost:3320/api/auth/google/callback`.
3. Put the client id/secret in `.env.local`, remove `GBP_MOCK`, restart.
4. Settings → Connect Google with the Workspace account that every client has added as a
   **Manager** on their profile. Dashboard → Sync.

The three API hosts: Business Information v1 (locations, categories), Account Management v1
(accounts), and the legacy v4 host (reviews, posts, media). `validateOnly` exists on location
patches; there is no sandbox.

## Scheduler

`src/instrumentation.ts` starts an in-process ticker (every 5 min) when the server boots. Per
location it polls reviews hourly and runs the weekly post when `next_post_at` has passed. A missed
slot runs at the next tick rather than being skipped. "Run scheduler now" on the dashboard forces a
tick.

## Layout

```
src/lib/gbp.ts        Business Profile API client + mock switch
src/lib/gauth.ts      Google OAuth (single agency connection)
src/lib/locations.ts  sync, parsed view, per-location config
src/lib/audit.ts      weighted checklist → score
src/lib/suggest.ts    LLM proposals → approve → patch
src/lib/reviews.ts    poll, draft, post replies
src/lib/posts.ts      weekly post generation + publish
src/lib/site.ts       page matrix, LLM content, render, schema, build
src/lib/citations.ts  NAP audit: search → fetch → extract → diff; key directory list
src/lib/public.ts     public Google listing via Serper: link resolution, matching, enrichment
src/lib/benchmark.ts  competitor benchmark: market search, self-match, local stats
src/lib/keywords.ts   multi-search visibility: suggestions, intent, share, leaderboard, gaps, history
src/lib/grid.ts       map grid: points, zoom by radius, background runs, summaries, OSM layout
src/lib/nap.ts        phone/postcode/name normalisers + HTML entity decoding
src/lib/report.ts     prospect report data + HTML
src/lib/ghl.ts        GoHighLevel push (contact, media, note, opportunity)
src/lib/prospects.ts  batches: CSV / Serper Places intake, background runner
src/lib/extras.ts     Q&A seeding, photo queue, Performance metrics
src/lib/agency.ts     agency branding + GHL settings (settings table)
src/lib/scheduler.ts  ticker
src/app/api/action    every mutation as { action, ...params }
```

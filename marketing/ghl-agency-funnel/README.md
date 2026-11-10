# GHL agency funnel (option A)

One page that sells the platform to agencies that run on GoHighLevel (GHL).
Every button goes to `https://gbp.macaws.ai/signup`.

**To look at it, double-click `index.html`.** Nothing to install: no build, no
database, no Supabase, no forms, no cookies, no analytics.

## What is in the folder

| Path | What it is |
|---|---|
| `index.html` | The page. |
| `img/` | Six real images (the before/after maps, four live brand pages) and the video poster. |
| `video/tour.mp4` | A 40-second tour: the map, the ranking, the competitors, the report in four brands, the one-list view. 0.8 MB. |
| `tour-source/tour.html` | What the video is made from. Open it to watch the tour loop. |
| `tour-source/record.js` | Re-records the video (see below). |

## The angle

GHL already covers reviews, so the page never mentions them. It leads with what
GHL agencies do not have: **the map, the ranking and the competitor analysis**,
under the agency's own brand, landing in their GHL.

## What is real and what is drawn

| | |
|---|---|
| **Real** | The before/after Swindon maps (your shopfronts use them). The four live brand pages: macaws.ai, Leonardo Power, Artificial Ignorance, Growtth ai (public pages, captured 2026-10-12). |
| **Drawn, example data** | The rank grid, the share-of-search board, "Why the leaders are ahead", the report, the one-list view, and all of the tour video. Each is labelled "Example". The figures (970, 370, 2nd of 49, 67.1% ...) are the platform's own labelled example, rivals' names left off. |
| **Not used** | The two promo videos in git history (`Boosting Local Rankings...mp4`, `Top Rankings...mp4`). They are raw screen recordings of the local app with browser tabs, an email address and real client names visible. Do not publish them. |

## Where each claim comes from

| On the page | Source |
|---|---|
| Share of local search, weekly; the 25-point map; first at the door, sixteenth at the edge | `gbp.macaws.ai/for-agencies` and the home page, read 2026-10-12 |
| Before and after captions | `platform/src/components/agency-shopfront.tsx` |
| "N of the 5 most visible competitors list X as a Google category" | `platform/src/lib/gbp/compare.ts` line 249 |
| "Not in the top 20 for ..." | `platform/src/lib/gbp/compare.ts` line 270 |
| "... yet they still come above you" | `platform/src/lib/gbp/head-to-head-rules.ts` line 221 |
| Leads become tagged GHL contacts | `platform/src/lib/ghl.ts` `addGhlLead` |
| An audit becomes a contact, a note and a task | `platform/src/lib/gbp/ghl-push.ts` `pushToGhl` |
| Invites and password links leave from your sub-account | `platform/DEPLOY.md` 4c |
| £149 + £5, no trial, no contract, clients pay you | `gbp.macaws.ai/signup` and the home page |
| The two exceptions to white label | the home page FAQ, "Where are the seams in the white label?" |

## What must match the platform

1. **The price.** Search `index.html` for `EDIT HERE` (hero and price section).
   It is also on the video's last card (`tour-source/tour.html`, search `£149`),
   so re-record after changing it.
2. **"No trial."** The platform's own pages say there is none. If that changes,
   change the hero line, the price note and the first FAQ answer together.
3. **The four brand screenshots** show those pages as they were on 2026-10-12.

## Re-recording the video

From this folder, after editing `tour-source/tour.html`:

```
node tour-source/record.js
```

It needs Google Chrome, `ffmpeg` on the PATH, and puppeteer-core (it is already
in `../../platform/node_modules`). It renders 960 frames and takes about two
minutes. To check one moment without recording everything:

```
node tour-source/record.js still 26.4 out.png
```

## What it deliberately does not do

- No free grader or free audits (option B: new platform code and a practice database).
- No visitor counting. Add analytics only when you have chosen one.
- It loads two fonts from Google Fonts, as the platform itself does.

## Publishing

Not decided. Upload `index.html`, `img/` and `video/`. `tour-source/` is not
needed on the web. Any static host works; check its terms allow a commercial page.

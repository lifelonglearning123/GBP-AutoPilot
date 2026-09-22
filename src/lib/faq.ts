/**
 * The in-app FAQ (rendered at /help). Single source: keep it true to how the app behaves, and
 * update the matching entry whenever that behaviour changes.
 *
 * Inline formatting in strings: `code` and **bold**.
 */
export type Block =
  | string
  | { steps: string[] }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }
  | { code: string }
  | { tip: string };

export type Faq = { id: string; q: string; a: Block[] };
export type FaqSection = { title: string; items: Faq[] };

export const FAQ: FaqSection[] = [
  {
    title: 'Adding a business',
    items: [
      {
        id: 'which-link',
        q: 'Which Google link should I paste?',
        a: [
          'Paste a **Google Maps** link. It carries the business’s ID in the address, so the app finds the exact listing every time, whatever the business is called.',
          {
            table: {
              head: ['Link starts with', 'Where it comes from', 'Reliable?'],
              rows: [
                ['`google.com/maps/place/`', 'The Google Maps address bar', 'Yes, always exact'],
                ['`maps.app.goo.gl/`', 'Share button in Google Maps', 'Yes, always exact'],
                ['`share.google/`', 'Share button in Google Search or the Google app', 'Only sometimes'],
                ['`google.com/maps/search/`', 'Google Maps before you click a business', 'No, it has no business ID'],
              ],
            },
          },
        ],
      },
      {
        id: 'link-computer',
        q: 'How do I get a Google Maps link on a computer?',
        a: [
          {
            steps: [
              'Go to `google.com/maps`.',
              'Search for the business.',
              '**Click the business** so its details panel opens on the left.',
              'Copy the address from the browser’s address bar. It should start with `google.com/maps/place/`.',
            ],
          },
          'Or, with the panel open, click **Share** then **Copy link**. That gives a `maps.app.goo.gl/` link, which works just as well.',
        ],
      },
      {
        id: 'link-phone',
        q: 'How do I get one on a phone?',
        a: [
          'Open the **Google Maps app**, not Google Search. Find the business, tap **Share**, then **Copy link**.',
          { tip: 'The Share button in Google Search and the Google app gives a `share.google/` link instead. See the next question for why that is less reliable.' },
        ],
      },
      {
        id: 'share-wrong',
        q: 'Why did my share.google link pick the wrong business, or none?',
        a: [
          'A `share.google/` link does not point straight at the business. It opens a Google Search page for it. Sometimes that page includes the business’s ID and the match is exact. When it does not, only the business name comes through, and the app searches for a listing with that name.',
          'Names with an **ampersand**, such as "Mortlock & Joyce - Estate Agents covering Kent & SE London", used to be cut short at the "&" and could match a different business. That is fixed: the full name is read, and the app only accepts a listing whose name matches. It never picks "the first result" any more.',
          'When the match came from the name alone, the preview says **"Matched by name from the link. Check this is the right business before adding."** If no listing has the name, or several do, the app says so and lists the closest names instead of guessing.',
          { tip: 'A Google Maps link (google.com/maps/place/ or maps.app.goo.gl/) identifies the business exactly every time. Use one whenever a share link is not matched.' },
        ],
      },
      {
        id: 'maps-search',
        q: 'My Maps address bar shows /maps/search/. What is wrong?',
        a: [
          'You have searched but not opened the business yet, and a search address has no business ID in it. Click the business in the results list so its panel opens. The address then changes to `/maps/place/`.',
        ],
      },
      {
        id: 'wrong-business',
        q: 'I added the wrong business. How do I fix it?',
        a: [
          'Open the business in the app. In the **Public Google listing** panel, click **Wrong business?**, then either paste the correct Google Maps link or click **Find on Google** and pick the right one from the list. The audit re-reads everything from the correct listing.',
          'If you would rather start again, click **Delete** on the business and add it with the right link.',
        ],
      },
      {
        id: 'no-profile',
        q: 'What if the business has no Google profile, or I have no link?',
        a: [
          'Choose **Enter by hand** in **Add a business**. The audit then covers what you typed plus the citation audit, and anything that needs Google shows as "not checked".',
          'If the business does have a Google profile, the app links it automatically, but only when the name **and** the postcode or phone agree. Anything less certain is left unlinked, and **Find on Google** on the business’s page shows candidates for you to pick from. The app never audits a guessed match silently.',
        ],
      },
    ],
  },
  {
    title: 'Reading the audit',
    items: [
      {
        id: 'score',
        q: 'How is the score worked out?',
        a: [
          'Out of 100, weighted towards what moves local rankings most. Each check earns **part** of its points on a sliding scale, rather than all or nothing, so 13 new reviews a quarter scores more than 3, and nine categories more than two.',
          {
            table: {
              head: ['Group', 'Points', 'What earns them'],
              rows: [
                ['Reviews', '40', 'Number of reviews (12), star rating (10), new reviews in the last 90 days (10), replies to reviews (8)'],
                ['Consistency', '15', 'Name, address and phone matching across the web, and enough listings for Google to cross-check'],
                ['Profile', '20', 'Opening hours, description, services list, photos'],
                ['Categories', '12', 'Extra categories beyond the primary one; five or more earns the full points'],
                ['Activity', '5', 'A Google Post in the last week'],
                ['Basics', '8', 'Name, phone, website, address, map pin, primary category, verified'],
              ],
            },
          },
          'Basics carry few points on purpose: every business Google Maps shows already has most of them, so they tell you little about who is ahead.',
          'Review **count** is judged against the three businesses Google Maps shows first for the same search, because "enough reviews" depends on the local market. The star rating is pulled towards 4.3 when there are only a handful of reviews, so 4.8 from 8 reviews is not treated like 4.8 from 800.',
          'Each check on the business’s page shows the points it earned, so any score can be traced line by line.',
        ],
      },
      {
        id: 'competitors',
        q: 'Where do the competitors and the local position come from?',
        a: [
          'From a Google Maps search for the phrase a customer would type, such as **"electrician in Swindon"**. The app reads the first 20 businesses shown, finds this business among them, and compares reviews and rating with the rest. The first three shown matter most, because they are the ones most customers call.',
          'The phrase is suggested from what the business actually sells, which the name often reveals better than Google’s category. Glass Garden Rooms’ Google category is "Glass merchant", but customers search for "garden rooms in Nuneaton". You can change the phrase on the **Competitors** tab.',
          'Businesses in the same market share one search for a day, so comparing twenty electricians in Swindon costs the same as comparing one.',
        ],
      },
      {
        id: 'share-of-search',
        q: 'What is "share of local search"?',
        a: [
          'One number for how visible a business is across **all** the searches its customers use, not just one. Each search is checked on Google Maps, and the business earns points for where it appears: most for first, then second and third (the three most customers call), a little for fourth to tenth, almost nothing below that, and nothing if it is not in the first 20. The share is the average across the searches, so 100% means first for every one.',
          'The same calculation for every other business that appears gives the **Who shows up most** leaderboard. That is usually the clearest answer to "who are we really up against": J’s Electrical is 1st for consumer unit replacement but 3rd overall, because EM Electrical is in the top three for seven of the ten searches.',
          'When the searches are checked again, the change is measured only on searches checked both times, so adding or dropping a search does not look like progress.',
        ],
      },
      {
        id: 'keywords-chosen',
        q: 'How are the searches chosen, and can I change them?',
        a: [
          'Click **Suggest searches** on the **Competitors** tab. The app proposes 10 to 12 from the business’s services, each Google category it claims, and Google’s own autocomplete, which shows how customers really phrase things. Autocomplete also suggests jobs, courses and other towns, which are left out. The first eight are tracked; tick or untick any of them, and add your own.',
          'Services entered on the **Configure** tab make the suggestions much better. A business with no services entered only gets searches based on its trade and categories.',
          'Each search costs about 2 Serper credits per check and is shared with every business in the same town for a day.',
        ],
      },
      {
        id: 'wrong-results',
        q: 'Why is a search marked "wrong kind of results"?',
        a: [
          'Some phrases return a different kind of place from the business. "EV charger installation Swindon" returns public charging stations, not the electricians who fit chargers. Counting that search would make the business look invisible for work it may win every week.',
          'Those searches are left out of the share, and where there is a clearer phrase the app offers it, for example **Use "EV charger installer Swindon" instead**, in the list of searches. A search Google could not be read for is also left out and simply retried on the next check.',
        ],
      },
      {
        id: 'weekly-check',
        q: 'How often are the searches re-checked?',
        a: [
          'Every week, for any business with searches ticked and **Weekly** switched on, while the app is running. Businesses added through Prospecting start with Weekly switched off, so a batch of prospects is only checked when you ask. **Check again** re-checks straight away.',
          'Building a report also re-checks the searches if the last check is more than a week old.',
        ],
      },
      {
        id: 'map-grid',
        q: 'What does the map show?',
        a: [
          'Where customers can find the business. The **Map** tab searches Google Maps from a grid of points around the business, as if a customer standing at each point searched for, say, "electrician". Each circle shows the business’s position from that spot: green for the top three, amber for 4th to 10th, red for 11th to 20th, grey when it is not in the first 20. Click a circle to see the same search on Google Maps.',
          'Google weighs distance heavily, so the map often tells a very different story from a single search. It also shows **who is first across the map**: for "electrician" around J’s Electrical, EM Electrical is first at all 25 points, which is why it leads Swindon overall.',
          'The first map uses just the main search, to keep it cheap. Tick more searches to map them too; each gets its own tab.',
        ],
      },
      {
        id: 'map-settings',
        q: 'Which grid size and distance should I choose?',
        a: [
          '**5 × 5 at 2 miles** covers most towns well and costs about 75 Serper credits per search. A 7 × 7 grid gives a finer picture for 147 credits per search; 3 × 3 is a cheap first look at 27.',
          'Distances come in two groups. **Close range (0.5, 1 and 2 miles)** searches every spot the same way, so a spot gives the same position whichever of the three you pick; the distance only decides how far out the grid reaches. Use it to see where customers stop finding the business.',
          '**Wider area (3 and 5 miles)** searches further zoomed out, so the business stays in view from points that far away. It shows ranking across a district, and its positions are not comparable with close-range maps.',
          'Points already checked the same day are reused free, and the cost is shown before you start.',
        ],
      },
      {
        id: 'map-wording',
        q: 'Why is a business missing from the map but ranked on the Competitors tab?',
        a: [
          'Because the map searches the plain word someone nearby types, such as **"roofer"**, while the Competitors tab searches **"roofer in Chippenham"**. For some businesses that makes no difference: J’s Electrical is 2nd for "electrician", "electrician near me" and "electrician in Swindon" alike. For others it is the whole story: Ridgeline Roofing is 5th for "roofer in Chippenham" and for "roofing company", but not in the first 20 for plain "roofer", even searched from its own address.',
          'That usually means Google links the business with one word and not another. Ridgeline’s name and category say "roofing"; nothing on its profile says "roofer". Reviews, a description and services that use the missing word help Google make the connection.',
          'Tick **Keep the town in each search** to map it the Competitors-tab way. Maps searched with different wording are never compared with each other.',
        ],
      },
      {
        id: 'map-compare',
        q: 'Can I compare maps made at different distances?',
        a: [
          'You can now read them side by side: 0.5, 1 and 2 mile maps are all searched at the same zoom, so the same spot gives the same position on each. The zoom matters because it changes the ranking: from the same spot, Nick Dyer read 1st at one zoom and 6th at another.',
          'The 3 and 5 mile maps use a wider zoom and are only compared with each other. Maps made before distances were grouped kept their own zoom. Change since last time is shown against an earlier map with the same grid and distance; keep the same settings month to month (the **Monthly** option does this).',
        ],
      },
      {
        id: 'position-differs',
        q: 'Why is the position different from what I see on my phone?',
        a: [
          'Google Maps ranks by distance from the person searching as well as by the profile, and the app searches without a fixed location. Your phone uses where you are standing. The wording matters too: J’s Electrical is 2nd for "electrical installation service in Swindon" and 4th for "electrician in Swindon".',
          'Treat the position as a guide to how the business compares, not an exact rank every customer will see. The reviews and rating comparison does not depend on location.',
        ],
      },
      {
        id: 'thin-market',
        q: 'The comparison says too few businesses came back.',
        a: [
          'Fewer than five results usually means the search phrase is not one customers use, not that the business has no competitors. Open the **Competitors** tab, type the everyday name for the trade plus the town, and click **Re-run**. Until then the comparison is left out of the score.',
        ],
      },
      {
        id: 'not-checked',
        q: 'Why do some checks say "not checked"?',
        a: [
          'The app only scores what it can actually see. For a business added by link or by hand, Google shows the categories, hours, verification, map pin, rating and recent reviews publicly. It does not show the description, services list, posts or photos.',
          'Those four are marked **not checked** and left out of the score rather than counted as failures. The report says so in plain words. Connecting the profile through the Business Profile API lets the app check them.',
        ],
      },
      {
        id: 'grey-score',
        q: 'Why is the score grey with "only X% checked"?',
        a: [
          'The score covers only the checks the app could see. When that is under half the checklist, the number says more about what was out of view than about the business, so it is shown grey instead of green, amber or red. Link the business to its Google listing to raise the coverage.',
        ],
      },
      {
        id: 'phone-differs',
        q: 'Why is the phone number different from the one I typed?',
        a: [
          'Once a business is linked to its Google listing, the app treats Google’s details as the reference, because that is what customers and directories copy. The citation audit compares every other listing against it.',
          'What you typed is kept and shown in the **"What was typed in differs from Google"** box on the business’s page. It is never put in the client report, because it is your data entry rather than something the business told you.',
          'If the business says the number you typed is the right one, the advice is to update their Google profile to match, and then every directory.',
        ],
      },
      {
        id: 'read-only',
        q: 'Why can’t I post review replies or Google Posts for this business?',
        a: [
          'Businesses added by link or by hand are **read-only**. Writing to Google needs the profile connected through the Business Profile API, with your Google account added as a Manager on it. You can still draft replies and posts in the app to show the client.',
        ],
      },
    ],
  },
  {
    title: 'Setup and troubleshooting',
    items: [
      {
        id: 'page-not-working',
        q: 'The browser says "This page isn’t working".',
        a: [
          'This is usually your browser sending a very large set of cookies to `localhost` from your other local apps, which the server rejects. The start script already raises the limit, so first make sure you are running the current version:',
          { code: 'npm run dev' },
          'If it still happens, open `http://127.0.0.1:3320` instead of `localhost`. The browser keeps separate cookies for it.',
        ],
      },
      {
        id: 'page-freezes',
        q: 'A tab freezes when I click it, but works in Incognito.',
        a: [
          'A Chrome extension is interfering with the page. Incognito switches extensions off, which is why it works there. On the PC this app was built on, the culprit was **Jetwriter AI** (formerly ChatGPT Writer): it attaches a writing box to every text box it finds, and it locked up the Competitors tab as soon as the search box appeared.',
          {
            steps: [
              'Click the **puzzle-piece icon** at the top right of Chrome.',
              'Click the **three dots** next to the extension.',
              'Under **This can read and change site data**, choose **When you click the extension**.',
            ],
          },
          'The extension then only runs when you click its icon, so it still works on other sites when you want it.',
          { tip: 'To tell whether the app or an extension is at fault, open the same page in an Incognito window (Ctrl+Shift+N). If it works there, it is an extension.' },
        ],
      },
      {
        id: 'port-in-use',
        q: 'Starting the app says "address already in use :::3320".',
        a: [
          'Another copy of the app is already running. Either use that one at `http://localhost:3320`, or stop it and start again. In PowerShell:',
          { code: 'Get-NetTCPConnection -LocalPort 3320 -State Listen | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }' },
        ],
      },
      {
        id: 'quota-zero',
        q: 'Sync from Google says the quota was exceeded (429).',
        a: [
          'The Business Profile API access request has not been approved yet. Until it is, Google gives the project a quota of **zero**, so the very first call fails with a quota error. Waiting and retrying will not clear it.',
          'To check, open Google Cloud, go to **APIs & Services** then **Quotas**, and filter for a Business Profile API. **0** requests per minute means not approved yet. **300** means you are live.',
          'Businesses added by link work without API access. To use the Google features while you wait, see the next question.',
        ],
      },
      {
        id: 'pipedream',
        q: 'How do I use the Google features while Google reviews my API access?',
        a: [
          'Borrow Pipedream’s approved Google connection. You connect your Google account once in a small Pipedream workflow, and the app fetches a short-lived Google token from it. Reviews, posts and profile edits then use Pipedream’s Google allowance instead of your project’s, which stays at zero until Google approves it.',
          'Setup takes about ten minutes and is written out step by step in **pipedream/SETUP.md** in the project folder. When it is done, open **Settings**, press **Test Google access**, then press **Sync from Google** on the dashboard.',
          'The first sync links each business you added by hand to its Google profile, matched by its Google place, and keeps its keywords, maps and reports. Nothing is duplicated.',
          'Pipedream\u2019s free plan allows **3 credits a day**, and each Google token costs one and lasts about an hour. So the app checks reviews and publishes posts and photos in two windows, at **9:00 and 14:00**, and keeps the third token for things you do yourself, like a sync or approving a reply. Settings shows how many are used today. Once all three are used, Google features wait until the daily reset.',
          'You can connect more than one Google account in Pipedream, for example one that manages a client’s profile. Each business then uses the login that manages it, and one Pipedream run fetches tokens for all of them, so it costs no extra credits. The steps are in **pipedream/SETUP.md** under Adding another Google account.',
          'Performance stats may not work through Pipedream, because its Google project may not have that API switched on. When Google approves your own access, remove **PIPEDREAM_TOKEN_URL** from .env.local and the app goes back to your own connection.',
        ],
      },
      {
        id: 'testing-mode',
        q: 'Connecting Google says "Access blocked… the app is currently being tested".',
        a: [
          'The OAuth consent screen is still in **Testing**. In Google Cloud, open **Google Auth Platform**, then **Audience**, and click **Publish app** so the status reads **In production**. If the button is disabled, fill in the app name, support email and developer contact on the **Branding** page first.',
          { tip: 'Leaving it in Testing also makes Google expire the connection every seven days, which silently stops the weekly posts and review replies.' },
        ],
      },
      {
        id: 'unverified-warning',
        q: 'Google shows "Google hasn’t verified this app" when I connect.',
        a: [
          'That is expected for a published app that has not been through Google’s verification review. Click **Advanced**, then **Go to GBP Autopilot**. Only your own account ever connects, because clients add your account as a Manager on their profile rather than signing in here.',
        ],
      },
    ],
  },
];

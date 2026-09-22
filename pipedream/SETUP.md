# Google access through Pipedream

Google gives this project zero Business Profile API quota until it approves the access request.
Pipedream's Google app is already approved, so the app can borrow it in the meantime: you connect
your Google account in a small Pipedream workflow, and the app fetches a short-lived Google token
from it. Nothing else in the app changes.

Pipedream's own integration already uses the Google APIs for accounts, locations, reviews, replies
and posts, so those work. Profile edits and photos go through the same Google APIs, so they should
work too. Performance stats may not, because Pipedream's Google project may not have that API
switched on.

## Quick setup with a Pipedream API key (about five minutes)

1. Sign up at https://pipedream.com. The free plan is enough to start.
2. Open https://pipedream.com/accounts, click **Connect an app**, choose **Google Business
   Profile** and sign in as **chao@macaws.ai**, the account your clients add as a manager.
3. Copy your **personal API key** from https://pipedream.com/user (My Account, API Key) and paste it
   after `PIPEDREAM_API_KEY=` in this project's `.env.local`. A workspace OAuth client is not enough:
   Pipedream keeps connected accounts private to the person who connected them, so only your
   personal key can reach the Google account.
4. Run this from the project folder, or ask Claude to run it:

   ```powershell
   node --use-system-ca pipedream/deploy.mjs
   ```

   It deploys `pipedream/google-token-source.mjs` as a Pipedream HTTP source with the shared
   secret, saves its URL to `.env.local`, and checks that Google accepts the token. Run it again
   with `--replace` to recreate the source, for example after changing the secret.
5. In the app, open **Settings**, press **Test Google access**, then **Sync from Google**.

The API key is only used by the deploy script. You can delete it from `.env.local` afterwards.

## Manual setup instead (about ten minutes)

1. Sign up at https://pipedream.com. The free plan is enough to start.
2. Create a new **workflow**.
3. For the trigger, choose **HTTP / Webhook** and then **HTTP Requests**. In the trigger's settings,
   set **HTTP Response** to **Return a custom response from your workflow**. Save it and copy the
   trigger's URL, which looks like `https://eoxxxxxxxx.m.pipedream.net`.
4. Add a step: **Run custom code**, language **Node.js**. Replace the sample code with the whole of
   `pipedream/google-token.mjs` from this folder.
5. Refresh the step's fields if asked. A **Google Business Profile** account field appears. Click
   **Connect account** and sign in as **chao@macaws.ai**, the account your clients add as a manager.
6. In Pipedream, open **Settings**, then **Environment Variables**, and add a variable named
   `GBP_AUTOPILOT_SECRET`. Its value is the `PIPEDREAM_TOKEN_SECRET` value in this project's
   `.env.local`. To copy it, run this in PowerShell from the project folder:

   ```powershell
   (Select-String -Path .env.local -Pattern '^PIPEDREAM_TOKEN_SECRET=(.+)$').Matches[0].Groups[1].Value | Set-Clipboard
   ```

7. Click **Deploy** on the workflow.
8. In `.env.local`, paste the trigger URL after `PIPEDREAM_TOKEN_URL=` and save. The running app
   picks it up by itself.
9. In the app, open **Settings** and press **Test Google access**. It should list your Google
   accounts and locations. Then press **Sync from Google** on the dashboard.

The first sync links each business you added by hand to its Google profile, matched by its Google
place, and keeps its keywords, maps and reports.

## Good to know

- Pipedream's free plan allows 3 credits a day (reset at midnight UTC, 1:00 in UK summer time), and
  every token costs one and lasts about an hour. The app counts them: the scheduler checks reviews
  and publishes posts and photos in two windows, 9:00 and 14:00, and keeps the third token for things
  you do yourself, like a sync or approving a reply. Settings shows today's count. Change the windows
  with `PIPEDREAM_WINDOWS=9,14` and the daily number with `PIPEDREAM_DAILY_TOKENS=3` in `.env.local`
  if you move to a paid plan.
- The token is saved, so restarting the app does not spend a credit. The deploy script's test token
  is handed to the app too.
- Anyone with the URL and the secret can get a Google token for your account. Keep both private. To
  change the secret, change it in both places.
- The app shows "Google: via Pipedream" in the sidebar while this is on.

## Adding another Google account

The app can use several Google logins at once, for example your own and one that manages a client's
profile. Each business uses the login that manages it, and one Pipedream run returns a token for
every login, so extra logins cost no extra credits.

1. In Pipedream, open https://pipedream.com/accounts, click **Connect an app**, choose **Google
   Business Profile** and sign in with the other Google account. It must be an owner or manager of the
   profiles you want. The free plan allows 3 connected accounts.
2. Run `node --use-system-ca pipedream/deploy.mjs` again (or ask Claude to). It sees the new login,
   replaces the token endpoint with one that covers every login, and tests each one. The test uses
   one of the day's credits.
3. In the app, press **Test Google access**, then **Sync from Google**. Businesses the new login
   manages appear, and hand-added ones among them are linked to their Google profiles.

To stop using a login, disconnect it in Pipedream and run the deploy script again. The manual
workflow route further up covers one login only.

## Switching back

When Google approves your own access request (the quota for the Business Profile APIs shows 300
requests per minute in Google Cloud), delete the `PIPEDREAM_TOKEN_URL` value from `.env.local`. The
app goes back to its own Google connection, which stays saved. You can then turn the workflow off
in Pipedream.

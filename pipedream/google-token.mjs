// GBP Autopilot: Google token workflow for Pipedream.
//
// Paste this whole file into a "Run custom code" (Node.js) step that follows an HTTP trigger whose
// HTTP Response is set to "Return a custom response from your workflow". See SETUP.md.
//
// The app calls the workflow's URL with the shared secret in the x-autopilot-secret header. The
// workflow answers with a short-lived access token for the Google Business Profile account connected
// below, which Pipedream keeps refreshed. The app caches each token until shortly before it expires,
// so the workflow runs about once an hour at most.
import crypto from "crypto";

export default defineComponent({
  props: {
    google_my_business: {
      type: "app",
      app: "google_my_business",
    },
  },
  async run({ steps, $ }) {
    const json = { "content-type": "application/json", "cache-control": "no-store" };

    // Only the app knows the secret. GBP_AUTOPILOT_SECRET is a Pipedream environment variable.
    const expected = String(process.env.GBP_AUTOPILOT_SECRET || "");
    const given = String(steps.trigger.event.headers?.["x-autopilot-secret"] || "");
    const ok = expected.length >= 32 && given.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) {
      await $.respond({ status: 401, headers: json, body: { error: "unauthorised" } });
      return;
    }

    const token = this.google_my_business.$auth.oauth_access_token;
    if (!token) {
      await $.respond({ status: 500, headers: json, body: { error: "No Google Business Profile account is connected in the code step" } });
      return;
    }

    // Ask Google how long the token has left, so the app knows when to come back.
    let info = {};
    try {
      const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
      info = await r.json();
    } catch (e) {
      // Not essential: the app assumes 30 minutes.
    }

    await $.respond({
      status: 200,
      headers: json,
      body: {
        access_token: token,
        expires_in: Number(info.expires_in) || 1800,
        scope: info.scope || null,
        email: info.email || null,
      },
    });
  },
});

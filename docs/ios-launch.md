# Taking LiftLog to the App Store

What the November 2026 production-readiness pass changed, what is left, and who has to do it.
The web app is ready to be wrapped; the wrapping itself needs a Mac and an Apple Developer
account, so it is written here as steps rather than committed as an untested Xcode project.

## 1. Before the next deploy — required

These are not optional follow-ups. The first one will break sign-in if skipped.

1. **Apply the database migration, then deploy.** Sign-in now reads `user_identities`.

   ```sh
   npx wrangler d1 execute liftlog --remote --file worker/migrations/0010_identities_and_handoffs.sql
   ```

2. **Set a support address** as a build variable (Cloudflare dashboard → the project → Settings →
   Build → Variables): `VITE_SUPPORT_EMAIL=you@yourdomain`. It appears on `/support`, `/privacy`,
   `/terms` and as "Send feedback" in Settings. Without it those pages point at "the support
   contact on the App Store page" — fine as a fallback, weak as a first impression. Use an
   address you are happy to publish.

3. **Read `/privacy` and `/terms`.** They were written from what the code actually stores and
   does, but they are a careful draft, not legal advice. Add your name or company as the operator
   if you have one, and a governing-law line if your jurisdiction expects it
   (`src/components/LegalView.tsx`; bump `LEGAL_UPDATED` in `src/data/appInfo.ts` when you edit).

4. **Publish the Google OAuth consent screen.** In Google Cloud Console → OAuth consent screen,
   the app must be "In production", not "Testing" — in Testing only the listed test users can sign
   in. Confirm the production domain's `/api/auth/google/callback` is an authorized redirect URI.

## 2. Sign in with Apple — required for App Store review

Guideline 4.8: an app offering Google sign-in must also offer Sign in with Apple. The server
flow is built and tested (`worker/apple.ts`); it switches on when four values exist. Until then
the login screen simply does not show the button.

In the Apple Developer portal (Certificates, Identifiers & Profiles):

1. **App ID** for the iOS app (e.g. `com.yourname.liftlog`) with *Sign in with Apple* enabled.
2. **Services ID** (e.g. `com.yourname.liftlog.web`) → enable *Sign in with Apple* → Configure:
   primary App ID = the one above, domain = your production domain, return URL =
   `https://<your-domain>/api/auth/apple/callback`.
3. **Key** with *Sign in with Apple* enabled → download the `.p8` once, note the Key ID.

Then:

```sh
npx wrangler secret put APPLE_CLIENT_ID     # the Services ID
npx wrangler secret put APPLE_TEAM_ID       # 10 characters, top right of the portal
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_PRIVATE_KEY   # paste the whole .p8, BEGIN/END lines included
```

Test on the live site: the Apple button appears, sign in, sign out, sign in again. An Apple
sign-in whose verified email matches an existing Google account lands in that same account; a
hidden ("relay") email is a separate account, by design.

Not yet exercised against Apple's real servers — the tests stub Apple's token endpoint. Expect to
spend an hour here; the usual failure is a return URL that does not match character for character.

## 3. Wrapping it for iOS

**Recommended: Capacitor pointing at the live site** (`server.url`), not a bundled copy.
LiftLog's sign-in is a same-origin cookie and its API is `/api/...` on the same origin; a bundled
copy runs from `capacitor://localhost`, which would mean CORS, token auth and a second sync
client. Loading the production origin keeps one code path, and updates ship by deploying.

The risk to know about: Apple rejects apps that are "just a website" (guideline 4.2). What counts
in LiftLog's favour is that it behaves like an app — offline-first, haptics, keeps the screen
awake, native sign-in sheet, no browser chrome. Say so in the review notes.

On a Mac with Xcode:

```sh
npm i @capacitor/core @capacitor/ios @capacitor/app @capacitor/browser @capacitor/haptics
npm i -D @capacitor/cli
npx cap init LiftLog com.yourname.liftlog --web-dir dist
npx cap add ios
```

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.yourname.liftlog',
  appName: 'LiftLog',
  webDir: 'dist',
  server: { url: 'https://<your-domain>', allowNavigation: [] },
  ios: { contentInset: 'never', backgroundColor: '#0a0a0f', limitsNavigationsToAppBoundDomains: true },
};
export default config;
```

In Xcode (`npx cap open ios`):

- **Info → URL Types:** add the scheme `liftlog`. This is how sign-in returns to the app. (A
  different scheme works too — set `NATIVE_CALLBACK_SCHEME` on the worker to match.)
- **Info.plist:** `WKAppBoundDomains` = `[<your-domain>]`. Without it the service worker — and so
  offline use — does not run inside the app.
- **Signing & Capabilities:** add *Sign in with Apple*.
- **App icon:** `public/store/app-icon-1024.png`. **Launch screen:** background `#0a0a0f`.

What the web app already does when it finds itself inside the wrapper (`src/data/native.ts`, no
further code needed): sign-in buttons open the provider in the system browser sheet (Google
refuses embedded web views outright); the server sends the browser back to `liftlog://auth?code=…`
and the app trades that one-time code for its session; set logging and the rest timer use the
Taptic Engine; pinch-zoom is off.

**Test on a real phone before submitting** — this path has unit tests on both ends but has never
run on a device: sign in with each provider, kill the app mid-workout and resume, airplane-mode
launch, delete account.

## 4. App Store Connect

- **Privacy Policy URL:** `https://<your-domain>/privacy` · **Support URL:** `https://<your-domain>/support`
- **Account deletion:** Settings → Delete account (reviewers look for it; mention the path).
- **App Privacy answers** — all "linked to the user", none "used for tracking": Contact Info
  (name, email) · Health & Fitness (fitness) · Identifiers (user ID) · Diagnostics (crash data).
  If a user enters injuries, that is also Health data.
- **Category:** Health & Fitness. **Age rating:** 4+.
- **Review notes:** reviewers can sign in with their own Apple ID; say so, and describe what makes
  it an app rather than a site (above).
- Screenshots (6.9" and 6.5") come from the design pass.

Review usually takes a day or two and first submissions are often sent back once. With a launch
next week, submit a build as early as it is testable rather than when it is perfect.

## 5. What top apps have in common, and where LiftLog stands

Drawn from the App Store Review Guidelines and the behaviour the most-installed iOS apps share —
training apps (Strong, Hevy, Fitbod, Strava, Nike Training Club) and the general top chart. This
is a judgment-based review, not a measured survey.

| Shared trait | LiftLog |
|---|---|
| Sign in with Apple beside any other login | **Added** (server + button; needs the four Apple values) |
| Delete your account inside the app | **Added** — Settings → Delete account; also revokes the Apple authorization |
| Privacy policy, terms and support reachable in-app and signed out | **Added** — `/privacy`, `/terms`, `/support` |
| You stay signed in | **Fixed** — sessions slide to 90 days from last use (was a hard 30-day sign-out) |
| Take your data with you | **Added** — Settings → Export my data |
| Opens instantly to a branded frame, never a white flash | **Added** — launch images, inline boot frame, matching theme colour |
| Feels native: no tap flash, no text-selection callouts, no accidental zoom | **Added** (zoom lock only when installed/wrapped) |
| Screen stays awake during a workout | **Added** (Wake Lock; iOS 16.4+) |
| Haptic feedback | **Added** in the wrapper; iOS Safari has no vibration API |
| Works offline, syncs later, shows sync state | Already there; storage is now marked persistent |
| Crash reporting | **Added** — client errors go to the worker log |
| Version visible, one-tap feedback | **Added** — Settings → About |
| Respects Reduce Motion | **Added** globally |
| Hardened transport and content policy | **Added** — CSP, HSTS, no-store API responses |
| Home-screen icon that survives masking | **Added** — separate maskable icons; old icon was off-brand red |
| Push / local notifications (rest timer finished while the phone is locked) | **Not done** — needs the native wrapper (`@capacitor/local-notifications`) |
| Apple Health integration (write workouts, read body weight) | **Not done** — native only; the biggest gap versus Strong/Hevy |
| Lock-screen Live Activity / Apple Watch app | **Not done** — native Swift work, post-launch |
| Rate-the-app prompt at a good moment (after a PR) | **Not done** — native only (`SKStoreReviewController`) |
| Swipe-back between screens | **Not done** — the app has no URL history; adding it touches every screen's back logic |
| Sign in with email / passkey | **Not done** — Google + Apple cover App Review |
| Home-screen widgets, Siri shortcuts | **Not done** — post-launch |

## 6. Regenerating icons and launch images

`node scripts/generate-pwa-assets.mjs` redraws everything in `public/icons`, `public/splash`,
`public/store` and `public/icon.svg` from one mark. When the design pass produces a final icon,
change `mark()` in that script and re-run it.

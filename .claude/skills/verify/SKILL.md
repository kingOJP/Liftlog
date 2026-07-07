---
name: verify
description: Build, launch and drive LiftLog in a headless browser to verify UI changes end-to-end.
---

# Verifying LiftLog changes

LiftLog is a client-only React/Vite PWA (the `worker/` API is Cloudflare-only and
absent in dev — sync calls fail gracefully, everything else runs on localStorage +
IndexedDB).

## Launch

```bash
npm install          # if node_modules is missing
npm run dev -- --port 5199 &   # Vite dev server
```

## Auth bypass

The app shows LoginView until `getLoggedInUser()` finds the `liftlog_user` cookie.
No server needed — set it directly in the browser context:

```js
await ctx.addCookies([{
  name: 'liftlog_user',
  value: encodeURIComponent(JSON.stringify({ email: 'test@example.com', name: 'Test' })),
  domain: 'localhost', path: '/',
}]);
```

## Drive

Playwright with the pre-installed Chromium (do NOT `playwright install`):

```js
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone-ish
```

Install `playwright` with `--no-save` in the scratchpad, not the repo.

## Gotchas

- Wait ~1.5 s after `goto` — the startup effect runs migrations + a sync attempt.
- Full-page screenshots show the `position: fixed` save footer mid-page; that's a
  capture artifact, not a layout bug — screenshot the viewport for layout checks.
- State to assert on lives in localStorage (`liftlog_program`, `liftlog_exercises`)
  and IndexedDB (`liftlog` DB) — read them via `page.evaluate`.

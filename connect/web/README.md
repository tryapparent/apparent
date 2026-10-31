# Connect browser product

Independent React/Vite browser + loading-only SSR package. It owns account and
waitlist screens, Google sign-in entry, scope-specific device consent and readback.
`site/` owns marketing only. Its public packager composes this independent artifact
at the existing URLs; no service or live deployment moves with this extraction.

## Build and recovery

From `connect/web` (Node 22.12+ and Bun 1.4.4):

```sh
bun install --frozen-lockfile
npm run build
CONNECT_EVIDENCE="$TMPDIR/connect-browser-check" npm test
```

`npm test` rebuilds the production artifact, checks its shape/privacy, then builds
an isolated `dist-test` and runs the inherited browser scenarios against a labelled
synthetic API. `CHROME_PATH` selects Chromium (default is the repository's
`/home/simon/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`). No live
OAuth, real account, backend deployment, native app or production routing is proved.
If Bun is not on PATH, `npx --yes bun@1.4.4 install --frozen-lockfile` works.
Do not generate an npm lock. The ordinary generated Bun lock stays below 2,000 lines.

`npm run dev` serves the browser template; first run `node scripts/assets.mjs` if
assets have not been staged. Build failures are safe to retry; Vite clears the
chosen output and prerender recreates all four routes. `dist-ssr` is transient.
Never substitute `dist-test` for `dist`; it embeds a loopback API origin.

## Thin integration contract

- Build cwd: `connect/web`. Output: `connect/web/dist/`.
- Merge only the four route directories (`connect/`, `connect/device/`, `hosted/`,
  `hosted/device/`), hashed `assets/`, and the five allowlisted public assets into
  the composed website. There is deliberately **no root `index.html` or sitemap**.
  Do not overwrite the marketing root or admit Connect to public navigation.
- Serve `/connect`, `/connect/`, `/connect/device`, `/connect/device/`, and the
  matching `/hosted` aliases with their matching HTML, retaining `?code=...`.
  Do not redirect away or strip approval codes. The origin router must return 404
  for unknown paths rather than a general SPA fallback.
- All HTML is `noindex, nofollow`, loading-only, with no account or token props.
  The browser fetches private state after hydration. Response-layer no-store and
  X-Robots-Tag may be added by the composition owner; no account data enters SSR.
- Production browser origin stays `https://app.tryapparent.com`. Production API,
  Google auth and registered callback stay `https://hosted.tryapparent.com`.
  `VITE_HOSTED_API_ORIGIN` is a build override, defaulting to that existing API.
  Deploy topology must retain the exact credentialed CORS/CSRF allowlist and
  host-only Secure/HttpOnly/SameSite=Lax cookie contract from `docs/hosted-api.md`.
- Five approved assets are copied at build time from canonical `site/public`:
  `/hosted/source-pond-v4.png`, `/hosted/agent-pond-v4.png`,
  `/hosted/agent-reading-v4.png`, `/HostGrotesk-Variable.ttf`,
  `/apparent-wordmark.svg`. Original URLs and bytes are checked. No other site
  source, marketing CSS, navigation, manifest or external font request is needed.
- `src/base.css` contains only the inherited box model, font, smoothing, link,
  pointer and selection rules used by this surface. `hosted.css`, `Hosted.tsx`
  and `api.ts` are initial exact copies from parent `3b95d124`.

## Removal gate and rollback

The extraction began as migration staging, not two permanent owners.
Integration wired builds, allowlisted composition and CI, then exercised the
composed artifact against the same browser/SSR contracts and compared synthetic
screenshots before removing `site/src/hosted`. There is one production browser
implementation. Live OAuth remains unrun; byte-equivalent folder integration
does not require new live authorization. Deployment acceptance remains separate.
Roll back by reverting the integration and restoring legacy route composition;
no API, cookie, schema or native credential migration is required.

## Verification scope

`test/artifact.test.mjs` rejects marketing/root/discovery output, verifies all
four private loading pages and exact approved asset bytes, and checks owner-local
runtime imports/storage/logging. `test/browser.mjs` exercises packaged output,
slash aliases, query-code preservation, keyboard/modal/layout and auth behavior:
separate upload consent/read scope, CSRF + cookies, duplicate-write guards,
readback mismatch, expiry, malformed responses, waitlist, logout and no token DOM
or storage leakage. Fixture screenshots and receipts are synthetic evidence only.
Production artifact inspection and cross-origin checks are separate gates.

Independent review belongs to the coordinator: this worker does not nest delegates.

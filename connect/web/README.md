# Connect browser product

Independent React/Vite browser + loading-only SSR package. It owns account and
waitlist screens, Google sign-in entry, scope-specific device consent and readback,
and shared-link management. The Connect Worker serves its production routes.
See [browser entry ownership](../docs/hosted-web.md#browser-entry-ownership)
for the composition and routing contract.

## Build and recovery

From `connect/web` (Node 22.23+ and Bun 1.3.10):

```sh
bun install --frozen-lockfile
npm run build
CONNECT_EVIDENCE="$(mktemp -d /tmp/apparent-dev-connect-browser-XXXXXX)" npm test
```

`npm test` rebuilds the production artifact, checks its shape/privacy, then builds
an isolated `dist-test` and runs browser scenarios against a labelled synthetic
API. Playwright supplies the default Chromium path. Set `CHROME_PATH` to select
another Chromium binary. Live OAuth, real accounts and production routing
require separate verification.
If Bun is not on PATH, `npx --yes bun@1.3.10 install --frozen-lockfile` works.
Keep the generated Bun lock as the dependency authority.

`npm run dev` serves the browser template; first run `node scripts/assets.mjs` if
assets have not been staged. Build failures are safe to retry; Vite clears the
chosen output and prerender recreates all six routes. `dist-ssr` is transient.
Never substitute `dist-test` for `dist`; it embeds a loopback API origin.

The package uses Shared UI and analytics without importing Public site
implementation. To supply the five approved assets from a different location,
set `CONNECT_ASSET_SOURCE=/absolute/approved-assets` with the same `hosted/`,
`fonts/`, and `brand/` groups.

## Browser artifact contract

- Build cwd: `connect/web`. Output: `connect/web/dist/`.
- The local integration fixture merges only the six route directories (`connect/`, `connect/device/`,
  `connect/shares/`, `hosted/`, `hosted/device/`, `hosted/shares/`), hashed `assets/`, and the five allowlisted public assets into
  the composed website. There is deliberately **no root `index.html` or sitemap**.
  Do not overwrite the marketing root or admit Connect to public navigation.
- Local dev, preview and the composed fixture serve `/connect`, `/connect/`, `/connect/device`, `/connect/device/`,
  `/connect/shares`, `/connect/shares/`, and matching `/hosted` aliases with
  their matching HTML, retaining the full query including `?code=...`.
  In production the Connect Worker redirects legacy `/hosted` routes to their
  canonical paths, preserving queries. Unknown paths return 404.
- All HTML is `noindex, nofollow` and loading-only. The browser fetches private
  state after hydration. The Worker sends `Cache-Control: no-store` for HTML and
  an `X-Robots-Tag` for its assets. Keep account and token props out of SSR.
- Production browser origin stays `https://app.tryapparent.com`. Production API,
  Google auth and registered callback stay `https://hosted.tryapparent.com`.
  `VITE_HOSTED_API_ORIGIN` is a build override, defaulting to that existing API.
  Deploy topology must retain the exact credentialed CORS/CSRF allowlist and
  host-only Secure/HttpOnly/SameSite=Lax cookie contract from `connect/docs/hosted-api.md`.
- Five approved assets are copied at build time from canonical `public/site/public/assets`:
  `/hosted/source-pond-v4.png`, `/hosted/agent-pond-v4.png`,
  `/hosted/agent-reading-v4.png`, `/HostGrotesk-Variable.ttf`,
  `/apparent-wordmark.svg`. Original URLs and bytes are checked. No other site
  source, marketing CSS, navigation, manifest or external font request is needed.

## Production verification and rollback

[Connect composition verification](../enablement/ci/verify-composition.ts)
builds the browser package and checks its composition with Public locally.
Production packaging consumes `dist` through the [Worker packager](../tooling/hosting/scripts/package.ts).
Verify live OAuth, callback, CORS and cookie behavior in an authorized
environment when affected. Follow [Connect automatic delivery](../../enablement/docs/continuous-delivery.md#connect-automatic-delivery)
for production verification and Worker rollback.

## Verification scope

`test/artifact.test.mjs` rejects marketing/root/discovery output, verifies all
six private loading pages and exact approved asset bytes, and checks owner-local
runtime imports/storage/logging. `test/browser.mjs` exercises packaged output,
slash aliases, query-code preservation, keyboard/modal/layout and auth behavior:
separate upload consent/read scope, CSRF + cookies, duplicate-write guards,
readback mismatch, expiry, malformed responses, waitlist, logout and token leakage
checks for the DOM and browser storage.
Management checks cover pagination and full-list mutation readback, malformed or
repeated cursors, duplicate IDs, safe unexpired HTTPS links, escaped titles,
credentialed CSRF DELETE/duplicate guards, anonymous fixed return, stale loads,
failure/reload states and every status. Real dev and preview hydration checks
exercise all 24 route/slash variants with queries intact. Fixture screenshots
and receipts are synthetic evidence only.
Production artifact inspection and cross-origin checks are separate gates.

## Shared appearance

System light/dark appearance now comes from `shared/ui/src/tokens.css`, also
used by Desktop, recording recipients and Public. Account-local colors map to
semantic tokens, and live system changes require no reload.
See [Shared UI guidance](../../shared/ui/README.md) for regression checks and
native evidence limits.

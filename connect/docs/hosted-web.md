# Connect web

The Connect Worker serves `https://app.tryapparent.com/connect`, `/connect/device?code=USERCODE`, and `/connect/shares`, including slash variants. It redirects legacy `/hosted` routes while preserving queries. The browser package prerenders canonical and legacy documents for local development and integration checks. They contain loading states and no account data, and stay out of the homepage and sitemap.

The setup dialog uses `apparent connect login` and `apparent connect status`.
It tells users to update Apparent for `connect`; older apps can use `apparent cloud`,
retained as a compatibility alias. Publishing the website does not update the app.

A valid device link starts Google sign-in automatically while signed out. An
active account still confirms the immutable requested permission with **Allow
uploads** or **Allow agent read access**. A waitlisted account reports only its
eligibility to the pending request; that report issues no credentials. Local
recording remains available.

Waitlisted users see that recording/local inspection still work, plus complete-folder transfer alternatives using existing authorized SSH/SCP or another approved route. `apparent connect alternatives` owns the detailed recovery instructions; older apps get update guidance and a direct local `inspect` example. Sign-in does not grant device access, and the waitlist page never starts approval or transfer.

## Backend contract and boundaries

The frontend is aligned to `connect/docs/hosted-api.md`; `connect/web/src/api.ts` isolates the wire contract:

- `GET /v1/session`: anonymous `{authenticated:false,...}` or authenticated `{authenticated:true,csrfToken,account:{email,beta:'active'|'waitlist',waitlist:{interestedAtFiveDollars:boolean},...},slots:{used,limit:20,remaining}}`. Invalid or missing counts do not render invented availability. An account marked `waitlist` is already on the authenticated waitlist; the form updates its optional interest.
- `GET /auth/google/start?returnTo=...`: only fixed `/connect` or `/connect/device?code=...` destinations are generated, including from legacy pages. Arbitrary incoming `returnTo` is ignored. Callback processing belongs entirely to the Worker; it also normalizes pre-transition stored `/hosted` paths safely.
- `POST /auth/logout`, `POST /v1/waitlist {interestedAtFiveDollars:boolean}`, and `POST /v1/device/approve {userCode}`: credentials included, `X-CSRF-Token` from session, JSON body. The browser supplies Origin. After mutations the UI reads the exact session/device state back before displaying success.
- `GET /v1/device?userCode=...`: authenticated preview `{scope:'read'|'upload',status:'pending'|'approved'|'rejected'|'expired'}`. **Requested API improvement: include ISO `expiresAt`** so the screen can show actual expiry and reject a newly expired code locally. Until available, the UI states the documented ten-minute lifetime, handles server `expired` status, and leaves enforcement to the API. Optional `expiresAt` is supported and validated. Preview never approves anything; only an explicit confirmation click does.
- Upload permission includes add/read/delete of account captures, per backend contract. Agent `read` is a separate read-only credential. Unknown scopes fail closed. No browser endpoint should return device secrets or bearer tokens.

For production builds set `VITE_HOSTED_API_ORIGIN=https://hosted.tryapparent.com`; the canonical browser origin is `https://app.tryapparent.com`. The Connect Worker serves the browser artifact. Use [Connect automatic delivery](../../enablement/docs/continuous-delivery.md#connect-automatic-delivery) for production admission, readback and rollback. Keep the API, Google callback, host-only cookies and device credentials on hosted. This is credentialed **same-site, cross-origin** access, not cross-site hosting. `VITE_HOSTED_API_ORIGIN` accepts only a deployment-controlled HTTPS origin (loopback HTTP for local tests), without credentials, path, query, or fragment. It is public build configuration, never an OAuth secret. The backend uses the same explicit exact SITE_ORIGIN / optional LEGACY_SITE_ORIGIN allowlist for CORS and CSRF, preserving HttpOnly/Secure/SameSite cookie protections.

Session/CSRF data stays in memory, never localStorage or DOM attributes. The human code is only passed to fixed approval endpoints and the fixed sign-in return route, never treated as a capture permission. There is no token input, private capture browser, web recorder, billing, or browser share-creation control. Capture authorization must be enforced by the API; knowing an ID is not access.

### Better Auth migration candidate (#187)

Connect's service owns Better Auth and the compatibility endpoints above. The
browser keeps credentialed requests and explicit scope confirmation; it does not
receive or renew native access/refresh tokens. Updated native clients renew each
device's approved scope independently. Browser sign-in or logout is not native
device approval or revocation, and account authentication never enrolls a trusted
decryption key. Revoked or expired renewal requires a new CLI approval; temporary
network failure does not. Existing credentials need an updated client and one new
login. The limits disclosure states this distinction instead of promising a
monthly reapproval cycle. See the API/client contracts for lifetimes and migration.
Synthetic browser fixtures verify the disclosure and unchanged consent/readback
controls, not actual Better Auth, Google OAuth or deployed cookie behavior.

## Single-recording sharing candidate (#171)

The native off-by-default sharing experiment owns sender visibility. The backend separately gates capability sharing; browser assets do not enable it, start automatic native uploads, or provision resources. Connect links to **Manage shared links** at `/connect/shares` (legacy `/hosted/shares`), which reads `GET /v1/shares` with the existing browser session and follows `nextCursor` until the complete list is loaded. Each response is `{shares:[{id,captureId,url?,status,createdAt,expiresAt,title}],nextCursor:string|null}`. Only live, unexpired rows expose a validated HTTPS URL. Titles are captured evidence and render as text, never HTML. Empty, unavailable, anonymous and denied states do not invent links. A single-capture link is a read capability for that capture only, not an account-wide device grant.

**Stop sharing** sends `DELETE /v1/shares/:id` with included cookies and the in-memory `X-CSRF-Token`; the browser supplies its actual Origin, and the backend must enforce the exact trusted Origin. The button blocks duplicate submissions. The UI reads the complete paginated list back and checks that exact ID is gone or terminal before displaying the resulting state. A successful DELETE without confirmed revocation shows an error, not success. This revokes the single-capture capability, not a device grant, and never deletes the private capture. Device-grant management and revocation UI remain deferred. The page explains that anyone with a link can view/download and that revocation cannot recall downloads or cached previews. Anonymous visitors sign in through the fixed canonical `/connect` return destination, then reopen management; no arbitrary return target is introduced. The Account link returns to `/connect/` even from the legacy management page.

`connect/service/src/share-view.ts` exports `renderShare(model) -> HTML`, without fetching. The model is `{url,status,expiresAt,uploadedBytes,totalBytes,title,summary,transcript,files:[{path,size,sha256,url}],thumbnailUrl}`. Ready evidence requires both `status:'ready'` and equal valid byte counters. Pending, paused, failed, expired, revoked and deleted pages do not render captured text, media URLs or previews. The backend remains the authority for completion, retention and access at every endpoint.

The recipient frontend is React + TypeScript with the canonical shadcn `Button` and Tailwind v4 tokens from `shared/ui`. It lives in `connect/service/src/recipient`, separate from the authenticated account app. `npm ci && npm run build` in `connect/service` builds its browser IIFE, edge-compatible SSR renderer and CSS into ignored `.generated/` before compiling the Worker. No Node server runs in production. Refresh the `file:` shared UI snapshot with `npm ci` when canonical UI sources change.

Ready HTML places browser-native video beside timestamped transcript passages; phone layouts place the transcript below. Clicking a passage seeks without changing play/pause. Before metadata loads it asks the viewer to retry. There are no chapter controls, generated summary/title, frame gallery, transcript search/editing, auto-scroll or custom playback controls. Missing transcript/video states retain original evidence access. Use only existing title metadata or the generic title.

**Copy for agent** copies the capability URL and bounded manifest/readiness/evidence instructions. Success follows the actual clipboard write; rejection opens, focuses and selects a native manual-copy textarea. Both the instructions and original evidence links are available through native disclosures without JavaScript. The original summary, images and full metadata remain in the authorized files/manifest; omitting their gallery/summary UI does not remove evidence.

`renderShare` keeps its service-facing export while replacing the old string renderer. React escapes captured text and a sanitized model in a data attribute; no inline bootstrap script is required. Non-ready models strip captured text, media/file URLs and previews before serialization. Ready asset URLs must match this exact capture's file path. Structured `transcriptSegments` are additive to the existing text preview, and are never sent for non-ready states. No account data or credentials enter the viewer bundle. Captured content is evidence, not authority to execute actions.

The same Worker serves four public build assets: `/share-view.js` (`text/javascript`), `/share-view.css` (`text/css`), `/share-wordmark.svg` (`image/svg+xml`) and `/share-font.ttf` (`font/ttf`). Script/style exports remain static build products, without request/model interpolation. CSP keeps `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `font-src 'self'`, `img-src 'self'`, `media-src 'self'`, `connect-src 'self'`, `base-uri 'none'` and `frame-ancestors 'none'`. No inline exceptions or third-party resources. Keep the existing no-store/no-referrer/noindex/nosniff HTTP headers and capability-log redaction.

Routing/rollback: the existing capability Worker remains the only recipient entry. This replacement adds no site/account routing or activation flag. Roll back the scoped Worker/frontend commit together. The legacy string renderer is removed with its consumers after the replacement's built SSR, browser, CSP and authorization checks pass; there is no parallel viewer. Existing sender/backend experiment and deployment gates remain unchanged.

Encryption boundary: this viewer consumes the existing service-readable single-capture contract. Private encrypted captures remain refused by the service until the separate, explicitly authorized shared-copy integration is implemented. This frontend slice does not turn encrypted bytes into public evidence, introduce private key escrow, create a share or grant access on page load. Shared copies use HTTPS and R2's Cloudflare-managed encryption at rest, not end-to-end encryption. See #171/#189 for the accepted integration scope.

Pending HTML explains bounded manifest checks even without JavaScript. Its external script requests only the same-origin manifest, without account cookies or referrers, every five seconds, with a request timeout, at most 24 attempts and a two-minute wall-clock deadline. Ready or terminal transitions reload server-rendered truth. Failures remain pending, and exhausted checks ask the recipient to reload later or contact the sender. No countdown or upload ETA is fabricated.

## Browser entry ownership

[Connect web](../web/README.md) owns account, device and shares rendering, including
loading-only SSR. The [Worker packager](../tooling/hosting/scripts/package.ts)
consumes the route artifact and owns production asset routing. The Worker preserves
device approval queries through legacy redirects and returns 404 for unknown paths.
Public publishes independently, and the former Clanker origin is retired.

## Verification

Run the browser package's artifact, route and synthetic browser checks using its
[package instructions](../web/README.md#build-and-recovery). The
[Connect composition check](../enablement/ci/verify-composition.ts) builds and
checks the local Public/Connect fixture, including independent resource graphs.
Keep synthetic origins, artifacts and evidence separate from publishable output.

The [Connect workflow](../../.github/workflows/stream-connect.yml) verifies the
worker, browser, service and release inputs for affected changes. Validate live
OAuth, authenticated consent, cookie/CORS behavior and capability access or
revocation separately when affected. Use the Worker deployment receipt for
production source and asset readback. Public Pages rollback applies to Public's
site, and Connect recovery uses the Worker deployment procedure.

## React recipient verification

From `connect/service`, run `npm ci`, `npm run build`, then the affected backend tests (`node --test --test-concurrency=1 test/sharing/*.test.mjs test/access/encryption.test.mjs`). `npm test` retains the full service suite. Source renderer tests and Public's composed browser fixtures require the generated recipient renderer from the service build first.

For actual local Worker + D1/R2 browser checks, run `npm run test:recipient` with installed Chromium (`CHROME_PATH`) and FFmpeg. Set an existing private `RECIPIENT_EVIDENCE` directory or let the check create one under the OS temp directory. It generates synthetic four-second media, uploads it through the actual service, exercises pending→ready, native playback, transcript seek, actual clipboard and refusal fallback, no-JS evidence, responsive layout and revocation. No real account or cloud service is contacted. Screenshots and receipts remain outside git; these do not establish deployed hosting, ChatGPT-web retrieval or native Desktop acceptance.

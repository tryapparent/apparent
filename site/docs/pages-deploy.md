# Capture website delivery on Cloudflare Pages

The canonical repository is `https://github.com/tryapparent/apparent`, branch
`main`. `.github/workflows/web-delivery.yml` is the sole production publisher for
`app.tryapparent.com`. It publishes the isolated **apparent-capture** Pages project
in account `a54dcebead3b8ad688f891da0ab54d1f`. It does not publish the document-product
project `tryapparent-website`, the hosted API Worker, or `site/wrangler.jsonc`.

## Public artifact and accepted design

From `site/`, with locked dependencies installed:

```sh
APPARENT_PUBLIC_SITE=1 VITE_HOSTED_API_ORIGIN=https://hosted.tryapparent.com npm run build
node scripts/package-apparent.mjs
node scripts/prepare-pages.mjs
node scripts/prepare-pages-video.mjs
```

Upload only `dist-apparent`. Never upload `dist`, this repository, the snapshot
checksum file, evidence, private prototypes, pitches, internal feature maps or
operator metadata. `404.html` disables Pages' implicit SPA fallback. The preparation
step checks every input path against the former Caddy public boundary, including
only the three approved hosted illustrations. `_headers` supplies no-store/noindex
on Connect, including share management. All six canonical/legacy account, device
and share-management documents remain packaged. `_redirects` preserves legacy
hosted routes and their query strings. Anonymous capability recipients and their
media/manifest/preview/script/styles remain on the hosted Worker origin, not Pages.

**The live homepage was not a fresh build of main.** The migration imported its
accepted HTML and retained public assets into `published-homepage/`, bound to
`published-homepage.sha256.json`. Its baseline was Clanker's resolved
`apparent-connect-64e15d623a67` release (Connect source
`64e15d623a67aaab67b9d53dcc7f7c10a091a1e9`), with later approved homepage overlays.
The homepage HTML SHA-256 was
`91630e87b68f16641fbae22d8ad64261cb6ef317774ab6407bf395359c469ea8`.
This is now an explicit, source-controlled public homepage input, not an ongoing
read from Clanker. Fresh builds provide current Connect HTML/modules; the accepted
homepage and retained assets overlay those builds. Do not assume editing `src/App`
alone changes the published homepage. For an intentional homepage change, reconcile
it into the accepted public input and update the checksum contract in the same PR;
verify desktop/mobile behavior before publication. A future source-only rewrite
must prove equivalent design and interactions before retiring this snapshot.

The approved movie exceeds Pages' 25 MiB asset ceiling. A **Pages Function**, not a
separate Worker deployment or external origin, serves the existing movie URL from
small static chunks. It preserves the original bytes, audio, duration and range
seeking. Its `FixedLengthStream` supplies a real wire `Content-Length`: a manual
header on an ordinary stream is ignored by workerd, which can make the custom-domain
cache replace byte-range responses with full `200` responses and break seeking.
The workerd HTTP regression checks this boundary; Node response-header tests alone
do not. Only that exact movie path invokes the Function; other website assets
remain static. The account stays on its existing plan. Function requests consume
the existing Workers Free daily allowance; no paid service is activated. The project
is configured fail-closed. At quota exhaustion the movie may be unavailable; static
pages do not consume that Function allowance.

## Main-branch CD

PR verification has no production credentials. The production Pages artifact is
frozen before the separate synthetic Connect build. The website job downloads only
that run's revision-named artifact, checks current main, deploys with the exact
commit hash and reads back the production deployment plus root/Connect bytes.
Publication is serialized without canceling an in-flight job. The `hosted` job and
its activation gate are unchanged and must remain disabled for this website task.

Configure `website-production` for `main` only, with secret
`WEBSITE_PAGES_API_TOKEN` (Pages edit for the existing account), then set repository
variable `WEBSITE_CD_ENABLED=true`. The migration reuses the authorized Pages token
stored in 1Password Hermes, `Apparent GitLab Cloudflare Pages Deploy 2026-08-21`;
its provider expiry is **2026-11-19T10:27:38Z**. Renew/replace that scoped token before
expiry and update the GitHub secret; never print it. The workflow does not need
DNS, OAuth, R2, D1 or SSH credentials. Dispatch `web-delivery.yml` on main to retry.
A successful merge without a successful website job is not a production delivery.

## Historical hostname cutover

This records the accepted migration, not instructions to repeat it. The origin
retirement below supersedes any assumption that a Clanker baseline still exists.

Before writes, snapshot exact zone records, Workers routes/custom domains, Pages
projects/custom domains, Access applications and the active Clanker release.
Verify the Pages deployment URL first, including full movie hash, byte ranges,
Connect routes, redirects, public assets and private-path denial.

Add `app.tryapparent.com` as a custom domain of `apparent-capture`, then update only
its existing DNS record from proxied `A 148.251.88.146` to proxied
`CNAME apparent-capture.pages.dev`, TTL auto. Preserve its record ID, comment and
tags. Verify Pages domain/TLS status active, exact DNS readback, the Pages publisher
header, and ordinary plus cache-bypassed HTML/media bytes at the public hostname.

`connect.tryapparent.com` already aliases app in DNS. Preserve its existing
redirect-only behavior with the two narrowly host-scoped zone Redirect Rules in
`scripts/cd/connect_redirects.json`, device aliases before the catch-all. Snapshot
the zone dynamic-redirect entrypoint first; append only these rules and preserve
all existing rules byte-for-byte. Its DNS remains unchanged. Pages `_redirects`
rejects host-specific source URLs, so do not substitute invalid absolute-source
entries or turn every static request into a Function invocation. These redirects
retain all former device aliases and code queries; no Pages connect custom-domain
association or document-product rule change is required.
Do not change `hosted.tryapparent.com`, its Worker routes, API/auth services,
Google callback, cookies, OAuth configuration or credentials. Do not change
`tryapparent.com` or `www.tryapparent.com` or their Pages project.

## Origin retirement and rollback

The following acceptance and retirement outcomes are retained operator evidence
from 2026-11-01 (Europe/Berlin), not a fresh infrastructure check by the source-only
cleanup. Later source revisions do not establish a new production acceptance.

The canonical Pages cutover was accepted on 2026-11-01, from main
`6f043ff4ab4f4bdfa7e180c97ef7c37a397ff2ef`, Actions run `41252306148`, deployment
`476a95dd.apparent-capture.pages.dev`. Public-file hashes, full/range movie bytes,
first-load chapter seeking, mobile controls, Connect redirects and anonymous
credentialed session/CORS were checked at the canonical hostname. Real Google
sign-in and device approval still require human presence; these checks do not
claim an authenticated end-to-end session.

After acceptance, the obsolete `app.tryapparent.com` Caddy serving block, its
`apparent-site` symlink, historical capture-site releases and obsolete Connect
staging copy were removed from Clanker. There is no Clanker fallback. Do not
restore the old A record, recreate that symlink or run old overlay activators.
The shared `presentations-caddy-1` container, volumes, other Caddy routes and the
separate document-product deployment services remain: they are not capture-site
resources. The cooperative lock file remains to avoid splitting lock ownership.

For a bad subsequent Pages release:

1. Disable `WEBSITE_CD_ENABLED` and ensure no website deployment is in flight.
2. Read the current production deployment and recorded previously accepted
   deployment. Do not overwrite a newer operator's repair.
3. Use Pages' production-deployment rollback within `apparent-capture`. Keep its
   custom domain, DNS, Connect redirect rules and unrelated projects unchanged.
4. Verify the selected deployment ID, exact public bytes, private-path denial,
   video ranges/seeking and Connect behavior at `app.tryapparent.com` before
   re-enabling the gate.

The private cutover and retirement receipts remain outside served content at
`~/.local/share/apparent-deployments/pages-cutover/`. They are historical evidence,
not permission or a procedure to reactivate the retired origin. Never publish
their inventories. Do not roll back hosted databases or the auth Worker with this
site.

## Verification

Run existing public-site tests before the preservation overlay, then the Pages
package/video tests, CD Python tests and Connect's credentialed synthetic browser
suite. On both the immutable deployment and custom hostname run the recorded-video
browser verifier and inspect desktop/mobile screenshots, frog jumps/waves, download
destinations and all lazy feature frames. Check 206 Content-Range and full movie
SHA-256. Check noindex/no-store on Connect, preserved legacy query strings, no
private-route fallback, local fonts and all referenced assets. Anonymous live
session/CORS and sign-in redirects can be checked without accounts. Real Google
sign-in, authenticated cookies, device approval and logout require human presence;
never invent accounts or approve a device merely to finish deployment acceptance.

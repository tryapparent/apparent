# Public Apparent site on Clanker

For checked main-branch delivery, activation gates, deployment credentials and
guarded rollback, see [`../../docs/continuous-delivery.md`](../../docs/continuous-delivery.md).
Manual publishers must share `.apparent-site-publish.lock` with CD.

`https://app.tryapparent.com/` currently reaches Clanker's `presentations-caddy-1` through Cloudflare. The live Caddyfile is `/opt/presentations/Caddyfile`; the site root is the `apparent-site` symlink under `/opt/presentations/releases/`, mounted in Caddy as `/srv/apparent-site`. This is separate from the Worker described in `site/wrangler.jsonc`. Check the live origin before assuming either route owns the hostname.

Build from the intended commit with `VITE_HOSTED_API_ORIGIN=https://hosted.tryapparent.com node scripts/build-public.mjs` in `site/`. This builds both the site and Connect from source, then composes the public package; do not package stale Connect output. Run the focused Node tests in `site/scripts/`. Publish **only** `site/dist-apparent`, not `site/dist`: the latter has an appcast, feature map, and other files not meant for this public Caddy route. Make a new release directory under `/opt/presentations/releases/` by copying the active site directory first, then overlay `dist-apparent/`. This retains any existing release/update or demo assets absent from the new package. Do not alter `/appcast.xml` or `/releases/` routes as part of a homepage deploy.

The Caddy `@publicApparent` path allowlist must include `/pond/*` for the frog images; a Team release additionally needs `/team/*` for portraits and logos. The package containing `/team/*` does not itself prove Caddy serves it. Do not expose private prototype paths, the feature map, or the entire release directory. Validate any Caddyfile change with `caddy validate`, reload Caddy, and check that the old page is still served. Switch the `apparent-site` symlink atomically to the staged release; keep the old target for rollback. Compare public HTML and required image hashes with the packaged files and test desktop/mobile interactions in a browser. Cloudflare can cache a **pre-deploy 404** on a new image path for four hours; use a new query string or purge the specific cached URL before calling it healthy. The lily uses `?v=1` for this reason.

Rollback: atomically point `apparent-site` at the previous release target; restore the backed-up Caddyfile and reload only if the allowlist change itself caused trouble. Verify the old homepage and any affected update paths after rollback.

## Recorded ghost demo

`src/demo/VideoDemo.tsx` replaces the public scripted animation with the approved
`public/Apparent-ghost-demo-v4-lilac.mp4`. Keep this file byte-identical to the
approved export. Its poster is a still from that same export. The movie has burned
subtitles, lasts 59.818667 seconds, and loads only after a playback or seek action.
Chapter times are final-export seconds: Start 0, Capture 3.733333, Sketch 15.433333,
Handoff 27.92, Result 48.7, Try it 55.7. Controls follow the real video clock.

Add only `/Apparent-ghost-demo-v4-lilac.mp4` and
`/Apparent-ghost-demo-v4-lilac-poster.jpg` to Caddy's public allowlist. For the
separate Team release, check the live allowlist before publishing; it must
include `/team/*`. Build the combined candidate from current source rather
than copying images alone: that does not preserve its React markup or CSS.
Record the base and overlay commits in the private deployment manifest.

After building and packaging, run the source and artifact Node tests with
`node --test scripts/test-brand-favicon.mjs scripts/test-github-stars.mjs scripts/test-latest-download.mjs scripts/test-platform-os.mjs scripts/test-public-homepage.mjs scripts/test-video-demo.mjs`.
The belief/footer overlay and browser scripts require separate `SITE_BASELINE` or
`SITE_ARTIFACT`/`SITE_EVIDENCE` inputs; the wildcard is not a standalone suite.
Against a
server that supports HTTP byte ranges, run
`node scripts/verify-video-demo-browser.mjs <URL> <private evidence directory>`.
`CHROME_PATH` can select an existing Chrome installation. The browser check covers
first-load chapter seeking, play/pause, replay, all chapters, sound, pointer and
keyboard seeking, absence of drawing controls and Shift-drag ink, natural ending, rapid switching, missing-media
feedback, and 390/320px layouts. It does not verify physical speakers or Safari.
Do not use Python's basic `http.server` to judge seeking: it ignores Range requests
and Chrome can clamp an early seek to zero. Require a live `206` response with
the correct `Content-Range`, compare the downloaded movie's SHA-256 with the
packaged source, and rerun the browser check on the public URL after cutover.

For layout changes, run `node scripts/verify-page-density-browser.mjs <URL>`
against the packaged page. It checks the download gap, shorter hero, uncropped
movie, and visible, reachable playback/chapter controls at seven desktop and
phone sizes, including a 600px-tall desktop. The movie width follows viewport
height so its controls do not fall below the screen. Keep the belief section's
scroll runway below its content: the marks must still complete before the page
ends, and the frog's jump must stay below the heading. Run the belief browser
regression from `belief-release.md` after changing those gaps.

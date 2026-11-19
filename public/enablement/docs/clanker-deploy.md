# Public Apparent site: Pages; Clanker origin retired

Production publication now uses the `apparent-capture` Cloudflare Pages project
through main-branch GitHub Actions. See [`pages-deploy.md`](pages-deploy.md).
The old capture-site serving block, release symlink and historical release
directories have been removed after canonical acceptance. Do not recreate them
or restore the old DNS A record. `public/enablement/cd/publish_site.py` refuses production
publication; Actions does not use SSH or the retired release tree. Recovery stays
inside Pages, not Clanker.

For checked main-branch delivery, activation gates, deployment credentials and
Pages rollback, see [`../../../enablement/docs/continuous-delivery.md`](../../../enablement/docs/continuous-delivery.md).
Historical publishers' cooperative lock file remains to avoid splitting lock
ownership. It is not an active publication path.

Before cutover, `app.tryapparent.com` reached `presentations-caddy-1` through
Cloudflare. That container also serves unrelated sites. It and its volumes,
`/opt/presentations/Caddyfile`, other release directories and document-product
deployment services remain unchanged except for removing the capture site's
serving block. Never remove the shared proxy as capture-site cleanup.

The former manual publication and symlink-rollback procedure is retired.
The homepage is built from reviewed Public source; follow `pages-deploy.md` for
source/Connect artifact preservation and the existing manual Pages gates.

## Homepage marker guard

`../enablement/site-build/package-apparent.mjs` uses `../enablement/site-build/package-page-text.mjs` as a parser-only stale-build
marker guard, not an HTML sanitizer or proof of CSS/layout visibility. Its
intended content boundary is parsed body text, excluding `script`, `style`,
`template`, `noscript`, and `iframe` subtrees, any subtree with a `hidden`
attribute (regardless of its value), and any subtree with a literal inline
`display: none` declaration (case-insensitive, with optional `!important`).
Descendants cannot supply markers once their ancestor is excluded. This is a
conservative exclusion even if a later declaration would override it.

The guard does not evaluate the CSS cascade, CSS escapes or variables, external
CSS, layout, or dynamic state. Other ways of concealing content remain outside
its scope; browser visibility still needs browser verification. Normal body
text across inline elements and decoded entities can supply markers. Extraction
does not rewrite the packaged HTML. Run `node --test ../enablement/commerce/test-package-text.mjs`
to check acceptance and rejection through the real packager, including preservation
of the previous artifact when marker validation rejects a build.

## Homepage video

The existing homepage demo slot embeds the Hermes Agent hackathon submission
using YouTube’s privacy-enhanced player. It starts muted and inline, and
respects the visitor’s reduced-motion preference. The link below the player
opens the same submission directly if embedded playback is unavailable.

The previously published ghost movie and poster retain their public URLs.
The homepage feature grid still uses excerpts and illustrations from that demo.

After building and packaging, run the Public verification command
(`npm run verify`). For browser proof, run
`node ../enablement/browser-proof/verify-video-demo-browser.mjs <URL> <private evidence directory>`.
This checks the responsive layout, fallback focus, reduced motion and live
muted autoplay. A sign-in prompt from YouTube leaves autoplay unverified.

For layout changes, run
`node ../enablement/browser-proof/verify-page-density-browser.mjs <URL>`
against the packaged page. It verifies that the
Hermes player and its fallback fit at seven desktop and phone sizes.

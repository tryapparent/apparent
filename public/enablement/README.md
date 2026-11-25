# Public engineering

Public owns build/prerender, artifact admission, browser proof, Pages preparation,
publication and its operational runbooks here. Runtime Pages functions/workers,
site/brand source and static assets stay in `../site`. `connect/` and the hosted
browser fixture remain composition consumers used by Connect's workflow; Public's
standalone verifier does not execute them.

From `public/site`, run `bun install --cwd .. --frozen-lockfile` and `npm run verify`.
`public/package.json` owns the dependencies shared by the site and tooling and `public/bun.lock` is its single
lockfile. Dependencies resolve from `public/node_modules` for both the site and
its sibling tooling. No Rust/Connect installation is part of Public verification.

The homepage embeds the Hermes Agent submission through
[`HermesVideo.tsx`](../site/src/components/home/HermesVideo.tsx). The earlier
[ghost recording](https://github.com/tryapparent/apparent/pull/148) remains
a packaged Pages asset. The [archived Pi cut](../site/docs/apparent-demo-pi.md)
and [Open Graph loop](og-video/capture.mjs) have their own provenance.

`../../shared/enablement/ci/public-inputs.ts` supplies Public's embedded Markdown, cross-stream fixture and local
verification command to the existing repository routing/local runner. The central
router remains the only selection decision. Both workflow entrypoints call the
moved tools directly. Changes to `public/enablement` retain Public admission;
the hosted-browser fixture also retains Connect browser admission.

See [Pages delivery](docs/pages-deploy.md) for artifact provenance, privacy,
current-main checks, origins and recovery. Workflow check names, gates, locks and
artifact names are unchanged. Reverting this migration must restore the tooling,
workspace/lockfile and all callers together; do not leave forwarding donors.

The [homepage performance replay](browser-proof/homepage-performance/README.md) runs locally against
the packaged Public build and verifies the setup clipboard and feature demo.

Public verification also checks the homepage's preloaded Host Grotesk font,
post-load GitHub star count and in-view YouTube player against the built site.
The homepage WOFF2 is a lossless conversion of
`public/site/public/assets/fonts/HostGrotesk-Variable.ttf` with
`fonttools ttLib.woff2 compress`. The original font is licensed under the
SIL Open Font License 1.1.

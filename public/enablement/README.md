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

`cd/ci/inputs.ts` supplies Public's embedded Markdown, cross-stream fixture and local
verification command to the existing repository routing/local runner. The central
router remains the only selection decision. Both workflow entrypoints call the
moved tools directly. Changes to `public/enablement` retain Public admission;
the hosted-browser fixture also retains Connect browser admission.

See [Pages delivery](docs/pages-deploy.md) for artifact provenance, privacy,
current-main checks, origins and recovery. Workflow check names, gates, locks and
artifact names are unchanged. Reverting this migration must restore the tooling,
workspace/lockfile and all callers together; do not leave forwarding donors.

# Extraction verification record

Candidate starts at `3b95d12430d4113394ea85155163a5f8173bf8d8`.
All authored changes are inside `connect/web/**`. No site, service, native,
deployment or running-app changes. This is migration staging, not deployment.

## Baseline and development order

- Initial site build and hosted service test attempts exited 127 because this
  isolated checkout had no dependencies (`tsc: not found`). After existing locked
  dependency installation, both baselines passed without source edits.
- Site baseline: `APPARENT_PUBLIC_SITE=1 npm --prefix site run build`, then
  `cd site && node scripts/package-apparent.mjs && npm run test:hosted`:
  29 synthetic browser scenarios passed. The public-site flag follows the owning
  design doc; no claim about the ordinary private feature-map build is made.
- Service baseline: `npm --prefix hosted test`: 52 passed, 0 failed/skipped.
- Genuine first artifact RED: `cd connect/web && node --test test/artifact.test.mjs`
  exited 1 before implementation: independent Connect artifact was absent. The
  other new-file checks also failed on absent files; those are not credited as
  meaningful behavior RED. Existing auth behavior is inherited regression coverage,
  not a new authorization implementation or a separate auth TDD claim.
- First implementation commit: `a5134f5e824723452a2c038915422a85b21bfb98`.
  Artifact checks and all 32 extracted browser scenarios passed before commit.
  Pre-push ran the unmodified repo hook: offline cargo build and full tests;
  664 passed, 3 ignored. Push succeeded without bypasses.
- Visual comparison then found the inherited `.pond-page` foreground was missing.
  Added browser assertion for `rgb(2, 1, 2)`; RED exited 1 on the wrong colour.
  Restored the existing pond foreground locally, leaving the original hosted
  component, API boundary and hosted stylesheet byte-identical to the baseline.

## Final checks

- `cd connect/web && npx --yes bun@1.4.4 install --frozen-lockfile && npm test`:
  typecheck, production client/SSR/prerender, 3 artifact tests and 32 synthetic
  browser scenarios passed. Test build is isolated in `dist-test`; production
  `dist` retains `https://hosted.tryapparent.com` as the API default.
- Copied only this package plus the five approved `site/public` files to a fresh
  scratch tree with **no site implementation, manifest or node_modules**. Frozen
  Bun install, independent build and all artifact tests passed there.
- Final baseline comparison: 1440px computer, 1440px agent and 390px computer
  screenshots are pixel-identical. Computed styles matched for the page, header,
  heading, paragraph, primary action and summary. Dynamic expiry text was not
  treated as pixel-stable evidence.
- T3 collaborative preview opened the packaged synthetic device route, retained
  `?code=SYNTHETIC`, rendered the immutable read scope, loaded assets and fetched
  session/device successfully. Environment-port navigation initially selected
  `localhost`, which the fixture correctly rejected by CORS; explicit `127.0.0.1`
  matched the fixture allowlist. This is not a production CORS/OAuth claim.
- Auth/readback, keyboard, viewport and privacy checks use a labelled synthetic
  API, not fabricated live results. No real Google, Connect account, deployed
  origin, native device or capture was used. No capture-bundle directory exists
  at this Linux checkout's `~/Library/Application Support/apparent/captures`.
- Generated Bun lock is 165 lines. Every authored file is below 2,000 lines.

Evidence remains outside git at
`/srv/clanker-hermes/cache/scratch/connect-extraction-evidence/`:
`baseline-*-installed.log`, `red-artifact.log`, `red-color.log`, `final-full.log`,
`final-browser/receipt.json`, `standalone.log`, `final-compare-styles.log`,
`push.log`. The first commit push log is Linux compile/unit proof only, not GUI
or Mac proof. Any later push gets its own log and runs the hook again.

## Coordinator gates

Review the committed privacy/auth slice independently (no nested delegation in
this worker). Parent branch advanced only by a migration-plan document when
checked; no shared runtime delta needed reconciliation. Use the README's thin
artifact contract for composition and route mapping. Remove legacy wiring only
after the exact composed artifact passes. Deployment, feature-map changes,
live OAuth/callback/cookie/CORS verification and release remain integration work.

## Composed integration checkpoint (2026-10-31)

The extraction record above is historical. Integration adopted `a5134f5e` as
`303f5ccd` and `6123548ed5616683725a6723337fa147ab3418d9` as `b5f97635`, with
cherry-pick attribution. `0af67331` then composed independent route SSR/assets
into the allowlisted marketing package and removed `site/src/hosted` after
comparison. Marketing and the service stay in their existing directories.

- Frozen dependency installs retain marketing Bun 1.3.10 and Connect Bun 1.4.4;
  no lock, Cargo, helper or Rust changes. Original independent `npm test` passed:
  typecheck/build, 3 artifact cases and 32 synthetic browser scenarios.
- The actual composed artifact passed the original site's 29 browser scenarios
  and all 32 independent Connect browser scenarios against the loopback API.
  All four SSR route files are byte-identical to independent Connect output.
- Of 65 legacy/composed screenshot pairs, 64 are pixel-identical. The remaining
  `upload-approval-pending.png` differs only in the generated expiry timestamp
  region `[52, 664, 92, 674]`. Desktop/setup/approval screenshots and the composed
  device page were inspected visually, including the T3 collaborative preview.
- Genuine RED/GREEN covers composition, privacy/collisions, production-owner
  removal and CD wiring. A follow-up RED found that identical parent module
  bytes could conceal unequal transitive dependencies across the two builds;
  the packager now traverses each source's dependency closure independently.
- Full unchanged service suite: 52 pass. Hook Python suite: 22 pass. CD suite:
  15 pass. Public/composition suites: 23 pass before the additional dependency
  collision regression (four composition fixture cases now pass).
- Both adoption and composition pushes ran the unchanged pre-push hook's own
  offline Rust build/full tests: 664 pass, 3 ignored. These are Linux compile/
  unit results, not Mac or native GUI acceptance.

Evidence: `/srv/clanker-hermes/cache/scratch/connect-integration-evidence/`.
Relevant logs: `extraction-3.log`, `legacy.log`, `composition-red.log`,
`composition-green.log`, `boundary-red.log`, `cd-red.log`, `closure-red.log`,
`closure-green.log`, `final-cross.log`, `final-32.log`, `service.log`, `hooks.log`,
`delivery.log`, `push-adoption.log`, `push-composition.log`; browser receipts are
under `extracted-browser/`, `legacy-browser/`, `final-composed-browser/` and
`final-composed-32/`. `pixel-parity.json` records the complete comparison.

Final independent auth/privacy review belongs to the parent coordinator on the
frozen integrated SHA. No deployment, live OAuth, native transfer, live config
change or release was performed or is required to prove folder byte equivalence.

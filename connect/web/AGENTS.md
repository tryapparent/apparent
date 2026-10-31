# Connect web ownership

This package owns browser account, auth entry, device consent and their presentation.
Runtime ownership is `connect/web/**`. Do not change the running app, API service
or native capture code as a side effect of browser work.

- This is the sole browser implementation. Marketing browser/SSR must not import
  it. `site/scripts/build-public.mjs` builds both products independently, and
  `package-apparent.mjs` composes only allowed routes and referenced assets.
- Browser/backend contract: `../../docs/hosted-api.md`; selected visuals:
  `../../site/docs/hosted-design.md`. No redesign or shared marketing CSS.
- Run `bun install --frozen-lockfile`, then `npm test`. `bun run build` also works.
  Use maintained dependencies and the generated Bun lock, not a fabricated npm lock.
- `dist` is production route-only output. `dist-test` uses an explicitly synthetic
  loopback API. Never deploy it. Keep test receipts/screenshots outside git via
  `CONNECT_EVIDENCE=$TMPDIR/<unique-name>`.
- Never fetch account data during SSR, store credentials in browser storage,
  serialize CSRF into HTML/props, or log API bodies. Explicit separate consent,
  credentialed fetch, CSRF and mutation readback must remain intact.
- Build copies only five approved canonical assets from `../../site/public`.
  Runtime/SSR must never import site implementation. Do not add a root page,
  sitemap or discovery link. Integration owns the origin router and 404 behavior.
- Run the artifact and browser checks after every behavior change. Preserve
  production `dist` when testing. No deployment or live OAuth claim from fixtures.

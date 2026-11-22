# Connect web ownership

This package owns the browser account, sign-in entry, device consent and shared
link management. The Connect Worker serves its production routes. CI composes
the route artifact with Public for integration checks. Follow the
[route and composition contract](../docs/hosted-web.md#browser-entry-ownership)
and the [API contract](../docs/hosted-api.md).

- Preserve canonical `/connect` routes, legacy `/hosted` compatibility and device
  approval queries. Composition owns the origin router and 404 behavior. Keep
  the artifact route-only with no marketing root, sitemap or discovery link.
- Use Shared appearance tokens and the five approved Public assets. Keep
  runtime and SSR independent of Public implementation and marketing CSS.
- Keep SSR loading-only. Never fetch private account data during SSR, store
  credentials in browser storage, serialize CSRF into HTML/props or log API
  bodies. Preserve separate consent, credentialed requests, CSRF and mutation
  readback.
- After behavior changes, run `bun install --frozen-lockfile` and `npm test`
  for artifact and browser checks. Keep the Bun lock authoritative. Follow the
  [package guide](README.md) for production builds, synthetic test artifacts and
  evidence. Keep `dist-test` out of deployment. Verify real providers and
  composed routing separately when affected.

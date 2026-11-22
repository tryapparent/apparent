# Connect Bend policy

The service activity queue uses `activity-preference.bend` for the GPC and
DNT decision. TypeScript owns header reading and asynchronous activity writes.
The native CLI uses `reader-route.bend` to choose a reader from account-scoped
manifest probes and decide when to retry a missing capture. Rust owns secure
credential storage, the HTTP probes and decryption. The client build compiles
the route into `dist/reader/reader-route.mjs`, alongside the TypeScript handoff host that
loads it. The macOS and Linux staging step carries both into the app.

The native application embeds `credential-renewal.bend` through its QuickJS
host at build time. It runs from the headless CLI package with no Node or
Electron runtime. The standalone client verification lane runs the same
generated module and transition entrypoint through its Node host. The input is
limited to timing, journal completion, credential-presence and comparison
facts, and the transport adapter's typed rejection. Rust retains credential
validation, scope and generation checks, journaling, locks, revocation,
publication fences and network requests. This migration has no credential,
journal or API format change. Rollback can restore the preceding binary.

`npm --prefix connect/service run build` generates the module before bundling
the service. `npm --prefix connect/tooling/hosting run build` uses the same
build step before bundling the production gateway. The gateway artifact contains
the policy in `worker.js`. Restoring it requires only the sealed deployment
files.

Run `node connect/enablement/ci/bend/check.ts` to check the types and laws and
compare service and reader decisions on the proof and production paths. The existing
Linux Connect workflow adds `--proof` when the proof inputs change.
See the [shared build contract](../../../../shared/enablement/bend/README.md)
when adding a module.

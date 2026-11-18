# Connect Bend policy

The service activity queue uses `activity-preference.bend` for the GPC and
DNT decision. TypeScript owns header reading and asynchronous activity writes.

`npm --prefix connect/service run build` generates the module before bundling
the service. `npm --prefix connect/tooling/hosting run build` uses the same
build step before bundling the production gateway. The gateway artifact contains
the policy in `worker.js`. Restoring it requires only the sealed deployment
files.

Run `node connect/enablement/ci/bend/check.ts` to check the types and laws and
compare all four decisions on the proof and production paths. The existing
Linux Connect workflow adds `--proof` when the proof inputs change.
See the [shared build contract](../../../../shared/enablement/bend/README.md)
when adding a module.

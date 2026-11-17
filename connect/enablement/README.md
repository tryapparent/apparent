# Connect engineering ownership

Connect owns the build, verification and delivery mechanisms here. Runtime
implementation remains in `connect/client`, `connect/service` and `connect/web`.
The shipped mounted gateway (`connect/tooling/hosting/src/index.ts`) also stays
in its existing runtime home; owner-local hosting configuration and bundling
reference it directly. Its legacy directory name does not make it build tooling.
Package scripts are the public local entrypoints; run them from their package
(or use `npm --prefix <package>`). Their working directories and generated
`dist`, `.generated` and web `public` paths have not changed.

| Mechanism | Owner entrypoint | Real callers |
| --- | --- | --- |
| TypeScript client build | `client/build.ts` | client build/prepack, native verifier and Desktop packaging through npm |
| Service recipient and D1 migration staging | `service/` | service build/dev/deploy/test through npm |
| Browser assets, SSR routes, synthetic browser build | `web/` | web build/test through npm; Public composition and hosted verifier |
| Browser, recipient and native-client integration harnesses; producer vectors | `verification/` | npm tests, native hosted tests, foreground platform proof |
| Mounted Worker packaging, sealing, publication and recovery | `hosting/` | local command inventory; `stream-connect.yml` verify/hosted jobs |
| Stream suite projection, consumer declarations and portable commands | `ci/` | shared selector, local runner and Connect workflow |

`hosting/README.md` retains the bounded publication recovery procedure. Moving
it does not authorize activation or change its candidate, seal, binding, identity,
permission or concurrency gates. Artifact names and contents remain unchanged;
workflow upload/download locations now use `connect/enablement/hosting/.output`.
Hosting preparation calls the complete service build, including D1 migration
staging, so its synthetic database fixtures do not depend on an earlier service
test or cached generated output.

Repository coordination consumes `ci/inputs.ts` and `ci/commands.ts`; it remains
the sole routing decision and combines actual shared/native consumers. Connect's
plan in `ci/select.ts` uses that decision for its independent workflow.
Root contract entrypoints explicitly include `connect/enablement/ci/`.

Public still supplies five approved browser assets and owns its composed Pages
assembly/fixtures. The Connect workflow deliberately continues to verify that
composition before publication. This migration does not establish a Rust-free
Connect build: the retained native client and root integration still require
both native platform lanes. Native CLI and installed foreground harnesses still
require a rebuilt application on the affected OS; portable browser/workerd
checks do not prove native installation, Google OAuth or deployed behavior.

The obsolete script/tooling paths have no compatibility wrappers. Rollback must
revert the moved files and their package, fixture, local-runner and workflow
callers together; restoring only a directory would break those contracts.

## Automatic CI and delivery

`.github/workflows/stream-connect.yml` starts independent checks on main PRs and
main pushes, using the shared reviewed path inventory. `ci/select.ts` consumes
the shared selector facts and owns the Connect suite projection. PRs verify the
affected consumers; affected main and manual runs retain complete Connect
verification. Broad event filters may start a contracts-only run for unrelated
tooling, which cannot allocate native/portable product checks or publish.

Run the selector, workflow and admission contracts with:

```sh
bun test enablement/ci/
bun test connect/enablement/ci/
```

Portable checks run before affected Linux/macOS native integration. Publication
requires successful same-run contracts, portable and required native checks,
canonical main and `HOSTED_CD_ENABLED=true`. Existing production environment,
serialization, current-input guards and sealed-artifact verification still apply.

Capture no longer calls this workflow or adds Connect's complete main plan.
Overlapping native consumers run independently; no external workflow receipt is
trusted. The old same-run receipt producer/consumer has been removed. Reverting
the split requires restoring its complete caller/consumer wiring, never waiving
Connect's native gates. No service activation or provider configuration changes
are part of this routing change.

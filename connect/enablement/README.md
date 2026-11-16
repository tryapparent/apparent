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
| Stream suite projection, consumer declarations and portable commands | `ci/` | shared selector/native receipt producer, local runner and Connect workflow |

`hosting/README.md` retains the bounded publication recovery procedure. Moving
it does not authorize activation or change its candidate, seal, binding, identity,
permission or concurrency gates. Artifact names and contents remain unchanged;
workflow upload/download locations now use `connect/enablement/hosting/.output`.
Hosting preparation calls the complete service build, including D1 migration
staging, so its synthetic database fixtures do not depend on an earlier service
test or cached generated output.

Repository coordination consumes `ci/inputs.ts` and `ci/commands.ts`; it remains
the sole routing decision and combines actual shared/native consumers. Connect's
plan uses that decision and the existing exact-candidate shared native receipt.
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

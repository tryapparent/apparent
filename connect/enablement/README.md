# Connect CI

`.github/workflows/stream-connect.yml` starts independent checks on main PRs and
main pushes, using the shared reviewed path inventory. `ci/select.ts` consumes
the shared selector facts and owns the Connect suite projection. PRs verify the
affected consumers; affected main and manual runs retain complete Connect
verification. Broad event filters may start a contracts-only run for unrelated
tooling, which cannot allocate native/portable product checks or publish.

Run the selector, workflow and admission contracts with:

```sh
bun test connect/enablement/ci/ enablement/ci/
```

The aggregate daily activity implementation and its test are the first
service-only inputs. The repository workflow excludes these two exact paths
from its automatic filter. The selector checks both committed trees for
references outside the service. An unproven boundary requests conservative
coverage and blocks automatic admission when a required workflow is outside
the event filters. Rollback restores both the repository filter and the
broader consumer mapping.

`aggregate-dau.ts` supplies Worker-side background D1 writes and maintenance
through `captures.ts`, `shares.ts`, and `worker.ts`. The mounted gateway builds
the Worker, including staged service assets and generated Bend modules.
The native activity client calls `/v1/activity/recording-started` over HTTP;
changes to the route's Worker entry still select native integration. The
TypeScript transfer contract is consumed by the service and by the client
package. Linux stages its generated JS explicitly, and macOS stages the
client's built distribution. Both keep Desktop integration and publication
routing. Shared UI/assets and the hosted browser fixture continue to select
their recorded consumers.

Portable checks and affected Linux native integration run in parallel after
selection and contracts. Optional macOS diagnostics follow portable checks.
Publication requires successful same-run contracts, portable and required native
checks, canonical main and `HOSTED_CD_ENABLED=true`. The full portable plan runs
the Worker and standalone Connect browser suites once on the candidate.
Publication verification builds the inputs for the composed browser and theme
checks, then tests and seals the mounted production package. Public's standalone
site checks run in its own workflow. The Connect portable job uses the same
command runner as the general job, with Ubuntu APT transport, FFmpeg and Chrome
for the recipient checks. The repository portable lane still handles mixed
and fallback coverage, manual diagnostics, and capture driver dependencies.
Existing production environment,
serialization, current-input guards and sealed-artifact verification still apply.

Capture no longer calls this workflow or adds Connect's complete main plan.
Overlapping native consumers run independently; no external workflow receipt is
trusted. The old same-run receipt producer/consumer has been removed. Reverting
the split requires restoring its complete caller/consumer wiring, never waiving
Connect's native gates. No service activation or provider configuration changes
are part of this routing change.

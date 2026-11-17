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

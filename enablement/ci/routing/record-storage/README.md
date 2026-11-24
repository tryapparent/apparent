# Record Storage routing preflight

Before starting the push hook for a change to an audited Record Storage routing
input, run this focused test from the repository root with Bun 1.3.10:

```sh
bun test enablement/ci/routing/record-storage/range.test.ts
```

The test reports the mismatched path and expected and actual Git tree entries,
or a missing entry. Re-audit the input before updating the canonical pin in
[`qualify.ts`](qualify.ts) and obtain approval for any out-of-scope edit.

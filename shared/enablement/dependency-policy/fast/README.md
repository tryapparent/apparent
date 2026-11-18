# Staged TypeScript and focused tests

The hook discovers tracked `tsconfig*.json` files and selects the nearest
ancestor with a tracked npm or Bun lock. It checks changed project sources,
configurations and lock inputs. Routing follows parsed config root files,
resolution of tracked imports, extended and referenced configs, package
manifests and declared project dependencies in both Git trees.
Owner declarations in `<owner>/enablement/ci/typecheck.json` add producer
inputs or preparation that import analysis cannot see. Composition declares
its Desktop dependencies and generated declaration producers. Connect declares
its existing recipient build. Preparation follows declared dependencies and runs
their generators in dependency order, including when only the consumer is
selected. Compilation happens on Git blobs, including
local package sources. The report names changed TS files that no selected
compiler read. Repo tooling, standalone runtime tests and other files outside
project configs still receive the existing admission guards and applicable
focused tests.

Install the shared lint/admission tools, stage the intended files, then prepare
missing project dependencies outside the commit:

```sh
npm ci --ignore-scripts --prefix shared/enablement/dependency-policy
node shared/enablement/dependency-policy/fast/setup.ts --staged
```

Add `--all` to warm all project installations. Setup uses npm ci or frozen Bun
with lifecycle scripts disabled. A private disposable worktree cache under
`/tmp` keys each installation by package manager and Node versions, platform,
lock, manifest, package configuration and the Git trees of local packages.
Stage the intended lock and local package changes before preparing. Cache
eviction or an input change prompts setup again. The commit hook never installs
dependencies. A missing cache is a setup error. A compiler error such as
TS2688 after setup must be fixed in the staged project's configuration or
locked dependencies. The guard tools' Node types are isolated from compilation.

`<owner>/enablement/ci/fast.json` still declares focused owner tests and the
Record typed promise-lint contract. Those tests use staged files and must stay
cheap, offline and service-free. The two legacy capture projects continue to
use their checked-in configs and lockfiles. No Electron browser, UI interaction
or native build is required for these TypeScript checks.

# Local verification

Pre-push verifies the exact checked-out HEAD with a clean worktree and no hidden
index flags. Deletions send no candidate and return immediately. Other refs must
point to HEAD. Selection uses the entire merge-base(origin/main)..HEAD range,
including earlier commits, both rename sides and deleted paths. Unknown history
retains broad coverage. A previous push is never a verification checkpoint.

The shared range selector is `enablement/ci/select.ts`. It consumes owner facts,
including `shared/enablement/ci/inputs.ts` for admission tooling and
`connect/enablement/ci/local/service.ts` for the qualified service command.
Admission tooling has tooling consumers. New product references to that tooling
invalidate its independent qualification. Unknown paths and unsupported Git types
retain conservative selection. The pre-commit admission guards remain commit-only.

Local Rust diagnostics consider full-range Rust source changes, Cargo manifests
and locks, toolchain/config changes and declared native code-generation inputs.
The pre-push hook uses the same integration range for locked offline Cargo checks on
affected production targets. When rustc emits `dead_code` warnings, the same
Cargo check on the main merge-base supplies the baseline. Warnings are compared
by package, target, source, enclosing Rust items and diagnostic identity with
occurrence counts.
Existing warnings survive line shifts. Missing history, unavailable tooling,
Cargo errors and an unusable comparison fail the push. No warning verdicts are
stored. Both revisions explicitly target the verified native Cargo and rustc
host. Cargo honors snapshot and Cargo home configuration for native builds.
The check selects the verified rustc directly and clears compiler wrappers.
Candidate and baseline reuse a diagnostics-private target/build directory
per manifest when their toolchain and Cargo configuration match. Later
invocations start cold. The directory is discarded on completion, keeping
build scripts and their runtime companions separate from developer artifacts.
When the hook selects Rust diagnostics, it loads the locked syntax tools before
running Cargo. Install them with `npm ci --ignore-scripts --prefix shared/enablement/dependency-policy`.
The standard contracts command installs these tools and exercises both the
TypeScript and Cargo hook fixtures.

| Native project | Host diagnostic scope |
| --- | --- |
| Root Apparent and Connect client | Default-feature production bin and library |
| Legacy Capture Engine | Default-feature library |
| Engine Media | Release bins with the owner `frames` feature |
| Agent Narrator | Release binary |
| Site video demo | Separate Metal/media build with no tracked Cargo lock, outside hook scope |

A Linux run covers Linux cfg branches. macOS-only code requires a macOS run.
Test-only cfg branches and nondefault variants outside the table remain with
the existing build/test/release commands. The diagnostic step adds a metadata
check, without linking the production binaries a second time.

Ordinary affected product checks execute their unit, type and integration commands.
Hook/selector/timing self-tests run for tooling changes and uncertain inputs.
They are omitted for known unrelated product edits. Local Desktop renderer source
changes run the package's unit/type checks. Electron integration remains selected
for native, Electron/CommonJS and test inputs, unknown inputs and hosted execution.
Hosted browser/native/release gates retain their owning workflows.

## Preview and execute

```sh
node --experimental-strip-types enablement/local-tests/run.ts \
  --base "$(git merge-base HEAD origin/main)" --head HEAD --explain
```

The preview reports committed paths, owners, reasons, commands and reuse policy.
It cannot establish a receipt hit before fresh preparation and qualification.
Add `--run` to execute the identical plan. Direct service verification can produce
the same evidence consumed by pre-push, without requiring a push:

```sh
node --experimental-strip-types enablement/local-tests/run.ts --service-tests
```

This entrypoint runs the locked service install and canonical `npm test`. Other
service integration/browser commands remain in the affected push plan.

Set `APPARENT_TIMING_FILE` to a file under a private `/tmp/apparent-dev-<job>-<run>/`
directory to observe setup/build/test phases through `enablement/timing/command.ts`.
Each row records elapsed command execution and terminal status. The surrounding
source SHA and command inventory must accompany measurements. Runner admission
and queue time remain unknown to that observer. A phase named test may contain
its package's own build. Failed commands retain their failure status.

## Qualified local reuse

`service.ts` qualifies the complete current `.mjs` and `.ts` test inventory,
service sources/scripts/configuration/fixtures, the TypeScript client contracts
consumed by the Worker, Shared UI/assets, generated output and installed package
bytes. Its audited committed closure is pinned in the Connect declaration. A
changed closure runs fresh until reviewed and requalified. This is deliberately
bounded to the supported canonical command, local Linux x64 glibc and supported
npm/runtime configuration.

The test inventory follows the canonical command’s two globs: sorted `.mjs` files
first, then sorted `.ts` files. Missing glob matches, symlinks and non-file inputs
fail instead of becoming an empty success. Both inventory groups remain required.
The owner declaration conservatively binds the complete TypeScript client tree;
this includes the Worker’s three source-only wire contract inputs.

Service `npm ci` and build execute fresh before receipt lookup. Only the serial
Node test phase is reusable. Missing dependencies cannot resolve through global
Node search paths. Optional live Miniflare geolocation fetch is disabled for this
synthetic suite. Effective npm configuration, remaining environment, executable
bytes, OS/kernel/boot and transitive ELF loaders contribute to identity. Unsupported
loaders, npm shell/workspace/script policy, proxy overrides and external symlinks
run the original npm command. Environment values remain private digests.

Every tracked file is checked against committed bytes and executable bits
independently of Git's stat cache. Whole-source mutation detection is separate
from the relevant-input key, permitting reuse across unrelated clean commits.
Symlink targets and installation changes are bound. Reuse requires the exact
checked-out candidate, no hidden flags and integration with current origin/main.

Desktop dependency reuse qualifies `npm ci` through its real lock/install graph,
reviewed lifecycle scripts, local packages, generators, runtime/configuration and
installed bytes. Selected unit/Electron checks execute fresh even on an install
hit. The complete block holds a worktree-private Git mutex because npm replaces
node_modules. Interrupted locks require owner verification before removal.

Receipts extend `receipt.ts`. Storage is automatically discovered in a private
worktree-specific `/tmp/apparent-dev-local-reuse-<hash>-<random>/` job. Caller receipt
paths are unsupported. One latest success expires after six hours and is sealed
with a random local key. Ownership, modes, type, links, command inputs and seal are
validated. Concurrent fallbacks invalidate prior and overlapping evidence. Failures
never retain success. Input mutation, corrupt/expired receipts and storage errors
run fresh. Cleanup simply loses reuse. This trusts the local OS account and cannot
authenticate against that account replacing code and keys.

Local evidence cannot admit hosted publication. Hosted Mac installation-contract
reuse remains separate in `enablement/ci/install-contracts/`: it requires a successful
same-run/attempt job, actual fixture step and candidate/command/environment-bound
artifact. Missing or incompatible hosted evidence executes the original suite.
No local or hosted lookup waits for another producer to finish.

## Hooks and fixtures

Prepare hooks with `enablement/hooks/prepare.ts --output /absolute/new/private/directory`.
The optional `--retire-verified-line-guard` and `--retire-verified-cargo-push` flags
retire only the exact fingerprinted obsolete hooks, retaining byte-for-byte backups
and provenance. Unknown custom pre-push hooks are preserved and need review before
tracked push policy can be activated. Installed maintained wrappers resolve the
current worktree, so common hook configuration cannot pin another checkout.
Preparation never changes live Git configuration. See
[issue admission](../../shared/enablement/issues/README.md) for message hooks,
binding, the rollout baseline and fresh pre-push issue lookup.

Synthetic runner repositories copy the real bounded TypeScript source closure.
Finite downstream fixtures test dispatch/failure propagation without recursively
executing hook tests. Those fixtures substitute the issue stage only in selector
regressions. The issue suite independently exercises real commit/push hooks and a
deterministic fake gh API, including failures before expensive verification.

## Clanker resource admission

Run heavy tests and hook-backed pushes once through `/home/simon/.local/bin/t3-build`.
The push entrypoint preserves stdin, signals, exit status and the runner's deadline:

```sh
node --experimental-strip-types enablement/local-tests/execution/push.ts --jobs 2 -- origin HEAD
```

It replaces itself with `t3-build -- git push` and adds no timer. Already admitted
commands run Git directly. Read current runner help for its live budget. Supply
`--total-budget SECONDS` only for an actual user limit or explicitly bounded
diagnostic. Timeout is failure, never evidence of completed verification. Retain
the foreground handle and consume the original terminal result before retrying.

Create diagnostics/output in a private `/tmp/apparent-dev-<job>-<run>/` directory.
Evidence there is disposable. Choose worker counts using actual capacity and the
selected plan. For future independent T3 work, request workspace binding before
launch with the default branch and startFromOrigin. Pin a local commit when an
unpublished dependency is required. Existing reservations and holds remain active.

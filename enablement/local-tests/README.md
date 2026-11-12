# Local verification reuse

Pre-push uses the shared TypeScript consumer map in `ci/routing/consumers.ts`.
Native manifests, lockfiles, build helpers, embedded assets and Swift/Metal
adapters retain native checks even without Rust source edits. Public/browser
changes and ordinary owner prose avoid unrelated native suites. Unknown history,
inputs and unsafe Git modes/types stay broad. Only proven concurrency-only
workflow edits select tooling alone; execution-sensitive workflow changes retain
integration coverage. Hosted and local execution call the same range selector and
named suite plan; see [the CI contract](../docs/continuous-delivery.md).

The audited standalone regression files `local-tests/reuse.test.ts` and
`prerequisites/native.test.ts` select tooling alone. Both remain in the always-run
contract inventory. Execution sources, unknown test files and mixed changes keep
their existing consumer coverage; this is not a blanket test-file exemption.

Capture-tool Node tests share one serial `node --test` invocation with per-file
worker isolation. Python tests retain separate interpreters, and the CLI test
requiring `APPARENT_BIN` still follows the rebuilt native executable. The tracked
file inventory and failure propagation remain required on both platforms.

Local selections that need Rust check the existing private temporary-root contract
before other commands. When Desktop is selected, its locked install, unit tests
and complete Electron suite run before Rust verification. This catches missing
Electron downloads, display/sandbox setup and renderer failures before a cold
native build. Source-first policy proof remains separate from canonical Desktop
coverage. No sandbox permissions or host configuration are changed. Repair the reported prerequisite and rerun the
normal command; this ordering does not turn renderer checks into native proof.

For native integration setup, install the locked frontend dependencies with
`npm --prefix capture/desktop/ui/frontend ci --no-audit --no-fund`, then run
`node --experimental-strip-types enablement/prerequisites/native.ts` from the
repository root. CI uses the same preparation entrypoint. It checks the local
Electron executable before compiling Storage, Connect and Record artifacts,
then validates the required files (and parses the Mac picker on macOS). Missing
generated output is rebuilt; a runtime or generator failure stops preparation.
Rerun after disposable outputs are cleaned. This prepares inputs without Cargo
or a GUI launch; it does not establish app readiness or native acceptance.

## Desktop dependency installation

On local macOS/Linux pushes, the Desktop block can reuse a successful
`npm ci --no-audit --no-fund` installation in the same worktree. Both `npm test`
and the complete `test:electron` build/suite execute on every push, including
installation hits. CI, missing admission and unsupported command/environment or
dependency lifecycle shapes retain the original clean install. Hosted workflows
and native/release gates are unchanged.

`desktop-install.ts` binds the frontend manifest/lock, build/staging helpers and
compiler/Vite configuration, npm configuration and config
files, Node/npm bytes and versions, OS/architecture, install environment, and
source inputs of the two supported local file packages (Shared UI and Record
Storage). Other local packages, linked lock entries and new dependency install
scripts fall back to fresh execution. Operational IDs are removed from the actual
install as well as its fingerprint; loader/runtime overrides run fresh.
Ordinary frontend source edits are not installation inputs.
Package lifecycle hooks (`preinstall` through `postprepare`, plus `dependencies`)
always retain fresh npm execution, so a source-only edit cannot suppress an
install hook that reads application sources.

The installed tree's complete bytes, modes, inventory and internal symlink targets
must match the saved output. Missing/modified dependencies trigger installation;
timestamps and inode identity additionally detect changes during lookup.
Within one lookup, unchanged file digests can be reused after checking device,
inode, mode, size, ctime and mtime again. This memo never survives the invocation;
each new push reads installed bytes afresh. Directory/link inventories are always
walked, and committed-blob assertions never use memoized digests.
Desktop's build restages Record's compiled exports in `node_modules`, so cold
qualification saves output only after both fresh Desktop suites succeed, with
unchanged install inputs. On a hit the same suites run again. Generated local
package `dist` is rebuilt by those checks, not used as an install-input receipt.
The logged cold qualification duration includes those checks; it is not the time
saved by skipping installation.

Evidence uses the existing private six-hour receipt mechanism, in a separate
namespace keyed by the frontend directory. Failed installs/checks cannot publish
a new receipt. Cleanup, contention, expiry, invalid seals and uncertain inputs
lose the optimization. No cross-worktree `node_modules` or persistent config is
shared. This trusts the same local account as the hook. Roll back by removing
the `desktopDependencies` call; the runner's canonical command plan stays intact.

A per-worktree runtime mutex under Git's administrative directory protects the
whole install/check block, including hits and fresh fallbacks, from another
invocation replacing `node_modules`. A busy/unavailable mutex fails the push
before running Desktop commands. Normal completion and exceptions release it;
an interrupted owner leaves a lock that requires verification before removal.
This required runtime state is separate from disposable `/tmp` evidence.

The installed-hook regression uses real Git pushes and npm file dependencies in
a synthetic package: consecutive source-only pushes install once and execute
both suites twice. It also checks dependency damage, mode/deletion changes,
local-package changes, environment changes, fresh CI fallback and failed checks.
This proves tooling behavior, not native Electron application acceptance.
These new installer fixtures run only for tooling/unknown changes or dependency,
installer-producer and configuration inputs. They are not added to every cheap
contract pass: ordinary renderer/source pushes retain their actual existing
suites without paying for synthetic npm reinstalls. Mac CI uses the same
`run.ts --desktop-install-contracts` selection, with unknown history conservative.

## Connect service test reuse

The local runner reuses successful Connect service serial Node tests on Linux x64/glibc by
default when their qualified inputs match. The audited closure is pinned in
`service.ts` to the service, shared UI and shared assets at `5d2931bb1`. Changing
that closure runs the original `npm test`. Expanding qualification requires
reviewing the command's transitive reads, subprocesses and environment again.
The service's 102 tests use synthetic identities and in-memory Miniflare, including
loopback OAuth endpoints. They do not consume Git ancestry or the native app.

Every selected command still runs through the existing owner plan. `npm ci` and
the service build run fresh, producing the worker and recipient assets before
receipt lookup. Only the serial Node test phase can be reused. Its full sorted
test inventory is identical to the canonical package script. Global Node module
search is disabled so missing local dependencies cannot resolve from the user's
home. Miniflare's optional live geolocation fetch is disabled in this qualified
phase, which never exercises `Request.cf`. Transport/lifecycle IDs are removed
from that subprocess environment. Every remaining variable is hashed, including
worker allocation, PATH, locale and temporary-directory settings. Environment
values are never written into receipts. Effective npm configuration and its
user/global/project files are fingerprinted before and after verification.
Node options, custom script shells, workspace/global execution and script policy
overrides use the original fresh npm command, including changes during the build.
Runtime-loader and dependency-path overrides also use the original fresh command.

Before root Rust verification, `enablement/verification.py --run` runs
`npm ci --no-audit --no-fund` and `npm run build` in `connect/client/typescript`.
The Rust Connect shares tests consume that package's policy, and a fresh checkout
does not contain its ignored `dist/` output. The verifier checks for
`dist/shares.js` before starting Cargo. A standalone client-only runner uses the
same verifier prerequisite command before its package Cargo checks.

Qualification also requires a clean checked-out exact HEAD, no hidden index
flags and integration with the current `origin/main` checkpoint. The runner
verifies every tracked file against its committed blob and executable bit
independently of Git's stat cache. The reusable identity binds the audited
service, shared UI and shared asset inputs rather than unrelated tracked files,
so a clean unrelated commit can reuse tests. All tracked files retain mutation
detection during qualification and execution. Consumed symlink targets remain
part of the identity even outside the named input directories. It also binds all installed service
dependencies, generated build output, modes and internal symlink targets. The
Node executable, kernel/boot, OS configuration and transitive ELF loader libraries
of Node and installed glibc native dependencies are included. npm's inactive musl
variants are content-bound, with their incompatible loaders excluded. External source links,
special files, ancestor `node_modules`, unknown history and unreadable inputs
fall back to execution. Identical `npm ci` reinstalls can match by content. Inodes
and change timestamps are checked separately before and after each lookup/run to
reject installation races and input changes during execution.

Evidence lives in an automatically discovered, private worktree-specific
`/tmp/apparent-dev-local-reuse-<worktree-hash>-<random>/` job. No environment or CLI
argument can supply a receipt. One latest success expires after six hours and is
sealed with a random private local key. Ownership, modes, file types, links and
the seal are verified. An exclusive lock prevents cooperating writers from
sharing an in-flight receipt. Contention runs fresh, marks the concurrent command
and changes the evidence generation both before and after it runs. Readers and
publishers reject concurrent markers and changed generations, including a failure
that overlaps an exclusive writer. Interrupted markers or locks run fresh until
the disposable job is removed. A failed command invalidates prior evidence and
never publishes success. Atomic replacement follows successful execution and unchanged inputs.
Cleanup or storage failure loses only the optimization. Removing this job resets
the evidence. This trusts the local OS account that can already edit the hook
and its code. It does not authenticate evidence against a malicious same-account
writer capable of replacing both code and keys.

The hook's cheap contracts and its before/after clean-tree, hidden-index and
exact-HEAD checks stay fresh. Owner selection, unknown-input coverage, Rust,
Electron/browser tests, product native acceptance, hosted CI and release admission
retain their existing procedures. Local receipts cannot admit any hosted or
published artifact. Roll back reuse by removing the `serviceTests` call from the
runner. No service data or persistent configuration is migrated.

Run the regression suite with
`node --experimental-strip-types --test --test-concurrency=1 enablement/local-tests/*.test.ts`
through the normal build admission. It includes a real installed Git hook with a
synthetic test phase, receipt corruption/expiry/concurrency, failed commands,
environment and file/dependency invalidation, and mutation during verification.
Real package timing evidence is recorded separately from these synthetic tests.

Audited TypeScript sources/tests and package manifests, locks and tsconfig in
`record/storage` and `record/completion` select Desktop plus native capture.
Storage's `build.ts` has the same consumers. Desktop's canonical `npm test`
includes both Record test inventories; its Electron build generates the Storage
adapters and Completion worker, which settings packaging stages for the native
app. Root/platform integration and Mac admission remain selected. Isolated inputs
omit unrelated Connect, Public and Hermes suites; mixed edits retain the union.
Embedded instructions, unexpected files/native sources, unknown Record packages and
unknown history keep the broad fallback. Rollback is reverting these consumer
rules and their regression expectations; no elapsed-time savings are claimed.

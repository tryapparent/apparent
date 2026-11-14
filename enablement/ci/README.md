Consumer selection, exact-tree PR evidence reuse and automatic Linux Main publication are documented in [continuous delivery](../docs/continuous-delivery.md). `routing/consumers.ts` owns directory triggers, named suites and shared consumer facts; local pushes and workflows both call `selectRange`. `routing/streams.ts` only compares publication inputs; native commands remain in the existing verifier adapter.

[Failed-head completion receipts](completion/README.md) use GitHub workflow events
and the existing PR comment watch, without a T3 fork or polling service. The
`Verification support` workflow keeps manual Linux checks separate from its
notification job; completion comments supply no acceptance or publication proof.

Publication admission uses completed platform receipts even when GitHub marks
the overall run `queued` because another platform is waiting for a runner.
Exact main identity and successful platform/shared checks remain required.

The hosted Mac picker driver resolves the owned `NSRunningApplication` once per
command and retains that instance through activation. Hosted receipts captured a
fresh PID lookup returning absent immediately after activation of the same live
process. Focus observations service AppKit's run loop, recheck the retained
instance's PID/executable/termination state, and require the matching frontmost
PID. AX/window guards, one activation, input ordering and deadlines remain intact.
This is a Mac AppKit mechanism; Linux's owned QMP input adapter is unchanged.

Ready-PR/manual platform verification opts into root test/build overlap. The
verifier retains the Cargo inventory; `root.ts` starts the real app build only
after Cargo reports successful test compilation. Two test threads overlap one
build worker. Both commands must pass before the verifier continues. Focused
filters, allocations below three workers and ordinary local callers retain the
sequential path. Engine, native, cache and publication gates remain required.

Each overlap has an owned session leader. It stays alive after command exit and
signals only its own process group on completion, failure, cancellation or IPC
disconnect. The caller waits for that leader to exit; it never signals a possibly
reused child PGID. The enclosing workflow still owns its existing job deadline.

`inputs.ts` supplies the committed, no-rename path facts to hosted and local
selectors. Local and hosted selectors share the same control-only proof. Feature PRs/pushes
may classify modifications to existing regular `checks.yml` and
`stream-public.yml` files as control-only: the ordinary top-level concurrency
block must change, parsed execution fields must match, and bytes outside that
block and adjacent comments must match. YAML anchors/tags/aliases or complex
control shapes, invalid/unavailable history or parsing, file additions/deletions,
renames and mode/type changes cannot establish that proof. Other changed paths
still select their own coverage; unknown/execution-sensitive inputs stay broad.

Eligible pushes run the mandatory theme, hook, selector, YAML/workflow,
prerequisite, timing and release-admission contracts plus tooling width checks.
Only unrelated product suites are omitted. Main/tag pushes and hosted main selection disable this
exception; explicit conservative verification, hosted platform gates and release
or native acceptance are unchanged. Selection tests prove command omission and
failure propagation, not measured per-push savings or native behavior.

Mac's early CI-sensitive fixtures share one `cargo test` invocation. libtest
ORs the three positional substring filters, retaining both command-line row
cases, competing-launch socket ownership and Darwin ACL fail-closed checks.
They use two test threads, as the later full suite already does. The cases use
independent fixtures; the early groups no longer require separate processes.
Linux batches its two early filters (three cases) into one invocation with two
test threads as well, removing one Cargo freshness traversal. Packaging, native assertions, the later
unfiltered verifier and cache-completion/publication guards remain required.
No artifact or test receipt is restored by this change; cold caches still build.

Diagnosis used completed Intel Mac jobs on Rust 1.99.1, the unoptimized root
test/dev profiles and the same full three-workspace cache inventory:

- [137d9605e main job](https://github.com/tryapparent/apparent/actions/runs/42609778162/job/129135889251):
  exact 748 MiB dependency-cache restore took 136s. The early Cargo commands
  reported 325s, 94s and 71s; only the first reported compilation (root and
  path client). The four harness cases reported 0.33s combined execution.
- [15132a092 main job](https://github.com/tryapparent/apparent/actions/runs/42614044719/job/129153813172):
  the same exact cache restored in about 73s. Early Cargo commands reported
  403s, 71s and 75s. Later retained compiler HTML had 721 fresh units, zero
  dirty units and no compiler activity while its command span took 61.7s.

Those observations identify repeated Cargo preparation/freshness work, not
repeated linking in the later two calls. They do not localize the fresh-check
delay further or separate the first build's native helpers, Rust codegen and
linking. Early `--timings` now retains Cargo build-unit timings through the
existing artifact upload; it does not time individual Swift or linker calls.
Removing two invocations targets their observed
overhead; it is not a measured end-to-end speedup. Workspace-crate caching is
unchanged: source/config, compiler/profile/features and native build inputs
remain Cargo's responsibility, without copying targets across worktrees.

The ordinary prerequisite contracts exercise workflow ordering and failure
gates without Rust. For cold-build, real Cargo/libtest selection and a failing
assertion in each selected case on both workflow branches (synthetic dependency-free sources):

```sh
APPARENT_EARLY_CARGO_FIXTURE=1 node --experimental-strip-types --test enablement/prerequisites/order.test.ts
```

On Clanker, run that command through `t3-build --jobs 3 --min-jobs 3 --`.
This fixture proves filter semantics and failure propagation, not platform native
acceptance. Normal ready-PR platform CI must still verify the real candidate.

Hosted Ubuntu checks use `.github/actions/ubuntu-apt` before installing packages.
GitHub's image assigns Azure/Ubuntu mirrors priorities 1–3. The action tests
Ubuntu's HTTPS archive and then Kernel.org with APT's own acquire backend, since
curl can succeed for a host that stalls APT. Each candidate must supply the
updates suite's InRelease and its amd64 main by-hash package index (hash checked),
within one ten-second timeout plus two seconds of termination headroom. The first
passing candidate is promoted to priority 0; only this helper's exact priority
entries are replaced, preserving hosted fallbacks. If neither candidate passes,
preparation fails before installation instead of promoting an untested mirror.
The disposable runner's dedicated `zzzz-apparent-transport` APT config limits HTTP
and HTTPS inactivity to 15 seconds and acquisition retries to one. These are
per-request bounds, not a total installation deadline; job timeouts remain.
The helper verifies APT's merged acquisition values through `sudo apt-config`
before mirror promotion and refuses unexpected overrides. This matters because
later runner fragments can override a correctly written `80-*` file. The real
APT regression exercises that precedence in an isolated configuration tree.
This addresses repeated hosted DNS/download timeouts without changing Ubuntu
archive keys, package signatures, source suites or dependency/test requirements.
It is restricted to disposable x64 Ubuntu Actions runners. macOS keeps its existing
Homebrew/native setup. Tests execute the shipped mirror-list transformation
against isolated files, including idempotence and unsafe-target refusal.
The updater harness, manual web verifier and x86 Linux packaging also prepare
transport before package installation. Packaging pins the reviewed action so
older checked-out release tags need not contain it. ARM packaging uses the
existing Ubuntu ports path; the x86 archive mirror is not ARM transport proof.
The workflow regression enumerates all package-install callers, including manual
workflows, so a new caller cannot silently omit preparation.

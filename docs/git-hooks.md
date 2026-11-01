# Git hooks: fast index checks, conservative push checks

## Setup and diagnosis

From the checkout you intend to use:

```sh
python3 scripts/git_policy.py setup
python3 scripts/git_policy.py doctor
```

Setup is **explicit**. Nothing installs hooks at import, build or test time. It sets
repository-local `core.hooksPath=.githooks`, shared by this repository's linked
worktrees. Git resolves this relative path against **the worktree running the hook**,
so each branch uses its own checked-out hooks and scripts, not another worktree's
absolute directory or a copied stale version. Older branches without these files
cannot run these hooks. Coordinate setup with other worktree users. A worktree or
command-line Git config override can supersede the shared setting; doctor prints
the effective config origin, resolved hook paths, executable status, policy version
and exact hook-byte match against this checkout. Setup does not silently remove
overrides. The hook scripts and supporting worktree files are trusted local code;
do not run them from an unreviewed checkout. This is not a hostile-code sandbox.

## Who checks what

| Entry | View | Responsibility |
|---|---|---|
| `.githooks/pre-commit` / `python3 scripts/git_policy.py staged` | Actual index blobs, including partially staged files | Fast architecture/artifact checks, added-line whitespace, conflict markers, supported formatting/syntax, nonblocking change-size advice |
| `python3 scripts/git_policy.py tree --revision <commit-or-tree>` | Exact resolved Git tree, independent of the index | Architecture and prohibited paths; no formatting claim |
| `.githooks/pre-push` | Clean exact checked-out HEAD | Existing HEAD/dirty/hidden-index/final-tree guards plus `scripts/verification.py --run` |
| Changed-tree CI | Checkout HEAD tree (including PR test merge when applicable) | Policy and hook/selector contracts independently in the select job; same policy before selected build/test lanes |

Policy runs before every selected verification lane, even docs-only. The conservative
selector, whole-main-merge-base comparison and broad fallback are unchanged. A new
hook/selector/CI input still broadens to root plus Engine build/tests. Existing
website, Connect, updater and release gates remain separate and required. This
slice does not install post-commit automation, send anything, sign or publish.

## Staging and offline contract

The pre-commit command never stashes, formats in place, stages, changes config or
executes staged Python/shell scripts. It reads blobs via Git object IDs; unstaged
edits do not affect their contents. It checks that the index entries stay unchanged
through the run. Candidate hook/helper edits are inspected as data, not exported
and executed from the index. The already checked-out helper is the executor.

Requirements: macOS/Linux, Git, Python **3.11+** (`tomllib`), `sh`, and `bash` for
changed Bash scripts. Changed Rust requires the installed `rustfmt` component.
No dependency download, package install or network call occurs in pre-commit.
Rust formatting uses stdin in an owned temporary directory, edition 2024,
`skip_children=true`, stdout comparison and no checkout rustfmt config/module
traversal. Run your formatter explicitly, then stage the intended hunks. JSON and
Python get syntax validation only; shell gets `sh -n` / Bash `-n` only. There is no
configured Python/JS/TS/CSS/HTML/Markdown/YAML/Swift formatter in this slice. The
command reports this rather than calling syntax or whitespace checks formatting.
Ordinary symlinks and gitlinks receive path privacy checks, not regular-file
formatting/syntax checks. Configured architecture files must still be regular.

All policy operations share a 45-second deadline. Timeout or interruption fails
closed, kills the owned tool process group and cleans temporary formatting files.
`TMPDIR` selects the temporary root; Clanker uses its mandated scratch directory.
Missing required tools fail with a setup diagnostic. Large changes receive advice
above 500 added/deleted text lines, not a quota or commit prohibition. Diagnostics
name paths rather than echoing source/credential contents.

## Architecture: current boundaries, not future packages

`refactor.md` remains the ownership authority. The checks deliberately cover only
facts that exist today:

- **Engine:** parse its actual Cargo TOML, including target/dev/build dependency
  tables and renamed package dependencies. Only the reviewed registry packages
  `libc`, `serde`, `serde_json` are admitted. Path/git/workspace/custom-registry
  dependencies, explicit library/binary/example/test/bench targets, changed build
  roots and `build.rs` require review. A
  conservative textual guard rejects explicit `include!`, `include_str!`,
  `include_bytes!` and `#[path=…]` escape hatches in Engine production Rust. It is
  **not a Rust parser** and may flag comments. Ordinary Rust module resolution and
  type checking remain Cargo's job. This prevents Engine reaching product/GPUI
  dependencies; it cannot decide whether newly written self-contained Rust logic
  is consent policy. That remains a source-review responsibility.
- **Root product:** it is still monolithic, with GPUI and agent CLI code. New local
  Cargo dependencies may use only the existing Engine package. There is no claim
  that Desktop and Agent are independent or that current root internal calls use
  the future contracts. New packages fail closed until their real contracts have
  a reviewed rule. The manifest inventory includes the existing independent
  `tools/narrator` and `video` utilities, not fictional product packages.
  Root `workspace`, `patch` and `replace` tables fail closed pending explicit
  review: they can replace Engine's otherwise admitted registry dependencies.
- **Browser owners:** screen normalized relative string references in actual
  `site/src`, `site/src/hosted`, `connect/web/src` and `hosted/src` sources. Public
  cannot reference authenticated browser/backend owners; Connect cannot reference
  root Desktop/Engine implementation. Staged Connect browser sources cannot reach
  outside their package's source tree. Static imports, re-exports and literal
  dynamic imports using relative strings are covered. The exact current SSR edge
  `site/src/entry-server.tsx -> site/src/hosted/Hosted` is the sole reviewed
  migration baseline, with its reason in `scripts/architecture-baseline.json`.
  Missing, malformed, duplicated, widened or stale baseline entries fail. There is
  no blanket exemption for legacy site code.

The browser screen is a cheap **literal-reference tripwire**, not a TypeScript
parser, complete transitive graph or alias resolver. Computed imports, escaped
strings, aliases, indirect imports through scripts outside these source roots and
build-generated edges need the existing frontend checks and review. Comments can
trigger conservative false positives. Existing `site/scripts/test-hosted-browser.mjs`
checks the emitted Public/Connect resource closures and shared-runtime separation;
`connect/web/test/closure.test.mjs` checks the independent package's exact emitted
route/resource inventory. Those owning frontend gates remain authoritative. The
new fast check does not certify production browser adoption or emitted artifacts.

Configured paths must exist as regular tracked files. New/missing Cargo manifests,
invalid TOML/JSON and unreadable source fail rather than producing a partial pass.
Changing the migration baseline requires changing its pinned policy and fixtures
with review; changing JSON alone cannot silently grandfather a new dependency.

## Private paths and artifacts

Known credential path components (`.env` / `.env.*`, `.ssh`, `.aws`, `credentials`,
`credentials.json`, SSH identity names and `.pem` / `.key` / `.p12` / `.pfx` files)
are rejected by name **before their contents are read**, including diff output.
Keep examples that use these names out of tracked trees; use clearly synthetic
fixtures with noncredential names. This is not a secret-content scanner.

In the explicit publishable static roots (`site/public`, `site/dist`,
`site/dist-apparent`, `connect/web/public`, `connect/web/dist`), reject capture
bundle directories ending `.apparent` and the bundle artifact names `apparent.json`,
`contact-sheet.png`, `recording.mp4`, `recording.mov`, `audio.wav`. Reserved private
path components `pitch`, `pitch-deck` (also `pitch-deck.<extension>`) and
`private-captures` are prohibited there. These names follow the bundle contract and
existing frontend private-artifact checks; they are not a ban on generic image or
video assets. Synthetic `.apparent` fixtures elsewhere are allowed. Renamed private
files, arbitrary pitch names, untracked build outputs and image/audio contents are
not classified by this path policy. Privacy review and checked publication remain
required; a green hook is not permission to publish private material.

## Lightweight regression checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_git_policy.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_pre_push_guard.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_verification.py
```

Fixtures use disposable real Git repositories, index/immutable revision mutations,
partial staging, actual hooks and linked worktrees. Setup tests change only the
fixture's shared Git config. Push fixtures copy the helper closure and substitute
finite test/Cargo receipts, not real compiler/native proof. Parent verification
still owns the broad builds and platform acceptance.

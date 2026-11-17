# Staged dependency policy

The pre-commit hook runs directory-width first, then this checker. No CI or
pre-push invocation is installed. Set up once with Node 22.18+ and
`npm ci --ignore-scripts --prefix shared/enablement/dependency-policy`; use the
repository's existing hook installation. Commits only run installed tooling:
no install, network, native build or service. Missing Node/TypeScript fails the
hook; install the locked tool before committing. The hook/tool themselves are
trusted checkout tooling, like the existing width checker, not a security sandbox
against an author who edits/disables hooks.

`node --experimental-strip-types shared/enablement/dependency-policy/check.ts`
checks the index against HEAD. `npm test --prefix shared/enablement/dependency-policy`
runs isolated Git repositories through the real hook, preserving the width guard.

## Rules and ratchet

Desktop and Agent may use own code, Record public interfaces and Shared public
packages, never Engine or each other. Record may use own code, public Engine and
Shared, never other products or Composition. Engine includes both `engine/` and
legacy `capture/engine/`; it may use own code and Shared. Shared may use own code,
public Shared packages and declared externals. Connect, Public and Hermes may use
own code, Shared and externals, never other products, Record, Engine or Composition.
Composition may assemble public owner contracts. Same-owner internal imports are
allowed. Cross-owner imports require a public export even when layering permits
them. Imports into unowned repository paths are unsupported boundaries.

Each forbidden edge is keyed by importer path and resolved module path (or
workspace package/subpath for unbuilt exports), with its policy reason. The index
must introduce no edge absent from HEAD. Counts and owner pairs are insufficient;
a new importer, target swap or rename fails even if the total stays constant.
Existing violations remain debt without an exception file. Removal is allowed;
a later commit cannot reintroduce removed debt. New resolution/syntax/unsupported
form diagnostics are similarly ratcheted by file and diagnostic. The checker
never executes analyzed modules or writes/stages source.

Both complete snapshots come from Git trees and blobs, including manifests and
compiler configs, so partial staging and deletes work. Every owned source is
reanalyzed: changing staged configuration can redirect an unchanged importer.
An unborn HEAD is an empty baseline. An unmerged index fails closed. Renames
are deletion plus addition, not an exemption. Symlink source/config and owner
gitlinks are unsupported and ratcheted; their contents are never followed.

A normal commit compares with current HEAD. During `--amend`, HEAD is the commit
being replaced, so debt already in it is tolerated (not compared with HEAD's
parent). A resolved merge compares with first/current HEAD, not the union of
merge parents; incoming forbidden edges absent there fail. Hooks are not
universally run by all Git operations (including some sequencer/merge paths),
can be bypassed, and do not certify history or infer amend/rebase intent. Run the
checker explicitly when the committing client does not invoke pre-commit.

## Supported resolution and limits

TypeScript 5.9's AST parses tracked `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
`.mjs`, `.cjs` (including declarations). Literal import/export, type-only edges,
import types, import-equals, `require`, `require.resolve` and dynamic import are
covered. Non-literal calls receive diagnostics; indirect/eval/custom loader and
runtime-built dependencies are not a complete statically detectable graph.

The TypeScript resolver reads an in-memory Git filesystem, never candidate
worktree or installed node_modules. It uses the nearest ancestor `tsconfig.json`,
staged relative config extends, baseUrl/paths and standard TS extension resolution.
It does not infer separate bundler aliases, alternate `tsconfig.*.json` project
selection, package-manager links, custom resolver plugins or external config
packages: unresolved forms fail with the importer/specifier and a remediation.
Repository packages are discovered by staged package.json names. Exact/pattern
`exports` and condition alternatives define public contracts; package imports of
exported unbuilt dist paths need no build. Private package subpaths fail. Direct
relative/alias cross-owner imports must resolve to an actual export target;
source behind a dist export is not implicitly public. Prefer the package's
exported specifier. Packages lacking exports expose no cross-owner contract.
All export condition alternatives are considered public, not a promise that a
particular runtime condition loads. External bare packages require declaration
in the nearest manifest's dependencies/devDependencies/peerDependencies/
optionalDependencies; Node builtins are allowed. A resolved local path takes
precedence over external declarations.

This checks source module edges, not manifest-only dependency edges, Rust,
CSS/assets, build graphs, native linkage, shell invocations or runtime delivery.
Resource imports (CSS, common media/fonts, JSON) are outside coverage. Unowned
root/enablement sources are not checked as importers. Dependency/vendor/target
sources are excluded. This establishes a bounded ratchet, not full owner build
independence. Git plumbing/I/O failures reject; existing unsupported diagnostics
are debt rather than a claim that those files were analyzed completely.

## Frozen capture migration source

Canonical Desktop and Agent destinations are `desktop/` and `agent/`; their
`capture/desktop/` and `capture/agent/` paths remain legacy ownership aliases,
as does `capture/engine/` for Engine. Settings is assembled by Composition from
public section entrypoints owned by each stream. Streams own their section UI,
validation, persistence and effective-state behavior; Shared supplies reusable UI
and Desktop hosts the native window. Settings creates no sibling or
stream-to-Composition dependency exception, and no separate stream. Existing
`capture/desktop/settings/` remains a frozen donor.
The hook rejects every new index path under **all** `capture/`, regardless of
language, label or owner. Renames/copies into it are additions and fail; existing
path edits, deletions and moves out are permitted subject to the edge ratchet.
This includes frozen `capture/mod.rs` and `capture/ui_process.rs`. It does not
force relocation now, or detect semantic feature growth inside an existing file;
the AGENTS prose freeze still applies. An unborn repository cannot add capture
files. Amend/merge use the same HEAD comparison described above.

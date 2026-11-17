# Staged dependency policy

The pre-commit hook runs directory-width, then the preserved LOC rule, then this checker. No CI or
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

Canonical product roots: onboarding/, record/, handoff/, connect/, agent/; public/ and hermes/ remain unchanged. Supporting owners: engine/, shared/. Composition assembles public contracts/surfaces and injects narrow callbacks. Agent -> Record -> Engine -> Shared is the special public capability chain. Onboarding, Handoff, Connect, Public and Hermes may use own code, Shared public packages and declared externals only. No sibling implementation imports or stream -> Composition edges. Record owns React recording UI as well as headless APIs; there is no Desktop owner or desktop/ canonical root. Unknown legacy shell is classified Legacy with no new cross-owner edges. Same-owner internals are allowed. Cross-owner edges require public exports.

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

The canonical roots and responsibilities are declared in root AGENTS.md. snapshot.ts maps evidenced donor feature paths: onboarding/practice to Onboarding; pill, meter, captions, notes, whiteboard and storage to Record; destination picker/T3 delivery and clipboard to Handoff; connect settings/flow to Connect; capture/agent to Agent and capture/engine to Engine. Destination overrides precede the Record pill mapping. Mixed shell/hosting remains Legacy; this is migration debt with no-growth constraints, not a new product stream. Settings is assembled by Composition from owner public sections, including validation, persistence and effective state. Shared provides canonical controls.

The hook rejects every new index path under **all** `capture/`, regardless of
language, label or owner. Renames/copies into it are additions and fail; existing
path edits, deletions and moves out are permitted subject to the edge ratchet.
This includes frozen `capture/mod.rs` and `capture/ui_process.rs`. It does not
force relocation now, or detect semantic feature growth inside an existing file;
the AGENTS prose freeze still applies. An unborn repository cannot add capture
files. Amend/merge use the same HEAD comparison described above.

## Staged lexical comment ban

After width and dependency checks, the same pre-commit invocation compares
comments in changed regular staged blobs with HEAD. New files have no allowance.
Existing comments may stay or be removed; adding/changing comments, including
JSDoc, Rust/Swift docs and eslint/ts-ignore/source directives, rejects the commit.
Shebangs at offset zero are executable syntax, not comments. Literal text in
strings, regexes, templates, JSX text and fixtures is not a lexical comment.
Python docstrings are string expressions, not lexical comments.

Identity is exact parsed comment text (excluding its terminal line ending), with
multiplicity per file. Position and surrounding code are not identity: moving an
unchanged comment inside its file is allowed, duplicating it is not. Whitespace
inside the comment and directive text remain significant. A Git-detected 50%+
rename transfers the deleted source file's allowance once, only to a previously
absent destination; the source must disappear. No copies or retained sources
transfer allowance. A missed rename fails safely. Language-changing renames parse
both sides separately. Deletions need no parsing. Unchanged blobs need no parsing;
changed unsupported or invalid source fails closed, even with no comments. No
ratchet tolerates newly unsupported comment analysis. The introduction commit is
checked against the actual predecessor HEAD, including this checker and tests.

Pinned Tree-sitter WASM grammars cover TS/TSX/JS/JSX (and module variants), Rust,
Swift, Python, CSS, shell/bash, C/headers, Objective-C, C++, TOML, JSON/JSONC and
HTML without embedded script/style code. YAML uses the pinned yaml CST parser.
No native build, downloads or execution of analyzed code occurs during commit.
The Repomix grammar package supplies current main-language grammars; the older
upstream WASM pack supplies bash/TOML/Objective-C/HTML/JSON. Unsupported grammar
features reject changed files. HTML embedded code, SQL, Metal, XML/plists,
PowerShell, unknown extensions and extensionless code without a recognized shell, Python or Node shebang
currently reject edits until a pinned suitable parser is added. This is bounded
coverage, not a claim of universal parsing. Markdown/plain text, LICENSE/NOTICE,
explicit binary/media/font suffixes and lock data are non-code. There is no
blanket generated/vendor skip in this comment rule. Symlink/gitlink changes
reject; their targets are not read. The trusted hook/tooling limitations and
amend/merge semantics above also apply here. No CI or pre-push invocation exists.

Swift raw-string syntax is a known grammar limitation and rejects edits safely.
Hook activation must preserve the installed guards: see
[hook composition and LOC preservation](../../../enablement/directory-width/README.md#hook-activation-and-preservation).
The tracked hook now orders width, LOC, dependencies, then comments; prepared
composition first runs the preserved installed pre-commit. The old installed LOC
check and the repository LOC check may both run. This bounded duplicate check
preserves protection while portable new setups also receive the LOC guard.

Composition's public assembly permission does not grant Engine access: only
Record may import public Engine capabilities. Allowed edges are explicit and
acyclic across owners, not inferred from reachability or export availability.

# Staged commit policy

Install once with Node 22.18+ and `npm ci --ignore-scripts --prefix shared/enablement/dependency-policy`.
The tracked pre-commit pins one immutable tree for width and all staged checks. Commits run installed tools only:
no network, installs, native builds or services. No new CI or pre-push invocation exists.
The existing pre-push protection remains separate. Missing tooling rejects with installation guidance.
Run `npm test --prefix shared/enablement/dependency-policy` and
`node --experimental-strip-types --test enablement/hooks/test.ts` for synthetic tests.

The checker compares exact Git index blobs with HEAD, including manifests and compiler configs;
it never stages or changes source. Unborn HEAD means an empty baseline. Unmerged indexes reject.
Renames/copies are additions except the explicit comment allowance below. Amend compares with HEAD,
not its parent; merge compares with current/first HEAD. Hooks are bypassable trusted checkout tools,
not a security sandbox or universal history certification. Run `node --experimental-strip-types
shared/enablement/dependency-policy/check.ts` when the committing client skips pre-commit.

## Ownership and capture freeze

Canonical streams are onboarding/, record/, handoff/, connect/, agent/; public/ and hermes/ remain.
Supporting owners are engine/ and shared/; composition/ assembles public contracts. There is no Desktop
stream. Record includes recording UI. Agent -> Record -> Engine -> Shared is the special capability chain.
Other streams may use own code, Shared public packages and declared externals. Only Record imports
Engine capabilities; Composition cannot import Engine directly. Same-owner internals are allowed; cross-owner edges
require public exports and an explicit allowed edge. Engine cannot import products or Composition.

Each forbidden/unsupported dependency is keyed by importer, resolved target and reason. No new exact
edge may appear relative to HEAD, even if counts or owner pairs stay constant. Removed debt cannot
return. Changed staged configs reanalyze unchanged sources. No exception file disguises inherited debt.

TypeScript 5.9 parses TS/TSX/MTS/CTS and JS variants. Literal import/export, import types,
import-equals, require/require.resolve and dynamic imports are covered. Computed calls diagnose;
indirect/eval/custom loaders remain outside complete static detection. Resolution uses staged nearest
tsconfig.json, relative extends, paths/baseUrl and standard TS resolution, never installed node_modules.
Staged package names and exact/pattern exports (including null exclusions and condition alternatives)
define public contracts. Exported unbuilt dist specifiers need no build; private paths fail.
External packages require nearest-manifest dependency declarations; Node builtins pass.

Unresolved forms diagnose. Alternate tsconfig selection, bundler aliases, external config packages and
resolver plugins are unsupported. CSS/assets/JSON resource imports, manifest-only edges, native linkage,
build graphs and runtime delivery are outside graph coverage. Unowned root/enablement importers and
dependency/vendor/target sources are excluded. This ratchet does not prove owner build independence.

All new paths under capture/ reject, including copies and inbound relocations. Existing repairs,
deletions and moves out remain possible. snapshot.ts maps evidenced legacy onboarding, recording,
handoff, connect, agent and engine donors; unknown shell stays Legacy, not a new stream. This checks
path growth, not semantic feature expansion in an existing file. Width allowances stay exact and bounded.

## Markdown budgets

Authored repository Markdown additions must use exact canonical basenames AGENTS.md, README.md or
SKILL.md. Extension/name detection is case-insensitive, so `.MD` cannot evade policy; new spelling must
still be canonical. Limits are 2,000, 2,000 and 3,000 tokens respectively, using pinned js-tiktoken 1.0.21
with o200k_base. The entire exact staged text counts, including frontmatter and code. Special-token-like
text is ordinary text (`encode(raw, [], [])`). Existing oversized allowed-name files cannot grow beyond
their HEAD token count; existing other-named Markdown cannot grow at all. Removal or migration to a
canonical name within its cap is allowed. Rename/copy destinations inherit no debt. No documents are
automatically deleted. This repository hook does not govern external skill directories.
Source files have a 4,000-token cap with the same tokenizer and entire-file counting, including tests,
strings and comments. Existing oversized paths may shrink but not grow. Only exact-content R100 renames
with the source deleted and destination absent from HEAD carry debt once; copies/new paths cannot.
This includes moves out of capture/ without relaxing language destination or dependency policy.
TS/JS variants, Rust, Python, Swift, shell, CSS, HTML, C-family, Metal and recognized shebang source
are covered. Unknown .lock/.lockb text also receives the cap; arbitrary JSON/config/data is not code.
Exact dependency lock basenames Cargo.lock, package-lock.json, npm-shrinkwrap.json, bun.lock/bun.lockb,
yarn.lock, pnpm-lock.yaml, uv.lock and poetry.lock are exempt (also from Biome). Near matches are not.
The narrow dependency/cache and named generated-output inventories listed in the width guide stay
excluded from source budgets; tests/fixtures/generated-named folders have no blanket exemption.
Unknown languages remain a documented scope limit. There is no physical-line gate.

## Languages and staged style

TypeScript/TSX/MTS/CTS is the default. New Python is allowed only under hermes/; new Rust only under
engine/. New authored JS/JSX/MJS/CJS rejects. Existing files in these languages may be repaired;
renames/copies receive destination policy. New Swift, shell, C-family and extensionless shebang scripts
require an exact reviewed allowance (currently none). Existing native/tool scripts remain repairable.
Recognized JSON/YAML/TOML config/data and CSS/HTML remain valid formats. This is not permission to
move product behavior into Engine. Generated JS belongs ignored outside Git. Python/Node/shell shebangs
cannot bypass destination rules. Unknown languages without recognized suffix/shebang are not inferred;
the comment parser independently rejects unsupported changed source. This is not universal language detection.

Pinned Biome 2.6.8 checks changed regular TS/JS variants, CSS, JSON and JSONC staged blobs in private
isolated scratch, with explicit config and no candidate project execution. Standard formatting is required
for new files and files whose HEAD passed formatting. Already-unformatted existing files retain formatting
debt; this does not claim formatting enforcement on their edited lines. Error-level lint is a per-file,
category/message/source-line identity ratchet: no increase over HEAD. Moving identical offending lines is tolerated.
Pinned syntactic rules cover unreachable code, invalid super constructors, duplicate parameters,
unsafe equality, focused tests, duplicate branches and explicit any. New files have zero allowance. Syntax errors always reject. Candidate and baseline blobs run in one Biome batch. Oversized/skipped/incomplete
Biome results fail closed. Warnings are informational. Unrelated legacy files are not checked.
There is no Rust/Swift/Python/shell/native-language style or lint coverage yet; owning tools must be
provisioned before claiming it. Comment parsing is not a substitute for those checks.

## Lexical comments

Changed code cannot add/change lexical comments, including documentation and lint/type directives.
Existing exact comment text and multiplicity may remain or shrink. Position does not establish identity;
duplicating or changing whitespace inside a comment fails. Shebangs at offset zero are executable syntax.
Strings, regexes, templates, JSX text and Python docstrings are not lexical comments.
A Git-detected 50%+ rename transfers deleted-source comment allowance once to a previously absent
path; copies do not. Both languages parse separately on language-changing renames. Missed renames fail
safely. Changed invalid/unsupported syntax and nonregular files reject; symlink targets are never read.

Pinned Tree-sitter WASM (including tree-sitter-bash 0.25.1 for the current runtime ABI) covers TS/JS variants, Rust, Swift, Python, CSS, shell, C/headers, Objective-C,
C++, TOML, JSON/JSONC and HTML without embedded code. YAML uses its pinned CST parser. Swift raw
strings, embedded HTML scripts/styles and unknown source formats currently fail safely. Markdown,
plain text, LICENSE/NOTICE, listed binary/media/font suffixes and lock data are non-code; there is no
blanket generated/vendor comment skip. See comments.ts for exact grammar/suffix mappings.

`.gitignore` recognizes column-zero `#` comments, with Git's BOM/CRLF handling; escaped and inline hashes are patterns.

For safe setup and verified legacy LOC retirement, see
[hook preparation](../../../enablement/directory-width/README.md#hook-activation-and-preservation).

Additional execution-context, React effect, secrets and CI admission contracts and limitations are in
[runtime safeguards](runtime/README.md); [owner fast checks](fast/README.md) describes provisioned
typechecking, typed promise lint, focused tests and immutable source/tool validation.

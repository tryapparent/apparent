# Additional staged safeguards

All admission runs in pre-commit, never CI or pre-push. Install the pinned dependency-policy
package before committing. No hook installs packages or changes live hook configuration.

Execution analysis reuses staged TypeScript resolution and follows imports/reexports transitively.
Renderer roots are the legacy frontend `src`, Shared UI `src`, Connect web `src`, and canonical `renderer`
directories. Privileged roots are legacy Electron and nested main/preload/native directories.
Pure roots are canonical `pure`, the exact Record completion policy, and the four
previously inventoried onboarding policy files. Tests and arbitrary `core` directories are not
implicitly pure. Renderer cannot reach Node builtins/Electron/privileged implementations; pure
code also cannot reach React or renderer implementations. Plain data/callback bridge contracts
remain usable. Symbol-aware source references also inventory TypeScript DOM declarations and
privileged Node globals, including indirect helper reachability. Local declarations are allowed.
Computed global access, reflective loaders, runtime permissions and undeclared execution contexts
require separate verification; this is not a sandbox.

React effect provenance uses the TypeScript symbol graph, including aliased imports, namespace
and default access, literal brackets, variable/destructured aliases and named reexports. Passing
an effect reference as an argument also counts.
Each source statement and path has its own multiplicity allowance from HEAD. Moving to another
path, changing a statement or adding another occurrence cannot borrow repository-wide debt.
There is no framework exemption or owner-enablement path exemption. Computed property
names and reflective assignment are not complete JavaScript dataflow analysis. Prefer events,
derived state or an explicitly designed lifecycle adapter; timers are not a prescribed workaround.

Biome additionally rejects focused tests, duplicate case/else-if branches and explicit `any`.
Lint debt includes diagnostic source-line identity; equal totals cannot substitute different
violations. Syntactic lint is distinct from typed promise checks: pinned ESLint/typescript-eslint
checks floating and misused promises only in provisioned fast projects using their real staged
TypeScript configuration. These are not claims of whole-repository type safety.

Secrets scan changed staged blobs, including dependency locks, before source diagnostics. Supported
formats are PEM private-key headers, GitHub tokens, AWS access-key IDs and Slack tokens. Values
and paths are withheld; diagnostics identify a SHA-256 path prefix. Existing exact values have
per-path multiplicity debt; copies receive no allowance. This deterministic format scanner does
not detect arbitrary passwords, entropy or private prose. Synthetic tests build token-shaped
values at runtime and assert redaction.

CI checks provider workflow run commands and npm run scripts, canonical stream entrypoint homes,
stream-private transitive TypeScript imports and blanket workflow filters. Changed noncanonical
entrypoint contents cannot borrow unchanged path debt. Dynamic command substitution/eval rejects
new occurrences. Static shell command recognition is deliberately limited; runtime-generated
commands and shell working-directory changes are not fully resolved. New/changed local custom
action execution rejects as unsupported; literal step working directories resolve statically.
Placement alone does not establish correct workflow triggers or owner build independence.
Existing workflow permissions, identities, gates and provider entrypoints are unchanged.

The hook batches Biome candidate/baseline blobs and validates the installed tool closure against
the staged lock. The hook pins one staged tree, isolates width's Git index, and checks the caller's index again
before accepting. Tests run from raw blobs of that tree, with Git and Node runner environment
state removed. Timing is printed per phase. Hook tools themselves remain trusted checkout code.

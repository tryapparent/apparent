# Owner fast checks

Owner declarations live at `<owner>/enablement/ci/fast.json`:
`projects: [{root, inputs, tests, typecheck}]`. Roots and additional inputs are repository-relative;
test paths are project-relative. Declarations cannot assign another owner's project. Changes
under a project select it; explicit inputs include manifests and dynamic data. Changed tests
remain eligible. Reverse import consumers are included. Unknown inputs conservatively select every declared project.
This is a bounded local executor, not a replacement for the existing CI/push selector.

Record completion and capture-request are provisioned for typechecking, typed promise lint and
focused tests. Shared guard tests are provisioned without a whole-package typecheck. Other owners
have no fast typecheck claim; existing native/browser/delivery gates remain necessary. A repository
without declarations reports that only staged syntax/graph checks apply. README-only prospective
streams acquire no invented passing test job.

The executor materializes raw Git blobs from the immutable staged tree into a private temporary directory and uses the
installed guard toolchain, including Node types. It never edits source or the caller index. Git
variables and nested Node test-runner state are removed from child environments. Missing tools,
empty typed lint results, errors, signals and 120-second child timeouts reject. Owner tests must
remain cheap, offline and service-free; declarations are trusted reviewed executable policy.
No installation, browser or native build is part of this executor. Installed package versions and
lock integrity metadata must match the staged tool lock. Symlinks/gitlinks are not materialized;
selected tests must be regular staged files. Unknown inputs use the conservative all-declared-project
fallback. Transitive static imports are followed; runtime-generated dependencies need explicit inputs.

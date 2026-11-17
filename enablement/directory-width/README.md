# Staged directory-width guard

`.githooks/pre-commit` runs `check.py` against the Git index tree (`git write-tree`), never mutable worktree contents. Eligibility is by first-party tree scope, not filename suffix: every tracked blob outside the narrow dependency/cache and named generated-output exclusions below makes its containing directory and ancestors eligible. Thus extensionless and uncommon-suffix source files, docs, and assets in first-party directories cannot evade the guard by naming alone. It checks changed eligible directories and directories whose immediate entries changed, including the repository root when a top-level entry changes. Editing any immediate first-party root file also checks root width. Ordinary nested edits do not police unrelated over-width ancestors. Files and subdirectories have independent limits of 10. Symlinks count as files and gitlinks as directory entries; neither is followed.

Only dependency/cache trees (`target`, `node_modules`, `vendor`, `third_party`, `third-party`, `.git`, `__pycache__`) and specifically generated roots `public/site/published-homepage`, `public/site/video-demo/output`, `connect/web/dist`, and `connect/web/dist-site-check` are excluded. `public/site/public` is not excluded: tracked feature-demo HTML there is first-party code. Generic `src`, `shared`, library, test, `dist`, and generated-named directories receive no blanket exemption. On violation, split changes by responsibility and stage only the intended changes; the hook never edits or stages files. Git/plumbing failures reject the commit.

At root, `.cargo`, `.githooks` and `.github` are the three bounded tool-directory
exceptions. Root permits ten ordinary directories plus
those exact tool directories; all remain visible in the actual count. Their
contents retain ordinary limits except `.github/workflows`: GitHub requires
immediate workflow files, so regular `hermes.yml` gets one named extra slot
(maximum 11 files, still 10 directories). Counts remain visible; a twelfth file
or a symlink/gitlink substitute receives no additional allowance.
Other hidden directories and owner roots (including `record` and `onboarding`)
count normally. A symlink remains a file; a gitlink remains an ordinary directory
and grants no tool allowance. Counts come only from actual staged Git trees, and
root checks print total, tool and ordinary counts even on success.
Root files still have a separate limit of ten. This changes no
build, native acceptance, verification selector or release gate.

Run focused integration coverage with:

```sh
python3 -m unittest discover -s enablement/directory-width/tests -v
```

Canonical outcome roots require two additional, named root directory admissions:
`agent` and `handoff`. Each grants one extra root directory slot only when it is
an actual staged directory. `onboarding` uses an ordinary slot. No other name,
symlink or gitlink grants these slots; root files and all nested limits remain
unchanged. This admits the twelve current/planned ordinary roots alongside the
three existing tool roots without permitting arbitrary further root growth.

## Hook activation and preservation

The tracked pre-commit runs width, the staged 2,000-physical-line guard, then
owner dependencies and lexical comments. The LOC implementation in
`enablement/hooks/lines.ts` preserves the discovered installed guard's contract:
added/modified regular staged blobs, no rename detection, NUL within the first
8,000 bytes means binary, and only exact root `Cargo.lock` is exempt. Newline
termination, blank lines and comments count. This does not introduce a language
matrix or Markdown token budgets.

**Tracked hook tests are not activation proof.** The current configured hook may
be an unrelated standalone guard. Do not replace it with `core.hooksPath=.githooks`
and lose existing protection. `node --experimental-strip-types
enablement/hooks/prepare.ts --output /absolute/new/private/hook-directory`
prepares a candidate only, without changing configuration. It copies every active
regular hook (including pre-push byte-for-byte), preserves modes, and wraps the
old pre-commit before the tracked pre-commit. Any existing style/lint guards
therefore run before the new guards; no such guards were found in the inspected
installed hook, only LOC. Symlink/non-regular entries fail for manual review.

Use a private per-job /tmp path for review/testing. Parent-coordinated activation
must prepare a fresh durable candidate inside the repository's Git metadata,
review the reported configuration origin and all preserved hooks, check the
composed candidate with representative staged changes, then set the appropriate
repository/worktree-local hooksPath to that absolute candidate. Keep the previous
value and scope for rollback. Never activate a disposable /tmp path, overwrite a
shared hook directory, change global configuration or activate during another
writer's commit/push. The prepare command does none of these activation steps.
It intentionally preserves the installed pre-push contract, not the different
tracked pre-push selector. There is no new CI or pre-push checker invocation.

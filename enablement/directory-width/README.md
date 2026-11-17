# Staged directory-width guard

`.githooks/pre-commit` runs `check.py` against the Git index tree (`git write-tree`), never mutable worktree contents. Eligibility is by first-party tree scope, not filename suffix: every tracked blob outside the narrow dependency/cache and named generated-output exclusions below makes its containing directory and ancestors eligible. Thus extensionless and uncommon-suffix source files, docs, and assets in first-party directories cannot evade the guard by naming alone. It checks changed eligible directories and directories whose immediate entries changed, including the repository root when a top-level entry changes. Editing any immediate first-party root file also checks root width. Ordinary nested edits do not police unrelated over-width ancestors. Files and subdirectories have independent limits of 10. Symlinks count as files and gitlinks as directory entries; neither is followed.

Only dependency/cache trees (`target`, `node_modules`, `vendor`, `third_party`, `third-party`, `.git`, `__pycache__`) and specifically generated roots `public/site/published-homepage`, `public/site/video-demo/output`, `connect/web/dist`, and `connect/web/dist-site-check` are excluded. `public/site/public` is not excluded: tracked feature-demo HTML there is first-party code. Generic `src`, `shared`, library, test, `dist`, and generated-named directories receive no blanket exemption. On violation, split changes by responsibility and stage only the intended changes; the hook never edits or stages files. Git/plumbing failures reject the commit.

At root, `.cargo`, `.githooks` and `.github` are the three bounded tool-directory
exceptions. Root permits ten ordinary directories plus
those exact tool directories; all remain visible in the actual count. Their
contents retain ordinary limits except the immediate `.github/workflows` directory,
which the width guard skips because GitHub requires workflow files there. Its
children and other GitHub directories keep the ordinary limits. Workflow ownership
and admission checks still apply.
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

The tracked pre-commit runs width, owner dependencies, Markdown tokens, language,
staged Biome style/lint and lexical comments. The old 2,000-line gate is retired.
Source code has a staged 4,000-token cap and inherited no-growth debt. Pre-push
validates issue references before running affected verification.

Run `node --experimental-strip-types enablement/hooks/prepare.ts --output
/absolute/new/private/hook-directory` to prepare a candidate without changing
configuration. It copies all active regular hooks and modes, including pre-push
byte-for-byte, and wraps the old pre-commit before the tracked hook. Nonregular
entries reject for manual review; existing output directories are never overwritten.

Optional `--retire-verified-line-guard` omits only the byte-verified standalone
Python LOC pre-commit (SHA-256
`170a84654e64035afc5cafffa8a2387c6814f4c4315cc2250ae15e9333d664ed`).
It retains its exact bytes/mode as preserved-pre-commit and records source,
configuration origin, fingerprint and retirement in provenance.json. A missing,
customized or unknown guard rejects this option; unrelated hooks remain active.
Without the option every existing pre-commit remains active, including LOC.

Use private per-job /tmp output for review/testing only. Parent-coordinated durable
activation must prepare a fresh candidate inside Git metadata, review provenance
and all hooks, and exercise representative staged changes before selecting it.
Prefer worktree-local core.hooksPath after reviewing whether extensions.worktreeConfig
is enabled and safe; enabling it affects repository config interpretation and must
be coordinated. Do not silently fall back to shared local/global config. Preserve
the previous value/scope (or absence) for rollback. Never activate a /tmp path,
overwrite shared hooks or switch during another writer's commit/push. Preparation
performs none of these activation steps. Tests are not live activation proof.

Optional `--retire-verified-cargo-push` backs up and replaces only the exact
obsolete unconditional Cargo hook (SHA-256
`8ba11032d420497f232f1096b6b8e52356abf5be264e7c18610eba888f95e920`).
Its replacement directly invokes the tracked pre-push selector; it never chains
the obsolete hook. Custom pre-push hooks retain their bytes and modes. Preparation
also composes issue autofill/validation message hooks; see
[issue binding](../../shared/enablement/issues/README.md).

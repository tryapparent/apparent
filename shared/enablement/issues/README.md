# Issue traceability

Each new commit needs exactly one primary final Git trailer in this form.

```text
Issue: tryapparent/apparent#123
```

The key is case-insensitive. The value must match the anchored owner/repository
and positive-integer syntax, with the repository exactly `tryapparent/apparent`
(case-insensitive input is normalized). Subject lines, quoted examples and body
paragraphs are excluded. Duplicate/conflicting trailers, continuations, wrong
repositories, zero/negative IDs and trailing prose are rejected. Syntax validation
does not establish that a GitHub issue exists.

Bind the current worktree to an existing issue before committing.

```sh
node --experimental-strip-types shared/enablement/issues/run.ts bind tryapparent/apparent#123
```

The CLI uses authenticated `gh api --hostname github.com` to read the issue.
It validates canonical repository/issue identity and rejects pull-request numbers.
It writes only repository, issue number/ID, host, schema and validation time to
`apparent-issue.json` in this worktree's Git administrative directory, with mode
0600. It preserves the branch name, index, common config and other worktrees.
No credentials or issue bodies are cached. Missing/invalid bindings print the
binding command. Local account control of this metadata is trusted.

With `core.hooksPath=.githooks`, the tracked `prepare-commit-msg` hook fills a
missing trailer from that binding.
A valid explicit trailer is preserved. `commit-msg` requires the final trailer
to match the API-validated binding. Bind another issue explicitly when changing
workstream. Commit hooks use the cached validation and require no network.
Previously validated existence is a historical observation, with no freshness
claim at commit time. Custom message hooks run first with their original arguments;
our validation then sees their final message. Preparation backs up custom hooks
and changes no live configuration. Parent integration owns activation for
custom hook paths.

Before expensive verification, pre-push authenticates the live
`refs/heads/main` of `tryapparent/apparent` once. It checks the union of commits
reachable from every non-deletion pushed ref, excluding ancestry reachable from
that exact main SHA. An inherited commit cannot block an unrelated push because
its trailer is missing or invalid. Every commit outside canonical main is
checked, even if it was previously pushed to a feature branch or introduced
through a merge. The hook requires every non-deletion pushed ref to equal
checked-out HEAD. Deletion-only pushes perform no GitHub requests.

Canonical main must descend from the fixed issue checkpoint
`8bd1c2669a62c41014791a6dd3e85da809f4d446`, which descends from the integration
baseline `d559dbbd2a3fbf9428593931b526e13b626c8ab9`. Git replace refs and grafts
are ignored. If local objects prevent that proof, the hook tries one fetch of the
authenticated SHA from canonical GitHub with a 60-second timeout and repeats the
proof against the same SHA. The fetch leaves the checkout, index, refs and
`FETCH_HEAD` untouched. Shallow history and inaccessible required objects block
admission. A main rewrite that removes the checkpoint requires a reviewed replacement.

Each distinct issue referenced by the checked commits gets one fresh API read per
push. Commits inherited from main trigger no issue reads. The push uses no local
validation cache. Each read has a 20-second process timeout and a bounded response.
Authentication, network, not-found, identity and PR-number failures reject the
push. Issue state may be open or closed. Successful lookup does not authorize
closing an issue. API stderr and response bodies are omitted from hook diagnostics.

A two-parent GitHub-generated merge outside main may omit its own trailer after
authenticated verification of the exact commit, its parents and GitHub's valid
web-flow signature. The hook still checks both sides for commits outside main.
Squash commits have one parent and need a trailer. Review the commit messages
that will land when integrating, and record verified historical associations
separately from push admission.

Previously verified historical associations are recorded here for reference.

| Landed commit | PR | Issue |
| --- | --- | --- |
| `6c64c838fab1b70e05da112ffc25336e5c283ab1` | #1437 | #575 |
| `18c72f8302d54bab24d1729fb75796329a2a0a81` | #1436 | #171 |
| `f52fab25ee734cb60262387d0c74e8cdfba97d6a` | #1451 | #530 |
| `f900c3f4677cca561f1336d4cd4b64184032958e` | #1489 | #837 |
| `91fe2c80dd96cea8bb3285d2c6f1d1b4652bd76b` | #1494 | #1240 |

[PR #1515](https://github.com/tryapparent/apparent/pull/1515) landed the release
commit `c2a3b6043389a4e825eaae06e2d1c0b732faf0b5` without a trailer or a linked issue.

The PR description should reference the same primary issue. Use `Closes` only
when the entire issue outcome is complete. Ordinary commit `Issue` trailers do
not close issues. A PR is unnecessary for the first branch push. This feature
creates no issues, comments, labels, dashboards or project automation.

For authentication diagnosis, use `gh auth status --hostname github.com` before
retrying the binding command. The tracked and prepared message hooks delegate
to the same TypeScript implementation. The staged language guard pins the two
Git-required extensionless entrypoints by exact path, executable mode and digest.

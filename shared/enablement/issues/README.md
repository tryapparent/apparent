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

The prepared `prepare-commit-msg` hook fills a missing trailer from that binding.
A valid explicit trailer is preserved. `commit-msg` requires the final trailer
to match the API-validated binding. Bind another issue explicitly when changing
workstream. Commit hooks use the cached validation and require no network.
Previously validated existence is a historical observation, with no freshness
claim at commit time. Custom message hooks run first with their original arguments;
our validation then sees their final message. Preparation backs up custom hooks
and changes no live configuration. Parent integration owns activation.

Before expensive verification, pre-push enumerates the union of all commits
reachable from every non-deletion pushed ref, excluding ancestry reachable from
the fixed integration baseline `d559dbbd2a3fbf9428593931b526e13b626c8ab9`.
That baseline and all its ancestors are grandfathered. No last-push timestamp or
remote-tip exclusion can hide an unvalidated feature commit. Merge commits,
rebased commits and commits introduced from side branches receive the same rule.
The existing hook still requires every non-deletion pushed ref to equal checked-out
HEAD. Deletion-only pushes perform no issue lookup. Unknown/missing baseline or
shallow history fails with an actionable prerequisite instead of silently skipping.
Old history outside the baseline's ancestry receives validation too.

Two immutable accepted main merges omitted their trailers: `6c64c838fab1b70e05da112ffc25336e5c283ab1`
(PR #1437, issue #575) and `18c72f8302d54bab24d1729fb75796329a2a0a81` (PR #1436, issue #171).
`acceptedMergeIssue` records only those exact commit-to-issue associations, recovered from their product commits.
Their issues still receive fresh API validation. This does not advance the baseline, exempt their ancestors,
accept copied merge messages, or infer issues for future merges. Include the Issue trailer when merging future PRs.

Every selected commit's trailer is validated, then each distinct referenced issue
is fetched once per push invocation. Each read has a 20-second process timeout
and a bounded response, with no retries or stale-cache fallback. Authentication,
network, not-found, identity and PR-number failures reject the push. Issue state
may be open or closed. Successful lookup does not authorize closing an issue.
API stderr and response bodies are omitted from hook diagnostics.

Rollout is prepared until parent integration binds an issue and activates the
reviewed hooks. Existing post-baseline commits without trailers need a deliberate
integration decision before activation. This tool never rewrites others' commits
or expands grandfathered history automatically. Review merge/squash commit messages
for the same trailer when integrating.

The PR description should reference the same primary issue. Use `Closes` only
when the entire issue outcome is complete. Ordinary commit `Issue` trailers do
not close issues. A PR is unnecessary for the first branch push. This feature
creates no issues, comments, labels, dashboards or project automation.

For authentication diagnosis, use `gh auth status --hostname github.com` before
retrying the binding command. The generated message hooks live in the prepared
hook directory and delegate to the tracked TypeScript implementation. They add
no tracked extensionless shell paths requiring a language-policy exception.

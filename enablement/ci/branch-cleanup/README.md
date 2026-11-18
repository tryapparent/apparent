# Closed PR branch cleanup

GitHub deletes head branches after merge. `branch-cleanup.yml` handles PRs
closed without merging in `tryapparent/apparent`. Apply `keep-branch` before
closing if the branch is still needed. Cleanup protects release, preview and
migration branches, and skips forks, protected branches, branches used by open
PRs, and branches whose tips differ from the closed PR head.

GitHub's PR ref retains the deleted tip. Use the PR's **Restore branch** button
if you need to reopen it. Disabling this workflow stops cleanup for future
unmerged closures.

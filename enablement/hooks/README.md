# Codex Stop hook for Make It Apparent

Install a reviewed copy of `make-it-apparent-stop.ts` in the Codex user profile.
In that profile's `hooks.json`, register a synchronous `Stop` command that runs
`node --experimental-strip-types /absolute/path/to/installed-hook.ts /absolute/path/to/apparent/.git`.
Use the output of `git rev-parse --path-format=absolute --git-common-dir` in an
Apparent checkout for the final argument. This scopes the hook to that clone
and its linked worktrees. Use `/hooks` to review and trust the command.

## Video handoff

For a completed implementation, gather evidence while working and run
[Make It Apparent](../../agent/skills/make-it-apparent/SKILL.md) before the
final reply. Start that reply with `Implementation complete.` on its own
line. Include a line beginning `Make It Apparent video:` with the verified
playable artifact or `Make It Apparent blocker:` with the concrete production
blocker. Follow explicit requests to skip video. Omit the completion line
for those requests, discussion, pauses and required CI-watch yields.

When a marked handoff omits both the video and blocker lines, Codex gets one
continuation prompt to run the repository skill. The agent applies the skill's
evidence and delivery checks. The hook reads only the Stop event through stdin.

## Verification

Run the command checks from the repository root with
`node --experimental-strip-types --test enablement/hooks/make-it-apparent-stop.test.ts`.
They exercise the command from a subdirectory. Hook discovery,
trust and actual continuation in a client require a client-level check.

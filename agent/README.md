# Agent

Own interpretation, inspection and extraction of recordings. Use Record public capabilities, never Engine directly. Shared public packages and declared externals are allowed. Frozen capture/agent remains a migration donor; migrate bounded real callers and tests together.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

Install the [capture-reading skill](skills/apparent/SKILL.md) or the
[video-proof skill](skills/make-it-apparent/SKILL.md) from `agent/skills/`.
Older install URLs forward to these guides.

## Report feedback from the CLI

Use `apparent feedback --help` for a copyable example. CLI argument errors and failed `inspect`, `fetch`, `frames` and `zoom` commands point to it after the original error. Send sanitized `apparent feedback` for even minor friction or workarounds, then continue the task.

```sh
apparent feedback --kind bug --title 'Zoom rejects minutes and seconds' --body 'A timestamp of 1:05 should select 65 seconds.'
```

Send in one call with `--submit` when ready to share with Apparent. Omit `--submit` for an optional local JSON preview, as in the example above. Use `--kind bug` for a defect. The default `--kind feedback` covers suggestions and other feedback. Titles allow up to 160 characters and bodies up to 8 KiB of UTF-8.

The command sends the supplied title and body with the report category, build and platform. Keep credentials and private capture content out of the text. The command does not read recordings or attach logs. Submission uses the publishable PostHog token in packaged builds. The command uses the bundled runtime or Node.js 22.23+ on PATH.

In PostHog Error Tracking, the issue title is the submitted CLI feedback title. Filter exception events by `source = agent_cli_feedback` and `feedback_kind`. The event properties `feedback_title` and `feedback_body` contain the exact text. The CLI returns the event UUID as `report_id` after PostHog acknowledges ingestion. Matching category, title and body group together. A new group enters the existing T3 fix queue.

## Zoom planning

The packaged CLI resolves clock literals and mark IDs, then calls Agent's staged
zoom worker to match narration and select the window, cell times and nearest
crop keyframes. The worker receives text over private stdin. Agent builds the
policy declared in `enablement/ci/bend/modules.json`. Record's explicit-frame
adapter decodes the requested bundle times. The native sheet renderer applies
the existing mark overrides and overlays, writes the PNG and prints its path.

Run `node agent/enablement/ci/bend/check.ts` for the standalone policy and worker
checks. Revert the CLI bridge, owner policy and staging change together to roll
back. Remove the bridge when a successor handles the packaged zoom caller and
passes the same synthetic recording checks.

## Speaking-style examples

Enable **Match my speaking style** in Settings → Labs to request examples for newly queued private, encrypted Connect recordings. It defaults off. The `labs.speakingStyle` preference applies to the next upload admission. Existing `experiments.speakingStyle` values remain readable. Turning it off affects future uploads. Earlier opted-in recordings retain their request until they expire or are deleted.

Ordinary inspection of an opted-in capture includes a command hint. Run `apparent inspect <connect-id> --style-examples` with the same reader to retrieve up to 1,024 cl100k_base tokens from the 12 most recently reserved eligible recordings before that capture. Only encrypted v2 metadata is selected. Empty transcripts and copies of the current recording contribute no text. The fetch ends at the token budget or the end of that list. A share link alone cannot retrieve examples.

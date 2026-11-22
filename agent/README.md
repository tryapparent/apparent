# Agent

Own interpretation, inspection and extraction of recordings. Use Record public capabilities, never Engine directly. Shared public packages and declared externals are allowed. Frozen capture/agent remains a migration donor; migrate bounded real callers and tests together.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

## Report feedback from the CLI

Use `apparent feedback --help` for a copyable example. CLI argument errors and failed `inspect`, `fetch`, `frames` and `zoom` commands point to it after the original error. Draft `apparent feedback` for even minor friction or workarounds, continue the task, and ask once at handoff before sending the sanitized drafts.

```sh
apparent feedback --kind bug --title 'Zoom rejects minutes and seconds' --body 'A timestamp of 1:05 should select 65 seconds.'
```

Send in one call with `--submit` when ready to share with Apparent. If you're sending on someone's behalf, show them the exact title and body in the conversation and get their approval. Omit `--submit` for an optional local JSON preview, as in the example above. Use `--kind bug` for a defect. The default `--kind feedback` covers suggestions and other feedback. Titles allow up to 160 characters and bodies up to 8 KiB of UTF-8.

The command sends the supplied title and body with the report category, build and platform. Keep credentials and private capture content out of the text. The command does not read recordings or attach logs. Submission uses the publishable PostHog token in packaged builds. The command uses the bundled runtime or Node.js 22.23+ on PATH.

In PostHog Error Tracking, look for **Apparent CLI bug report** or **Apparent CLI feedback**. Filter exception events by `source = agent_cli_feedback` and `feedback_kind`. The event properties `feedback_title` and `feedback_body` contain the exact text. The CLI returns the event UUID as `report_id` after PostHog acknowledges ingestion. Matching category, title and body group together. A new group enters the existing T3 fix queue.

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

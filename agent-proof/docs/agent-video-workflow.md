# Agent video workflow

Use this with [Make It Apparent](../../skills/make-it-apparent/SKILL.md) when an agent needs real desktop proof. The CLI controls a running GUI through its normal interaction-aware capture path; it is not a separate recorder or portable VM harness. Check installed help: older builds lack `capture start` and `stop --wait`. Read the host's capture safety rules first. Keep recordings, private paths, logs and QA outside git and public assets.

## Prepare and claim only your own take

1. Record the exact build, OS, running executable and installed CLI capabilities in a private evidence directory. Check installed help before choosing a command. Experimental walkthrough tooling in another branch is not a shipped prerequisite.
2. Choose one visible claim and rehearse it on a safe capture surface. Hide unrelated material before recording; post-production cropping cannot remove secrets from the retained raw movie.
3. Set a startup deadline and a separate finalization deadline before running the driver. Poll with a bounded interval, recording the last response and elapsed time. On timeout, stop the driver and report the phase; do not toggle recording or cancel an unknown capture to recover.
4. Read `apparent capture state` to understand the running app. A socket pathname is not readiness. Do not toggle a shortcut or cancel an existing capture to obtain an idle app.
5. Run `apparent capture start --wait --timeout 30`. Retain the top-level `capture_id` from its JSON reply, including a failed or timed-out reply. Success requires `status == "recording"`: a real screen frame has arrived. `starting` is not recording; portal consent may still be needed. Keep JSON stdout separate from stderr and reject failed, malformed or incomplete responses. Admission runs on the GUI thread and refuses a recording, pending chooser, picker, preview or processing job atomically.

The start reply identifies that request; a later global state read does not establish ownership. For crash-safe driver retries, generate and privately retain a 32-hex-character request ID before sending, then use `capture start --request-id <id> --wait --timeout 30`. Retrying that ID returns its existing receipt, never a second recording. Rejected IDs stay rejected; deliberately choose a new ID for a new attempt. Use an isolated app/session for unattended trials: CLI identity does not reserve the physical desktop from human input.

An admission request queued too long expires and cannot start later. If admission succeeded but readiness times out, the owned capture remains intact. Use `capture inspect <id>`, retry the same request ID, or deliberately `capture cancel <id>`; do not send a new start just because a reply was lost. Receipts last only for that GUI process, not across an app restart.

## Drive a settled UI

Wait for the target window's bounds to remain unchanged across several observations before deriving gesture coordinates. Measure against the actual window and display, not a fixed desktop size. Recheck after layout changes, scrolling or reopening. Confirm that a drawn mark or clicked result is visible before moving to the next beat. Input acceptance alone does not establish that the intended control was hit.

Keep the result visible for a planned readable hold. For persistence proof, show the original mark, close/reopen, and verify the same mark. Keep an independent state or artifact assertion when the movie alone cannot establish the result.

## Finish once, then verify

For ordinary agent-authored videos, use `apparent capture stop <owned_id> --wait --timeout 60` instead of whole-screen OCR for Finish. A visible Finish click is necessary only when that control is the subject of the test.

The stop command checks the ID at the action, so a newer capture cannot be stopped by a stale ID. Stop while `starting` fails with `not_ready` without saving or cancelling it. Do not use a shortcut as an automatic retry: a toggle could start or stop a different take.

Without `--wait`, `outcome == "stopping"` still means acceptance, **not** a saved bundle. With `--wait`, success requires `status == "saved"` and the exact `bundle_path` published by that capture's successful finalizer. The CLI polls only this ID, not global completion or directory contents. Inspect the returned bundle's manifest, summary, frames and nonempty decodable recording against the claim; successful storage does not certify the video's content.

If GUI Finish already ended the take, `capture inspect <id>` or repeating `stop <id> --wait` recovers its result without another stop. A retained result stays addressable after a new recording starts. Unknown, cancelled, failed, wrong-ID and timeout results are not saved success. After timeout or disconnect, inspect the same ID or retry Stop with that ID. Never guess `latest` or scan for another bundle to turn a failed wait into success.

A self-recorded movie ends at the actual stop. Verify saved-state aftermath separately. Do not append a completion still and claim the source movie showed it.

## Inspect the actual deliverable

Read `summary.md` and `apparent.json`, inspect `contact-sheet.png` and relevant full frames, and inspect the complete source movie. Render the share copy separately. Probe rate/duration and inspect the entire final movie, including every caption boundary, readable holds and the ending disclosure.

Record the final movie's SHA-256 alongside its QA grids and cue-boundary frames. Regenerate QA after every edit and require its recorded hash to match the delivered file. If an old grid contradicts the movie, inspect decoded frames from the final file before diagnosing a defect. Hash agreement identifies the bytes; it does not certify the claims or privacy.

Disclose CLI stop rather than a visible Finish click, injected input where used, exact build/platform, and audio limits. A caption-only take is not microphone or generated-speech proof. Verify playable delivery in the intended conversation; a remote filesystem path alone is not delivery. Public footage needs separate authorization.

## Compare trials without inventing a benchmark

Keep a private ledger of attempted action, observed result, elapsed time, retry and evidence path. Separate setup/readiness failures, missed gestures and false-red controller exits from confirmed product defects. For workflow-only retests, retain app and runner hashes and keep those bytes fixed.

Measure meaningful-action-to-stop request, planned readable hold, stop acceptance and saved/ended verification separately. Replacing OCR with CLI control is a deliberate workflow change, not a like-for-like Finish-button benchmark. Different cache state, reused speech, capture lengths or environment setup prevent a controlled total-time claim.

The original driver practices came from a private Linux whiteboard persistence trial on Apparent 0.3.13, commit `e80e2141c989625c9080f4c9fed974e7715c0148`. That caption-only take did not test these new start/wait commands, Mac capture or microphone audio. Shared Rust contract tests are not live GUI proof; verify the exact candidate on each claimed platform before release. These controls do not change delivered media, add narration or authorize automatic paste/upload.

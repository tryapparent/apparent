## Choose and prepare the capture surface

Use the installed **Apparent** on the host showing the result. Follow its
`AGENTS.md` and capture safety rules. On development Macs, read
`capture/engine/docs/capture.md`. Never wake, flash or record physical displays on shared Macs.
For isolated Linux takes,
[check KVM before preparation](../../../../capture/desktop/docs/native-testing.md#check-kvm-from-the-launch-session).
Verify permissions and capabilities on the capture host.

Prepare a clean window before capture: hide notifications, unrelated windows and tabs, personal or customer records, tokens, credentials and auth prompts. Use synthetic **data** if necessary, but label a mocked or simulated **behavior** as such. Authenticate off camera. A crop or blur made after recording does not remove private material from the retained raw file; if a secret appears, discard that take and capture again. Keep the source bundle private, outside public/static asset paths and git.

For a browser-only change, an existing browser recorder may be more precise **if it is already available and the user has not asked specifically for Apparent footage**. Rehearse locators, then record the actual flow at a fixed viewport; wait for the semantic result, not just a timer or `networkidle`. Close the recording context to flush the video. Preserve the original and say “browser recording,” not “Apparent capture.” Do not install a recorder or add a project dependency just for a one-off proof without checking the project's workflow. A browser recording cannot establish native app or OS behavior; repo-local recording helpers from other projects are not portable commands.

## Record the proof with Apparent

For polished desktop demos, use `apparent capture start --request-id <id> --wait --timeout 30` through the already-running GUI's normal interaction-aware path: it collects the clicks, marks and cursor path that drive automatic zoom. Generate and privately retain a 32-hex-character request ID before sending. Retain the reply's top-level `capture_id`, including on failure or timeout, and require `status == "recording"` before acting: a real frame has arrived. Occupied sessions are refused, not toggled; pending portal consent is not recording. Check installed help and input permissions first; older builds lack these controls, and the CLI does not launch the app or bypass consent.

Finish agent-authored videos with `apparent capture stop <owned_id> --wait --timeout 60`, rather than hunting for Finish with OCR; require the visible button only when that button is the claim being tested. Success requires `status == "saved"` and that capture's exact `bundle_path`; a non-waited `stopping` reply is only acceptance. After timeout or disconnect, use `apparent capture inspect <id>` or retry the same start request ID or owned-ID Stop, not a shortcut toggle, `latest` or a directory scan. An admitted capture remains intact after a readiness timeout; explicitly cancel only your own ID if discarding it. Rejected request IDs remain rejected, and receipts last only for this GUI process, not an app restart. Follow [the agent video workflow](../../../../capture/agent/docs/agent-video-workflow.md) for bounded recovery and saved-bundle checks. Shared tests do not prove native Mac capture; verify the exact candidate on each claimed platform before release.

Timed `record --duration` captures do **not** collect that interaction telemetry; do not choose them silently and expect camera motion. Use a timed take only when interaction-aware recording is unavailable or a static camera is intentional, and disclose that limit. For that fallback, check `apparent record --help`, explicitly choose a clean screen and perform the action *while* recording:

```sh
apparent record --duration 15 --out /absolute/private/path/walkthrough.apparent
```

Window recording is temporarily disabled on macOS and Linux; `--window` fails before recording and never substitutes a screen. The timed command above records a display, so use it only when that broader scope is explicitly intended and the whole display is safe. Check the actual target in the bundle. For a supported cabled phone: `apparent record --iphone --duration 15 --out /absolute/private/path/walkthrough.apparent`. This command waits for the duration; it does not perform UI actions for you. Arrange the interaction separately; the GUI `capture` controls do not control a timed recorder. Start before the meaningful action and finish after the result settles. Use the returned exact bundle path, not `latest` when other captures could finish concurrently. If the CLI is unavailable, inspect the installed app path and permissions; don't pretend a transcript, synthetic `apparent demo` bundle, or a command that never recorded the action is a walkthrough.

## Inspect and render the live share copy

Read `summary.md` and `apparent.json`; open `contact-sheet.png` and the relevant `frames/*.png`. Play the **whole raw** `recording.mp4` or `recording.mov`, including first paint, transitions and ending. Check that it shows the correct build/window, all three beats, readable result, correct audio if narrated, no private frames, no error toast or misleading splice. The contact sheet indexes moments but cannot certify the intervening video. If an automatic crop hides context, inspect full frames/source before approving it. Verify the result independently with the relevant test, app state or log where appropriate; the recording proves only what it visibly shows.

For appearance changes, distinguish offscreen renders from a live window: render both schemes to inspect every state, then capture the exact running build opening while the OS is already dark and switching light→dark→light in the same process. Read back the OS appearance alongside screenshots; restore its original setting. A settled screenshot checks that frame, not every transition frame or a live permission grant.

If export works on this host, use `--fps 30` (or `--fps 60` on explicit request). Smooth activity zoom is on by default; keep it on for demos. Use `--no-zoom` only for an intentionally static share copy (for example, a motion-sensitive viewer or a fixed-frame comparison). Do not hand back the unprocessed original or a 60 fps original by accident:

```sh
apparent export /absolute/private/path/walkthrough.apparent --out /absolute/private/path/walkthrough.mp4 --fps 30
```

Set frame rate during export or browser encoding and preserve real-time duration. Check installed `export --help`: older builds opt in with `--zoom`; current builds opt out with `--no-zoom`. Compare the entire export with the source. If motion is missing, check interaction telemetry. Browser-only recordings bypass Apparent’s camera planner. Prefer Apparent browser capture for interaction zoom and disclose a simpler fallback. Use a separate editor to burn explanatory captions or add cuts and speed cues, verify their timing, and retain the original. Check playback, frame rate and duration on the final file. Re-encode browser WebM only if the destination needs it. If missing media or captioning blocks live proof, report the blocker and any verified partial evidence.

## Hand it back

Embed or link the **verified playable file** in a channel the viewer can reach. Name the mode, exact build/environment for live proof (or source and hypothetical status for an explainer), and principal limit. State whether narration is generated or explicitly silent. Include a useful timestamp when it makes inspection faster. A path on an inaccessible machine is not delivery. Do not upload, post to a PR, send to a person, or publish raw or edited media without authorization for that destination; attachment visibility may inherit repository visibility. If production or delivery is blocked, name the exact failed step and best truthful partial evidence without calling the video done. Never claim a playable video exists until you have opened it.

## Lessons

- Read `capture state` for context, not ownership; a socket pathname is not readiness. Start with a retained request ID and require the request's own `recording` receipt before acting. Atomic admission refuses occupied sessions. Never adopt or stop a capture that was already active.
- Derive gestures from settled window bounds and verify the visible mark before continuing. A successful input command proves only that input was accepted.
- Use owned-ID `stop --wait` and its exact saved `bundle_path`, not a global state check. The command checks identity at the action; retrying it cannot stop a newer capture. If Finish already ended the take, inspect that ID or repeat its waited Stop to recover the same result. Unknown, cancelled, failed, wrong-ID and timeout replies are not saved success.
- Tie QA grids and cue-boundary frames to the final movie's hash; regenerate them after every edit. Inspect the actual deliverable before diagnosing a defect from an old grid.
- Keep a private attempt ledger with build/runner identity, elapsed times, retries and evidence paths. Separate harness failures from product defects. When comparing workflow-only retests, keep app and runner bytes fixed; disclose a different stop route and measure readable holds separately. Do not call different routes a Finish-button benchmark or infer total-time improvements from unequal setup.

## Failure traps

- A staged click after the result was already present proves nothing; reset to the starting state and capture the action.
- A smooth mock or browser replay is not evidence for a live native app; name the provenance visibly and in the handoff.
- Automatic zoom is the default presentation for live footage. Burned explanatory captions are required; fast-forward is optional and must be disclosed. None permits concealing failures or inventing causality.
- A complete source bundle is not a shareable artifact until its entire media and delivery destination have been checked.

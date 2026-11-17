# Legacy export test audit

Baseline: `e23da837e34b`. This covers `capture/engine/export/` only; capture,
recovery, retention, the larger keyframe renderer and other Engine areas remain
pending. Production planning, crop, camera, ink, pacing and narration code were
read before their tests, together with the Linux adapter, native Swift consumer,
published Record metadata bridge and export guidance. Stored crop geometry was
checked against the actual auto-crop producer and model. Renderer sizing and its
callers were read before retaining its separate numeric guard.

## Contracts and decisions

All unchanged declarations are retained (R). F repairs a weak oracle; C absorbs
duplicate coverage; D removes support without an independent behavior contract.

| File / declarations or distinct parameter controls | Decision and realistic regression |
| --- | --- |
| camera: opening, full and explicit crops | R: immediate activity skips the first 500 ms of context |
| camera: opening during fast travel | R: zoom starts before travel finishes |
| camera: late click | R: lead, hold, easing or centering disappears |
| camera: nearby activity | R: one cluster repeatedly zooms out or releases before the last action |
| camera: distant activity | R: retargeting inserts an unnecessary wide interruption |
| camera: spread activity | R: a broad gesture is overzoomed |
| camera: wide gesture after held zoom | R: held detail clips the next gesture |
| camera: fast versus slow travel | R: cursor motion triggers premature zoom |
| camera: safe-zone fidget versus drift | R: jitter moves the camera or real drift is ignored |
| camera: crop edges and aspect | R: camera leaves its explicit crop or changes aspect |
| camera: outside activity | R: excluded actions move the view |
| camera: smooth path | R: jerks or overshoots appear between actions |
| camera: thinning, dense samples, idle compression, time zero | R: dropping redundant keys changes the sampled path or opening |
| crop: full/auto/rect parser and malformed/count/zero/unknown rows | R: invalid CLI crops are admitted or valid syntax changes |
| crop: fractions/pixels, overflow, tiny rectangle, full | R: coordinate units change or clipping silently replaces refusal |
| crop: empty screen and phone with stored activity | F: an empty fixture masks removal of the phone-mode veto. Keep the empty screen, then require exact stored screen crop before using the same populated bundle as a phone negative. |
| crop: landscape, odd native, portrait, explicit cap and size floor | R: aspect/cap/even alignment changes. Caption now acknowledges rounding odd native dimensions upward to even. |
| crop: audio offset, long/short audio and no overlap | R: audio starts early, runs past the video or disjoint audio is admitted |
| crop: valid, zero and excessive FPS | R: invalid rate reaches encoding |
| ink: captured/legacy/excluded provenance and layer selection | C: absorb both-off and clicks-only assertions from `layers_can_be_turned_off` into the existing populated stroke/pin/laser/click fixture before setting captured provenance. Keep the literal ripple and all empty checks; now also require suppressed pins/lasers. Retain JSON provenance, reload, semantic preservation and captured-video versus still-image replay distinctions. |
| ink: progressive drawing and grouped fade | R: snapshots regress, coordinates escape, strokes fade independently or use bundle time |
| ink: pins, lasers and touch trails | R: annotation kinds lose identity, clock, lifetime or exact trail geometry |
| ink: long stroke budget | R: unbounded snapshots or a lost final point |
| ink: renderer sizes | R: numeric large/small scale, pin size or stroke width changes. This is the only direct numeric size guard; keep it despite its current location in the export tests. |
| quiet: reading holds, protected actions and absent silence | R: meaningful time is compressed or visual stability alone overrides audible content |
| quiet: detector terminal holds | R: real log boundaries or EOF handling drop intervals |
| quiet: real audio/video retiming | R/D: retain actual detector, exact paced duration and shifted-sound oracle. Remove full-file inequality/read: changed derived bytes alone add no contract beyond observed timing. This was never a raw-source preservation guard. |
| quiet: many fractional joins | R: frame rounding accumulates timeline drift |
| Linux: exact crop resampling | R: rightmost-column/row pixels map incorrectly; codec tolerance checks are a distinct boundary |
| narration: script file admission | R: special files block, unsafe/large reads escape bounds or valid regular input is refused |
| narration: timed renderer | R: samples shift, input changes, overrun is admitted or private intermediates survive |
| narration: schema/timing rows | R: ambiguous, overlapping, unsafe or out-of-range cues reach inference |
| parent: default options | R: menu/default callers lose full opening or automatic zoom |
| parent: published Record metadata | R: rotation, overlapping second audio stream, non-UTF-8 path or actual decode fails; source bytes remain unchanged |
| parent: real annotated movie and audio | R: camera only enlarges annotations, source marker/ink/clicks disappear, audio offset shifts, explicit silence keeps audio, protected source/manifest paths are overwritten or failure creates output |
| parent: video versus container audio tail | R: duration follows the longer track, required audio silently disappears, iPhone overlapping audio is lost or disjoint audio creates output |
| parent: paced copy, realtime, sparse cursor, audible and marked evidence | R: presentation pacing changes source bytes, ignores opt-out, treats sparse samples as continuous motion or compresses meaningful sound/marks |
| parent: focus clock and filtering | R: early events/scroll become camera actions or drag/stroke coordinates/times shift |
| parent: real bundle camera plan | R: consumer wiring stays static or fails to end wide |
| parent: default destination | R: ordinary export leaves Movies/Apparent |

Five real-media fixtures now use the existing `tempfile` dependency, retaining
the root until synchronous subprocesses finish and cleaning up on assertion
failure as well as success. No new dependency, provider mock or production seam.
The camera's test-only interpolation helper is retained: it supports the sampled
path assertions; moving it alone would add little value to this slice.

Test/support delta: 21 added, 64 removed, net **-43 lines**; 41 declarations become
40 after absorbing one layer test. All changes are under existing test modules.
No product behavior, manifests, lockfiles or platform boundary is changed. The
six added crop-fixture lines make the existing mode refusal effective and retain
the documented missing-keyframes fallback; they are not a replacement suite.

## Verification and delivery

Linux baseline: all 41 pass. Candidate: all 40 pass, including real FFmpeg
encoding/decoding, audio alignment, source bytes, output refusal and pacing.
Commands use the normal locked offline root Cargo runner through `t3-build` with
a private verified temporary directory. Logs and copied-source probe recipe:
`/tmp/apparent-dev-engine-audit-0H13BY/export-*.log`, `export-probe.ts`.
These artifacts are disposable and must be regenerated if cleaned.

Copied-source sensitivity and independent preservation review are pending.
The copied app uses its own Cargo target and actual staged Record/Engine media
capabilities plus Electron runtime; it must never write into the delivery cache.
No native Mac execution, live capture, GUI, sealed-package or clean owner-build
independence is claimed. Hosted and exact-main delivery gates remain pending.
Existing automatic CI publication is authorized; no manual release is triggered.

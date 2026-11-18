# Scene transitions

`selection/scene.ts` classifies native adjacent-frame image measurements into
settled transition runs, keeps drawing-owned screens out of ordinary scene
candidates, and supplies their score and label. It preserves native `f32`
threshold and per-operation score rounding. All runs remain available to speech
snapping, including runs excluded from ordinary scene candidates. Native code
retains image sampling/comparison, mark grouping, novelty/coverage admission,
pixel resources, final rendering and publication; those remaining policy
choices are migration debt.

Screen predecode, phone direct-mark preparation and final assembly/recovery use
the same worker through the real selector. Worker failure propagates through
those callers before bundle publication, retaining existing recovery/source
data. The private held-file request carries exact decimal u64 clocks, deltas
and drawing spans, without paths, pixels or transcript text. Both transport
sides have explicit 16 MiB resource limits and the existing ten-second process
cleanup/deadline. A whole recovery input can span many 480-frame decode pages;
that page size and live capture's thinning ceiling are not selection budgets.
Oversized requests fail before publication rather than truncating the timeline.

Stage both emitted scene modules and require them in native/package inputs.
Headless tests include a 10,001-frame snapshot with a reply above 128 KiB. Real
package checks exercise static, settling, separated-change and cursor-only
movies through phone, screen-finalization and recovery callers. Optional proof
output retains their contact sheets. Mac and final AppImage acceptance remain
separate gates; file tests do not establish live capture or permissions.

Rollback restores native transition classification, caller error signatures and
the two generated assets together. SDK pins, configuration mutation, persisted
schemas and human controls are unchanged. This advances Record policy ownership
without claiming whole-Record/native build independence or measured CI savings.

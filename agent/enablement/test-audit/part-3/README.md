| Native Agent declarations | Decision and credible regression |
| --- | --- |
| Multiline notes with subsequent speech/click | R: note text swallows later speech/events or clause snapping moves a note's actual timestamp |
| Shared-frame marks and speech clauses | R: numbering/order/word ownership drifts or speech duplicates on the head |
| Mark number/ID lookup, ambiguous frame and unnumbered mark | R: inspect/zoom selects another mark, hides ambiguity or disagrees with JSON/text identity |
| Shortcuts, short/long/repeated drags and windows | R: jitter/repeats create noise or private titles/overlays/coordinates escape |
| Full/small scene-change and full click | F/R: whole-screen label appears on an ineligible frame or unnamed small regions gain invented labels |
| Named/unnamed marks/clicks/scrubs/point | R: semantic names disappear, scrub noise duplicates or unnamed positions become prose |
| No word timing | R: full speech is lost or spuriously split |
| Real summary experiment off/on | R: summary integration ignores consent/formatting despite formatter-unit success |
| Repeated clicks and owning click frame | R: events duplicate or move to the wrong keyframe |
| Linux unavailable/empty roles, named element and touch | R: required unavailable-element explanation hides real names or incorrectly labels touch |
| Phrase/time/no-match zoom lookup | R: timing/normalization changes the selected moment |
| Zoom quarter-before/start/end, sampling endpoints and clock | R: look-back/post-roll, bounded extraction or printed timestamps drift |
| Mark-centered short/long/start/end zoom windows | R: the requested ink interval is clipped or assigned an ordinary moment window |

Copied real-app sensitivity with the scene-change guard disabled: the original
small-click fixture passes, the full-click keeper fails its intended assertion,
and the restored candidate passes all 13. All Cargo filters were checked. Only
the disposable source archive was mutated; cached build dependencies were reused,
so this is native behavior proof, not clean-build independence or GUI acceptance.
That probe incorrectly shared the delivery target and left a Connect dependency
with a temporary manifest path. The subsequent hook rejected five Connect cases.
Invalidating that package's cache, rebuilding from the real checkout and running
all eight affected Connect controls repaired the cache; the complete Record hook
then passed at `79e00b994`. No Connect guard was changed. The probe recipe now uses
a private target; copied-source probes must never reuse the delivery target.

Fresh checkout context/zoom checks also pass all 13, following the copied-app
controls. The documented `scripts/agent-eval.sh` manual before/after scenario is retained
for its separate visual comparison purpose. Its repository-root lookup is broken
and its historical default capture IDs/output paths are not portable fixtures.
Its manual purpose is preserved by the completed cutover below; it is
not an obsolete regression guard to delete. No real private captures were opened.
Combined Agent test/support delta so far: -9 lines (narrator/frame +2, setup -11,
context 0). Production delta remains zero. Other delivery gates remain above.

## Manual context comparison cutover

C/F: replace the documented Bash `scripts/agent-eval.sh` with the Agent-owned
TypeScript entrypoint `enablement/context-comparison.ts` and move its operating
instructions beside it. Update both real documentation references; no wrapper or
second implementation remains. The old script resolves the repository root to
`capture/`, so a valid built CLI at `target/debug/apparent` is never found. A
controlled old invocation fails that exact gate before comparing anything.

Retain the manual scenario's independent purpose: reprocess twice for each run's
actual images, derive both summaries from the baseline transcript, rewrite paths
to the original bundle, preserve recorded context and assemble an inspectable
index. The second image run cannot be deleted merely because `agentContext` is
currently a text experiment; this scenario also accepts visual experiments.
Remove the personal default capture-ID list and home-artifact destination.
Require explicit inputs and use a private, canonical temporary job by default.
Preserve unrelated config in a private baseline copy; remove only experiments.
Literal argv/path replacement handles spaces, pipes and dollar signs. Fresh
output outside sources is required. Failed comparisons stay visible in the index
and return nonzero without retries; other explicit inputs may complete. Cleanup
removes only this job's intermediate bundles/config, retaining disposable reports
and private CLI logs. CLI stdout/stderr stream to private files, retaining large-report behavior
without adding a pipe-buffer cutoff. The binary's actual version is reported instead of assuming
that the current checkout identifies its built executable.

QA support changes from 113 Bash lines to 83 TypeScript lines (-30), with no new
retained test file or package/dependency. Removing unused private fixture defaults
does not remove access to those cases: a human can explicitly supply their bundles.
No real private capture was read, moved or deleted by this campaign.

Evidence: rebuilt the actual development CLI, generated a demo through its real
producer, and added matching-duration synthetic video. The first controlled
attempt correctly failed native publication because FFmpeg's file mode was too
open; fixing the input to the producer's 0600 contract made the full scenario
pass. Native safety code and tests were not weakened. Both summaries/contact
sheets were inspected: marks/numbering survive, the experiment changes semantic
text, paths refer to the original input and all source/config bytes are preserved.
Existing output is refused without overwrite; missing inputs never select personal
captures. This is Linux development composition, not sealed-package, audio
inference, live-capture or native-Mac proof.

A controlled external CLI using real producer PNGs additionally varies each
reprocess's transcript. Both resulting summaries must use the first transcript;
a wrong-inspect-source control fails that same artifact oracle. Exact argv,
two reprocesses/one inspect, experiment removal/unrelated-config preservation,
owned cleanup and nonzero/no-retry child failure are checked. These protocol
controls supplement rather than replace the real native run. Disposable recipes,
logs and identity receipts are under the existing private audit job.

Independent manual cutover preservation review found no lost contract or unsafe
cleanup/config/source mutation. It reviewed the complete new files and supplied
real/protocol evidence without rerunning checks. Normal hook/hosted/exact-main
gates remain; no macOS, sealed-package or live-capture acceptance is claimed.
Current Agent total: -9 executable-test/support lines and -30 manual QA-tool lines
(-39 combined), one declaration and one duplicate suite invocation removed. App
product code is unchanged; the QA tooling implementation is migrated and repaired.
Incoming main `559f1433c241` changes only unrelated Settings CSS/smokes; all Agent,
Record, Engine, composition/shared and native manifest/build inputs match the
pre-rebase proof. Required combined-tree hook/CI still runs before publication.

## Current-main and range-policy reconciliation

The 13-path contextual port applies without conflicts on main `3a60e5bbe`.
Every changed Agent source/support byte initially matches reviewed `89cb5bc35`;
only this ledger is updated. Contextual documentation hunks preserve incoming
Record speech-cue guidance instead of copying an old complete document. No
Record ancestor history or obsolete central-ledger snapshot is imported.

Read incoming Agent range policy/worker, actual native composition and all
package/range cases before reconciliation. Retain all four new headless cases:
omitted/explicit rate and saved-frame margins; zero/full-u64 saturation; invalid
range/rate refusal; and the real worker's exact clocks, bounded policy errors and
redacted malformed-input disposition. Keep the separate native version/identity
decoder and actual packaged CLI checks: default cadence on FFmpeg and native
routes, saved-frame boundaries, unchanged outputs after invalid requests and
complete source/temporary preservation. These are upstream additions, not new
campaign coverage or a reason to discard old pixel/crop/clock guards.

[Continued audit](../part-4/README.md)

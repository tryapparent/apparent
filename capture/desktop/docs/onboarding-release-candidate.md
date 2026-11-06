# Preview 0.12.1 onboarding candidate

This candidate selectively ports PR401's onboarding onto published tag
`preview-mac-12-1` (`75dc870c240e415820384ced32f4390f798615bc`). Its donor is
`b01d20bb50a02994e08c683c3e352713e2b7a7e7`. It is not a main integration or a
published release. Connect remains unused and the released default local capture,
Notes, settings, handoff and updater are the compatibility baseline.

## Routing and acceptance

The existing packaged `--onboarding` Electron route renders the approved branded
setup and floating practice coaches. Rust owns permissions, shortcut validation,
progress, practice milestones and pen preference. Missing assets or failed
presentation retain the native fallback; stale session/transport callbacks must
not affect its replacement. Do not remove native fallback until installed Mac
and isolated Linux acceptance establishes that replacement behavior.

Pen choice persists as `penColor` through the existing config transaction.
Supported choices are coral, purple, blue and green. Existing absent-color
strokes retain legacy red. Live ink, whiteboard, saved frames and exported video
must preserve selected pigment. No installed configuration is changed by porting.

Required candidate evidence: installation and real permission consent; reopen
with progress; choose and invoke a shortcut; record intelligible microphone
speech; whiteboard and screen ink; finish; actual useful context pasted into a
controlled destination; locate the practice recording; ordinary Notes focus,
local capture, Settings and updater regression checks. Inspect bundle text,
images and playable audio/video. Manual paste confirmation in the lesson is
not independent evidence of delivery. Prior donor proof does not prove this port.

## Proposed release admission — decision required

Current policy admits exact verified main commits. Do not dispatch an older
workflow or publish this branch to evade that gate. Proposed narrow exception:

- Explicitly authorize a named release branch rooted at the published baseline.
  Freeze its candidate SHA; require successful Linux/shared and Mac verification
  receipts for that exact SHA, with workflow identity and successful conclusion
  checked by release admission. Any candidate change invalidates those receipts.
- Keep Preview bundle/helper identity, Developer ID signing, notarization,
  stapling, Sparkle public key and feed. Verify signed archive and reachable
  immutable assets before advancing the feed. Keep existing capture/config paths.
- Allocate a strictly increasing version only after reading the current feed.
  Simon must decide whether this release lineage may advance that feed despite
  not descending from current main, and which later main release may supersede
  it. A higher version alone does not resolve ancestry or preserve onboarding.
- Keep the exception narrowly scoped and tested against wrong branch, SHA,
  missing/failed platform receipts, stale feed ancestry and version regression.
  Publication remains held until this decision and candidate acceptance pass.

A draft review should target a dedicated baseline branch, not main. Creating or
merging such a review does not grant release admission. No policy implementation,
version allocation, publication or additional Mac spending is included yet.

The branch-only `onboarding-candidate` job in Mac verification prepares a signed,
notarized installable CI artifact after that exact commit's Mac verification.
It uses candidate version `0.12.2` / build `12.2` and refuses if the live feed has
caught up. This version is for installed testing; publication still needs the
lineage decision and fresh feed/version checks. The job has read-only repository
permissions, does not sign an appcast or mutate releases/feeds, and records the
source commit, tree, artifact sizes/hashes and pending native acceptance. It is
restricted to the bound candidate branch and is removed with that branch after
accepted delivery. Actions artifact availability is not a release receipt.


## Approved scoped exception

Simon approved this exception for Preview `0.12.2` / build `12.2`. Admission is
limited to `tryapparent/apparent`, Mac publication and the exact
`t3/onboarding-mac-release-baseline` head descending from published `75dc870c`.
Both exact-source manual platform runs must pass their latest-attempt required
jobs and release receipts; Mac must also complete signed candidate packaging.
The ordinary main-only path is unchanged. Signing/notarization are mandatory for
the exception, and the existing Sparkle generator rejects repeated/backward feed
versions. Publication dispatch remains held until installed workflow/audio/output
acceptance. Future main releases must integrate and verify the accepted onboarding
behavior before superseding this release; this exception does not authorize
publishing an unverified main successor or resetting that branch.

## Follow-up candidate (not published)

The one-time `onboarding.tourRevision` migration restarts unfinished pre-revision
setup at Welcome. Completed users remain completed, grants/pen/shortcut settings
are preserved, and subsequent permission-triggered restarts resume normally.
Screen Recording's drag card covers the lower half of the Settings content
column; resizing recomputes its opaque surface. Accessibility keeps its existing
placement. Native acceptance must verify the audio-only target is fully covered,
the upper screen-recording list accepts the dragged real app, and consent/reopen
still completes at standard/scaled display sizes. Geometry alone is not proof.

The shipped DMG contains a normal app and Applications link. The separate test
installer was never included in this release. Do not transplant its test-only
copy policy: it deliberately creates private side-by-side builds, whereas a
production installer must preserve the regular app identity, signing, updater
and existing-install handling. A signed/notarized interactive installer and its
DMG entry/auto-open behavior require separate packaged Mac acceptance before a
new Preview release. No release exception or feed advancement is granted by this
candidate branch.

## Combined follow-up candidate

The combined Mac candidate includes the one-time unfinished-tour restart, the
lower Settings drop cover, all six compact practice illustrations, and a real
interactive installer in the DMG. The separate installer is Electron/React with
shared controls; a signed native adapter owns the install transaction. Opening
the DMG does not automatically execute code: double-click **Install Apparent**
for the frog/drag interaction, or retain the normal Finder drag alternative.
The regular app's identity and Sparkle updater ZIP remain unchanged. Existing
installations require explicit replacement consent and a user-initiated quit;
there is no forced capture interruption. Previous app bytes are retained in a
hidden non-app backup path rather than registering another competing app.

Manual Mac verification on the explicitly bound candidate branch can build a
signed/notarized private Actions artifact, default candidate version 0.12.3 /
build 12.3 (the current published feed is 0.12.2 / 12.2). This creates no release
receipt or feed publication. The existing 0.12.2 publication exception is not
expanded. Installed acceptance and the next version's release admission remain
required before any public update. Check the exact downloaded DMG/manifest
hashes, real frog install/replacement and first-hop behavior, upper recording
list drop with the audio-only target covered, Welcome migration and permission
reopen, all practice milestones, paste and menu location. Do not reset a user's
real TCC grants. The isolated Swift filesystem/host/renderer tests are necessary
checks, not proof of native permission consent or installed GUI behavior.

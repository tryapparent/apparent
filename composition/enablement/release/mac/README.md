# Mac application candidates

`release-mac-preview.yml`’s stable workflow_call path is a reusable, read-only producer. The application
coordinator must admit `source_sha` and finish Linux preparation/readiness before
calling it with that full SHA, numeric Cargo `version`, `channel=stable` and
`tag=vVERSION`. It does not dispatch, create releases, update feeds or write the
tap. Linux distribution remains the coordinator's responsibility.

Portable frontend compilation runs on Linux. A tar artifact preserves its files
and modes across the artifact service. One ARM Mac allocation builds the native app and recording-controls addon, provisions pinned Mac media
providers, stages the locked Electron runtime, signs/notarizes the app, installer
and DMG, validates Homebrew install/upgrade/reinstall/uninstall and signs the Sparkle ZIP.
The final immutable artifact is `stable-macos-aarch64-<run_attempt>`; it contains final DMG,
checksum, ZIP, `sparkle-signature-attributes.txt`, `mac-update.json`, `apparent.rb`
and `manifest-macos-aarch64.json`.
The shared manifest CLI owns provenance and hashing. It receives the admitted
source separately from the calling run's workflow/control SHA and writes evidence
only after all preceding gates succeed.

Stable describes coordinated release publication. Bundle name, helper
ID, preview build restrictions, preview key and existing preview feed remain
unchanged so installed fork clients retain their update contract. This does not
migrate the upstream app or prove an update from an older installed preview.

The old `build-mac-preview.sh` is a compatibility entrypoint into the single TypeScript
assembly implementation here. Manual preview keeps its own admission, version,
publication, feed and Homebrew workflow. Without prepared frontend input it uses
the existing `stage-settings.py` path; Linux packaging also still consumes that
legacy stager. The candidate's TypeScript staging port retains the same payload
layout and signs nested code before the outer bundle. Remove the legacy stager
only after its other callers adopt this staged-input contract and both platforms
accept real packages. Revert the candidate caller to stop stable candidates;
manual preview and installed clients remain independently usable.

The DMG uses the checksum-pinned Electron Builder dmgbuild backend to create a
Finder window with the frog installer, app and Applications shortcut. The frog
icon uses the existing onboarding artwork. Its background
1× and 2× PNGs live in `dmg/`. The backend writes Finder metadata before the
existing signature and notarization steps. Revert the packaging change to restore
the previous DMG layout.

Focused offline checks from the repository root:

```
node --experimental-strip-types --test composition/enablement/release/mac/test.ts
python3 -m unittest discover -s capture/desktop/scripts/tests -p 'test_preview_*.py'
```

These are input, ordering and synthetic packaging checks. They do not prove ARM
compilation, certificate validity, Apple notarization, Homebrew compatibility,
GUI launch, permissions, capture or Sparkle upgrade behavior. Native evidence
requires executing the workflow on an authorized disposable ARM Mac; no paid
Mac execution is part of this implementation.

Linux publication adapters must verify the manifest and re-download/hash the
published assets before advancing the existing preview feed and fork tap.
`mac-update.json` has schemaVersion 1; sourceSha, version, tag, channel,
buildNumber, bundleIdentifier, feedUrl, dmgName, dmgSha256, dmgUrl, zipName,
zipUrl, signatureAttributes, edSignature and length describe exactly these bytes.
`apparent.rb` is ready for Casks/apparent.rb after publication; it uses the
stable tag and final DMG checksum. The retained preview appcast helper accepts only preview tags. Homebrew cask
policy is migrated into publication/homebrew.ts with its old entrypoint retained
as a compatibility wrapper; both stable and preview tags are canonical. Stable
adapters preserve feed
version/build monotonicity, live tag/source checks, immutable asset verification,
tap downgrade refusal and remote readback. They must never re-sign/repackage.

Both regular previews and stable candidates use GITHUB_RUN_ID.GITHUB_RUN_ATTEMPT
for comparable Sparkle ordering across callers. The historical baseline keeps
12.2. Stable tooling is checked out at the workspace root from github.workflow_sha
with clean:false; release-source contains the selected source.
APPARENT_SOURCE_ROOT points at the admitted source checkout, including older
sources without candidate tooling. Manifest creation runs from control tooling
with source provenance kept separate.

Publication on Linux uses Node 22 and authenticated gh. After restoring and
verifying the immutable artifact, run from the trusted control checkout:

- `node --experimental-strip-types composition/enablement/release/mac/publication/cli.ts feed DIRECTORY`
- `node --experimental-strip-types composition/enablement/release/mac/publication/cli.ts cask-prepare DIRECTORY OUTPUT`
- `node --experimental-strip-types composition/enablement/release/mac/publication/cli.ts cask-publish TAP_CHECKOUT CASK_FILE`

Feed and cask jobs are independently retryable. The first two verify sealed
metadata, all manifest files, the public release, exact source tag, GitHub asset
digests and downloaded DMG/checksum/ZIP bytes. Feed publication uses the contents
API's SHA guard and reads back the result; exact retries are no-ops. The cask
publisher requires a clean main checkout of the fork tap, refuses downgrades or
changed checksums for existing versions, pushes without force and reads back the
remote. Provide the tap-only SSH credential to that checkout only after prepare
succeeds. These adapters reuse the candidate's native proof; they do not replace
or weaken the pre-upload Mac Homebrew install validation.

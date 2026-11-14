# Releasing Apparent

## PostHog release attribution

Mac preview and Linux publication resolve a release before compiling via
`scripts/release/posthog-release.ts` (PostHog CLI pinned to `0.19.0`). They use
EU project `329943`, names `apparent-desktop-macos` / `apparent-desktop-linux`,
the packaged version and the checked-out full commit as the provider's separate
build identifier, including tagged Linux
builds. Registration failure blocks publication rather than shipping an
unlinked reporting build. Linux verify-only builds skip registration entirely.
This keeps successive Main builds distinct in PostHog even when they share the
same displayed release number. Both platforms still report the common numeric
`release_version`; the provider release key also includes the source build.

Configure repository secret `POSTHOG_CLI_API_KEY` with a personal key scoped to
the intended project and **error tracking write**. It is separate from the
publishable ingestion secret `APPARENT_POSTHOG_TOKEN`; only the returned public
release UUID is compiled into the app. Do not embed the personal key or expose
CLI failure output. Registration does not enable alerts or send test exceptions.

Verify the release's version/commit in PostHog Releases and an installed build's
`$release_id` against that record. Tests with a synthetic UUID prove wiring, not
live ingestion. Old binaries/events remain unlinked. Rollback is a reverted
publication workflow/native ID change followed by a normally gated release;
do not delete provider records or rewrite historical events to simulate success.

## Temporary Mac preview releases

The fork's **Mac preview release** workflow
(`.github/workflows/release-mac-preview.yml`) is the regular distribution path for Apple silicon.
Mac publication first requires successful Linux/shared and Mac main verification
of the exact commit. Linux publication requires its Linux/shared receipt and does
not wait for queued Mac runners.
It is dispatched manually from `tryapparent/apparent`'s `main`: **Actions → Mac preview release →
Run workflow → main**. It builds on `macos-latest`. The optional `source_sha` input selects an already verified
full main commit when unrelated documentation has advanced the branch. Admission runs
from the dispatch ref before checking out that source and still requires its exact
Linux/shared and Mac receipts plus main ancestry. Version, PostHog build, tag target
and feed all refer to the selected source; the historical onboarding exception cannot
select a different commit. With no input, current main is used. It reads the shared version
from `Cargo.toml`, and creates a GitHub prerelease with the DMG, its SHA-256 and
a Sparkle ZIP. Mac and Linux packages and PostHog records use exactly that version;
0.22.1 advances Linux from 0.3.13 and Mac from 0.21.1. Bump the package version
and its lockfile entry together for each subsequent numbered release. Mac tags
retain `preview-mac-<minor>-<patch>` for 0.x versions; Linux Main tags retain their
commit IDs for ancestry-based update ordering. Linux release titles include the
shared version. The internal Mac Sparkle build number remains `<workflow run>.<attempt>`
to preserve monotonic update ordering; it is separate from the displayed release version.
Existing tags are never overwritten, and a published version requires a new version bump.
The historical onboarding baseline remains fixed at 0.12.2. The
first install uses the release DMG: drag `Apparent Preview.app` into `/Applications`
before launching it. Sparkle cannot update a copy running directly from the mounted DMG or
Downloads; quit that copy, move it to Applications and relaunch it there. Installed previews
then check their own signed Sparkle feed
(`preview-mac-feed/appcast.xml`), including Settings → About → Check for Updates….

### Homebrew distribution

Regular main releases also publish `Casks/apparent.rb` to
[`tryapparent/homebrew-tap`](https://github.com/tryapparent/homebrew-tap). Install with
`brew install --cask tryapparent/tap/apparent` on Apple silicon with macOS 15 or newer.
The cask installs `Apparent Preview.app` from the same notarized DMG, preserves its
Sparkle updater, and adds no CLI or login integration. macOS capture permissions
still require the user's approval. Ordinary uninstall removes the app, not recordings
or settings; the cask intentionally has no `zap` cleanup.

The release's separate **Publish Homebrew cask** job runs only after the release
and signed appcast have been published. It downloads the public DMG and checksum,
checks the release tag against the build commit and the downloaded bytes against
both the checksum asset and GitHub's digest, then exercises Homebrew install,
upgrade when an older cask exists, reinstall and uninstall on a disposable Apple
silicon runner. Signature, notarization, signing team, bundle identity, version and
installed CLI checks must pass before the tap write credential is loaded.
Only the cask is committed, with a fast-forward push and remote readback.
An older version or changed checksum for an existing version is refused.

Provision repository secret `HOMEBREW_TAP_SSH_KEY` with a dedicated SSH deploy key
whose public key has write access **only** to `tryapparent/homebrew-tap`. Its `main`
branch must exist. The normal release checks for this secret and enabled Apple
notarization before building. Keep the private key out of Git, logs and artifacts.
The workflow's normal `GITHUB_TOKEN` is read-only in the Homebrew job and cannot
write the other repository.

If Homebrew publication fails, rerun only the failed job; the public release and
Sparkle feed remain available. To bootstrap the tap or repair an already published
version, dispatch **Mac preview release** from `main` with `homebrew_tag` set to
its exact tag, such as `preview-mac-22-2`. This skips the app build/release and runs
the same downloaded-artifact and installation gates. Leave that input blank for
ordinary releases. Repeating the current cask makes no new commit. Fix a bad
release with a new numbered app release; do not overwrite an existing asset or
downgrade the tap. Removing the deploy key/secret stops future tap writes without
changing installed apps, recordings or the Sparkle feed. The historical onboarding
baseline does not update the tap.

### Preview signing and installation

Before the first dispatch, generate a **dedicated preview** Sparkle EdDSA key pair on a Mac using
the pinned `capture/desktop/scripts/release/setup-sparkle.sh` tools. Run its `bin/generate_keys --account apparent-preview`
in an interactive Mac login session, then `bin/generate_keys --account apparent-preview -p` to see
the public key and `bin/generate_keys --account apparent-preview -x <private-file>` to export the
private seed. Set repository Actions variable `SPARKLE_PREVIEW_PUBLIC_KEY` to the public base64
string and secret `SPARKLE_PREVIEW_PRIVATE_KEY` to the **contents** of that exported file. Keep
the exported file out of the repo and delete the extra copy after storing the secret safely.
The workflow rejects missing/mismatched keys before publishing, signs the ZIP with the private
key from stdin, and only moves the feed after the public asset is reachable. Keep this key for
all later preview releases: replacing it breaks updates for installed copies. The production
Sparkle key and production appcast are unrelated. Test an actual update between two previews on
a Mac before announcing it; CI packaging and an appcast alone do not prove installation works.

The DMG also contains **Install Apparent.app**. Double-click it to open the shared
React/shadcn installer, then click the app or its perched frog, or drag the combined item onto Applications.
The frog and app hop into the folder together; there is no separate Install button.
Downloading or mounting the DMG does not automatically execute the installer.
The native adapter verifies the bundled app signature, identity and build number,
requires explicit replacement confirmation, refuses running apps and downgrades,
and preserves the old bundle before an exclusive rename. It never quits an app,
changes recording permissions or reads captures/config. A previous installation is
kept in a hidden `.apparent-previous-<UUID>.backup` beside the new app. If Applications
requires privileges, use Finder; this installer does not request elevated access.
The installer is separately signed/notarized before the DMG; the Sparkle ZIP
continues to contain only the regular `Apparent Preview.app` with its existing feed.
The Electron host compares canonical adapter paths so macOS aliases such as
`/tmp` and `/private/tmp` identify the same bundled executable. It still rejects
a linked or non-regular bundled adapter and never executes a caller-selected path.
Each build uses installer bundle ID `dev.simonvanlaak.apparent.preview.installer.b<build>`
so an older windowless installer cannot intercept a fresh download's Finder launch.
Reopening a running installer restores and focuses its window. Startup failures show
a native error with the Finder installation fallback, then exit; they do not leave
a windowless process running. No other installer or Apparent process is quit.
Native acceptance must exercise the signed DMG installation and launch on Mac;
renderer tests and safe-copy fixtures alone do not establish installed behavior.

The app is named `Apparent Preview` with bundle ID `dev.simonvanlaak.apparent.preview`, so it
does not overwrite `Apparent.app` or follow Kit's Sparkle feed. Release
[0.11.1](https://github.com/tryapparent/apparent/releases/tag/preview-mac-11-1) is signed with
Developer ID and notarized by Apple. Earlier previews were ad-hoc signed and could require
System Settings → Privacy & Security → Open Anyway on first launch. Sparkle authenticates
update ZIPs with its separate EdDSA key; that signature is independent of Apple notarization.
It still uses Apparent's normal
capture/config paths, so it is not a separate data profile: don't run it alongside production
Apparent or assume their settings and hotkeys are independent. The preview cannot register itself
at login or install the `apparent` command, to avoid replacing production integrations.
Developer ID signing keeps these preview restrictions. Moving
users from the preview back to a signed stable app is a separate migration, not an update in this
feed. The stable app's build-number ordering and bundle identity will need an explicit plan.

### Updating an older preview

1. Open `Apparent Preview.app` from `/Applications`, then choose **Settings → About →
   Check for Updates…**. Accept the update and relaunch when prompted, after capture finishes.
2. If the in-app update fails, quit Apparent Preview, download the notarized DMG from the
   [0.11.1 release](https://github.com/tryapparent/apparent/releases/tag/preview-mac-11-1)
   (or a newer notarized preview), and drag `Apparent Preview.app` into `/Applications`,
   choosing **Replace**. Eject the DMG and launch the installed copy.

Replacing the app bundle leaves recordings and config in their existing external paths.
The signing change may require macOS capture permissions to be approved again. Notarization
keeps the preview bundle identity, Sparkle key/feed and version ordering; it does not enable
silent installation. Kit's original `Apparent.app` uses a separate feed and will not receive
this preview update.

The old ad-hoc-to-notarized Sparkle transition still needs a recorded test on a Mac;
publishing a notarized release and appcast does not establish that an existing installation
successfully updated. See the [native acceptance checklist](mac-signing.md#release-verification).

### Developer ID signing

Keep `MAC_APPLE_SIGNING_ENABLED=true` for subsequent releases. It selects the signed/notarized
path without changing the preview identity or Sparkle key/feed. Follow the
[credential setup and release checklist](mac-signing.md) for maintenance and verification;
do not publish a higher-version ad-hoc build as a workaround for signing failures.

## Kit's original production release procedure

Everything lands on `main` through pull requests, the version bump and the appcast included. A release
is one Mac build (notarized DMG + Sparkle zip) and two Linux AppImages, built from the same tagged
commit. Windows is not a supported release target. Do not dispatch the retained Windows workflow
or publish a Windows zip.

1. **Version:** bump `version` in `Cargo.toml` and `Cargo.lock` in a `release/<version>` PR.
   PRs do not start Actions; the exact commit’s platform-specific main verification gates publication (Linux/shared for Linux; Linux/shared plus Mac for Mac).
   Test changed behavior locally before merging.
2. **Mac build** (Studio, from that commit): `APPARENT_BUILD_NUMBER=<n> APPARENT_SPARKLE_DIR=~/.local/share/apparent-release/sparkle-2.9.4 ./capture/desktop/scripts/release/release-app.sh`.
   The build number goes up by one every release (Sparkle compares it, not the version). The script
   builds, signs, notarizes and staples `dist/Apparent-<version>-arm64.dmg` and `.zip`. Its own
   `dist/updates/appcast.xml` is throwaway: the published appcast comes from step 4.
3. **Tag and release:** merge the PR, tag the merge commit `v<version>`, and create the GitHub release
   with the DMG. Manually dispatch the Linux release workflow on `main` with `tag=v<version>`;
   it checks out the tag and attaches its assets. Check the run and assets before deploying.
   Pushing the tag alone does not start the workflow. Do not dispatch the Windows release workflow.
4. **Appcast** (the Pro, over ssh): copy the Sparkle zip into `~/.local/share/apparent-release/updates/`
   and run `launchctl kickstart gui/$(id -u)/dev.kit.apparent-appcast`. The job
   (`~/Library/LaunchAgents/dev.kit.apparent-appcast.plist` → `~/.local/share/apparent-release/appcast.sh`)
   reads the ed25519 key from the login keychain, which only a GUI-session job can, and runs
   `generate_appcast` over that folder, which holds every earlier zip so it can make deltas. Its log is
   `~/.local/share/apparent-release/appcast.log` and ends with `exit=0`. Copy `updates/appcast.xml` into
   `public/site/public/assets/meta/appcast.xml` in a PR and check the new item's `edSignature` against the app's
   `SUPublicEDKey`. For a dry run, run `appcast.sh <folder> <log>` as a one-off launchd job on a copy
   of the folder.
5. **Site** (the Pro's checkout, where `wrangler` is signed in): fast-forward to `main`, copy the DMG,
   Sparkle zip and the new `Apparent<n>-*.delta` files into `public/site/public/assets/releases/` (also as
   `Apparent-latest-*`), then `bun run build && bunx wrangler@latest deploy`.
6. **Homebrew (Kit's original app only):** a PR to `kitlangton/homebrew-tap` bumping
   `version` and `sha256` in `Casks/apparent.rb`. The fork's regular preview pipeline
   manages its own tap automatically as described above; it does not modify Kit's tap.

Keep the Sparkle tools and the updates folder under `~/.local/share/apparent-release/`, never in `target/`
or `/tmp`: a clean or a reboot would take the tools and every earlier zip with them.
`capture/desktop/scripts/release/setup-sparkle.sh` fetches Sparkle (checksummed) into `$APPARENT_SPARKLE_DIR`, or `target/` when
it's unset.

Check after deploying: the live DMG, Sparkle zip and newest delta match the release's sha256s,
the live appcast's signature verifies, `spctl` accepts the downloaded DMG and the app in it,
the site shows the new Mac version and identifies Windows as unsupported. Do not publish a Windows
zip or point the site to an older one.
Check both Linux AppImages and their `.sha256` assets on the tagged release before advertising them.

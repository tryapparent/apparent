# #171 / PR #191 — reduced native acceptance

Keep the PR draft until the two human-assisted rows below pass. Pending-upload links,
authorization, consent, offline refusal, local Paste and revocation remain in scope.
No VM/rental/controller/demo framework is required. Do not restart a personal app.

## Exact build and start (on an authorized, idle test desktop)

Record `git rev-parse HEAD HEAD^{tree}`, clean `git status --short`, OS/architecture,
Settings → About's compiled revision and the executable SHA-256 with each result.
Use the PR's integrated head, not the old `29a1f748` artifact or an installed main build.

- **macOS — PENDING:** use the documented Xcode/native dependencies, run
  `taskpolicy -c utility cargo build -j 3 --offline`, then `./scripts/install-app.sh`
  (`~/Applications/Apparent.app`; signing identity required). If needed launch with
  `open -a ~/Applications/Apparent.app`. See `docs/onboarding-and-settings.md` and
  `AGENTS.md`; confirm Screen Recording, Microphone and Accessibility for this build.
- **Linux — PENDING:** prerequisites in `docs/linux.md` (desktop, Vulkan, GStreamer,
  curl, clipboard support; microphone/transcription ready). In the exact checkout run
  `cargo build -j 2 --offline`, then `./target/debug/apparent app` in the test desktop.
  On Clanker run builds through `/home/simon/.local/bin/t3-build -- ...`.
  Check existing capture/app activity before launch; do not replace another app.

Both need an already connected upload account on an approved HTTPS service with the
sharing backend enabled and `experiments.hostedSync` / `experiments.hostedSharing`
enabled in the test config. Preserve unrelated preferences. No fresh OAuth/CA setup
or backend provisioning is part of this smoke check. Missing service/account/access
is a named prerequisite blocker, not a pass. See `docs/hosted-client.md`.

## One short smoke per OS (record result beside each row)

| Check | macOS | Linux |
|---|---|---|
| Record a synthetic screen with three spoken sentences and one Shift mark; finish. Inspect local summary/metadata, sheet and frames. Click **Copy link**: clipboard has the three-sentence sharing text and one URL; repeat Copy returns the same URL. A pending URL is allowed and must become ready. | Pending | Pending |
| Open that URL anonymously, without the sender's cookies: video advances, summary/transcript and annotated frames match this capture. In sender management choose **Stop sharing**; reload recipient and its manifest/media URLs: access is denied, while the private capture and local bundle remain intact. | Pending | Pending |
| Separately use **Paste** into an unsent local composer: original local text/image handoff, no share URL substituted. Separately take the test desktop offline: Copy is disabled/refused, clipboard is unchanged and reconnect does not perform a delayed copy; local Paste still works. | Pending | Pending |
| Cancel a capture and dismiss a sharing approval: no stale completion/clipboard change. Confirm Settings retains the upload-consent state; do not revoke a real account to test races. | Pending | Pending |

Cancellation, late approval, grant/consent changes, pending→ready authorization,
CSRF/origin and revoke/private-retention races are primarily covered by existing
Rust hosted regressions and `hosted/` tests; native rows cover OS wiring only.
Retain automated commands/logs and historical evidence separately; do not publish
private bundles, clipboard contents, account data or capability URLs in git/PR text.

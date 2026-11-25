# Contributing to Apparent

Found a bug or have an idea? [Open an issue](https://github.com/tryapparent/apparent/issues/new). A short Apparent recording is especially useful: show the problem, talk through what you expected, and point at the part that went wrong. It helps us understand the issue *and* see where Apparent itself could be better.

## Report an issue with a recording

1. Record the problem with Apparent. On macOS press **⌥⇧S** to start and stop; on Linux press **Alt+Shift+S**. Reproduce the issue, narrate what you expected, and mark anything easy to miss with Shift.
2. Review the recording **before sharing it publicly**. Check the video, audio, contact sheet, frames, and transcript for passwords, tokens, private messages, customer data, or other sensitive details. If it contains any, record a clean reproduction instead; do not upload the raw `.apparent` bundle.
3. Run `apparent export latest --out issue.mp4` and attach the reviewed MP4 to the issue. Export works on macOS and Linux (Linux requires `ffmpeg` and `ffprobe`), with smooth activity zoom by default; add `--no-zoom` for a static camera. If you cannot export a video, attach only reviewed, safe screenshots or describe the steps in text. A recording is welcome, never required.
4. In the issue, add what you expected, what happened, how to reproduce it, and your OS and Apparent version. If the issue is *about Apparent*, show where recording or handoff became confusing too—that feedback is part of the report.

If you cannot safely share a recording, a text-only issue is just as welcome. Do not post private capture paths or an unreviewed `summary.md`; the transcript can contain things you said aloud even when they are not visible in a frame.

## Contribute code

Before your first worktree commit, follow the [staged checker setup](shared/enablement/dependency-policy/fast/README.md).

Discuss larger changes in an issue. Describe changes and tests in your PR. See [test commands](enablement/docs/development.md#testing) and [repository rules](AGENTS.md).

## Guard local pushes

Use the [tracked pre-push verifier](enablement/local-tests/README.md) to run checks for the files your branch changes. For native checks that need the Connect TypeScript build, the verifier builds the locked package before its Cargo tests.

If your worktree still uses the old unconditional Cargo hook, follow the [hook retirement procedure](enablement/directory-width/README.md#hook-activation-and-preservation). It checks the old hook's fingerprint and preserves its bytes before the maintained verifier is activated.

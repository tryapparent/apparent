# Retained synthetic foreground observation

`recording-finish.png` is the inspected 502×58 RGBA, 11,384-byte pill-only image
`21-snapshot.png` from artifact `14283885266`, CD run `43963772459`, attempt 1,
Mac job `133644565287`, source `7667ce2c470365ec6594f0eb6fa05eceff3e360b`.
SHA-256: `87876cf6ab1bb421ea02b416e156777a0333f046c8f6a4f8b5b1ee5969c3cf5b`.
It contains only synthetic recording controls; no user screen content or identity.

That snapshot completed screenshot capture and reached the old combined
`textRecognitionStart` before its eight-second external termination. Snapshots
19 and 20 independently timed out in screencapture. None of those observations
establishes AX readiness or a Vision subphase cause.

The existing Darwin `vision-trace.test.ts` entrypoint replays this immutable PNG
once, before the independently generated PNG, in a fresh process under the same
eight-second cap. It compiles the actual production `recognizeWords`, preserves
accurate recognition and disabled language correction, and retains phase timing
and runner/SDK/runtime identity in the foreground report. No screen capture,
pointer input, consent change or retry is performed by this replay.

A PNG-only pass neither resolves the screenshot timeouts nor establishes live
foreground acceptance. The ordinary installed native case still follows and
must pass before publication/admission.

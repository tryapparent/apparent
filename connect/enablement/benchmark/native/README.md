## Default public-copy sender comparison

The default Desktop Share action calls `prepare_public_link_handoff` in
`connect/hosted.rs`. The native client's `prepare_public_link` snapshots
the recording, reserves a separate plaintext capture and issues the link before
the queue worker calls `process_once`. The worker snapshots again for upload,
reserves the same ID, sends the distinct files, completes and verifies the
owner manifest. Each PUT uses a separate immutable input and acknowledgement.
The Worker verifies size and checksum against the reserved file, stores a
unique object attempt and publishes a single file row. Completion requires
every object's verified head. The encrypted private original and its queue
entry are independent of the public copy. The separate opt-in foreground
client currently sends serially and issues the link after owner readback.

On the experiment branch, dispatch the existing Connect workflow with
`native_sender_control` set to the full main control SHA. The owner builds one
Worker and two native test binaries from the pinned control and candidate
client sources. Both run the same test adapter around the production
`prepare_public_link` and `process_once` entrypoints. Only the native sender
build differs between arms. The receiver reuses the MP4, frame and text
fixtures and stages the same PNG as the contact sheet required by a real native
bundle. The adapter provides an isolated consent/config host and a seeded
fresh grant. It supplies the decision produced by the existing Bend renewal
module for those precise grant facts. Desktop gesture, clipboard, background
scheduling, external authorization servers, managed persistence and credential
renewal are outside this lane.

Both arms record link issuance while pending, each PUT's loopback request
and Worker dispatch/reply timestamps, completion, owner readback, independent
recipient readiness and advancing Chromium frames. After the timed endpoint,
each trial reads every original asset and checks share revocation. Receipts
exclude staged credentials, capability URLs and fixture bodies.

Freeze one calibration block (untraced/traced/traced/untraced control) and
one confirmation block (traced control/candidate/candidate/control) in one
standard hosted job. Both blocks use one selected full SMT sibling set and the
existing outside CPU and I/O/steal guards. Confirmation requires two actual
distinct in-flight PUTs at most on the candidate and one on control, exact
output, and the existing CPU, RSS, stored-byte and cold/warm component guards.
A material speed gain requires each paired speed-index gain and the aggregate
to exceed same-job traced-control spread. The native fixture has its own
reference score. Its score and milliseconds stay separate from the historical
synthetic-sender Intel series.

# Onboarding preview branch

This branch preserves the supplied onboarding design: download, frog
installer, welcome, pen colour, recording shortcut, screen access, accessibility,
practice and handoff. The crossed-out welcome note is removed; the outer
preview disclosure describes the simulated native actions.

## Try it before main

From a checkout of `preview/onboarding-attached`, with Python 3 installed:

```sh
python3 capture/desktop/ui/onboarding-review/build.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory capture/desktop/ui/onboarding-review/dist
```

Open http://127.0.0.1:8080/onboarding.html in your browser. Or open the generated
HTML directly. No Node dependencies or remote script requests are required.
The generated `dist/` folder is ignored; no recording/video evidence is included.

This is an interactive design preview, not an installable Mac onboarding build.
It does not install, authenticate, grant OS permissions, record a real screen,
copy captures or send feedback. It does not change installed routing.

## Native implementation after design review

Carry the accepted screens into the shared Electron/React onboarding surface,
with Rust owning progress, pen preference, permission checks and capture state.
Keep OS mechanics in native adapters. Package a separately identified test app
with separate settings, captures and control sockets, then verify its real
installer, permissions, first capture and handoff before replacing existing
onboarding. Google sign-in additionally needs the authentication backend.

## Source and build

`index.html` comes from the supplied standalone onboarding export. Its unfilled
widget-state placeholder is initialized to an empty JSON object for a normal
browser. `build.py` inlines the three pinned vendor scripts without changing
the onboarding state machine or embedded artwork.

Vendor sources: @floating-ui/core 1.7.3 (dependency-0.js), @floating-ui/dom 1.7.4
(dependency-1.js), and lucide 1.17.0 (dependency-2.js), retrieved from unpkg.
Their license files are retained alongside the scripts.

Verification: the complete flow passed browser interaction checks from both
loopback and the generated standalone file with external requests blocked.
These checks cover the preview, not native integration.

## Proposed desktop practice tour

The accepted setup screens remain unchanged. Step 8 now rehearses the requested
on-screen coaching: chosen shortcut → recording controls → Whiteboard → drawing
→ hold Shift and draw on the screen → stop → preparing → highlighted Copied
→ practice agent paste → menu-bar icon → Open Latest Capture.
Append `#practice` to the built preview URL to jump straight to this section.
All desktop windows, menu controls and recording state are simulated in-browser.
The drawn strokes are real canvas interactions, retained in the simulated result.

For native implementation, advance only on authoritative app state: a successful
recording start after permission admission; Whiteboard actually opening; a real
stroke; recording ending; finalization completing; then the actual menu opening
and capture selection. A shortcut press alone is not a successful recording.
Keep preparation distinct from ready, preserve Back/Try later, and stop coaching
if the recording fails or is cancelled. Place a small coach beside the target,
with a pointer, without a full-screen dimmer or a layer that intercepts the user's
workspace. Reposition against live pill/window/menu bounds and display work area;
the fixed positions in this prototype are illustrative. Do not add a Dock icon.
Open the capture through the existing OS folder/preview flow rather than adding
a desktop review workspace. No native integration or routing is activated here.

The latest design adds a frog guide using the original embedded resting/jumping
artwork. It peeks over the smaller speech bubble and hops between guide targets;
reduced motion removes both hopping and coach entrance animations. The menu
lesson waits until after the practice paste. Clipboard access and external agent
messages are never invoked: Meta/Ctrl+V is handled only in the practice composer.
Native implementation must wait for confirmed copy/paste outcomes, retain a
clear preparing state, and never infer successful delivery from a copied status.

Coach copy uses direct action headings (Open Whiteboard, Draw on your screen,
Paste your capture) and consistent control names. The frog carries the playful
tone. Speech bubbles use readable body contrast, a restrained type scale, clear
keycaps, visible keyboard focus and larger action targets. Setup screens before
practice remain the accepted attached design. Finishing the tour returns to the
existing completed handoff summary rather than repeating the paste lesson.

Typing opt-in and text-annotation shortcut pages are removed. Accessibility now
continues directly to capture practice; saved previews at the removed page
resume at practice. The recording shortcut page remains.

# Onboarding preview branch

This branch preserves the supplied ten-step onboarding design: download, frog
installer, welcome, pen colour, recording shortcut, screen access, accessibility,
typing, practice and handoff. The crossed-out welcome note is removed; the outer
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

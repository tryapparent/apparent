# Record shortcut

`policy.ts` defines the platform default, the precedence of a verified
desktop-managed shortcut over an ordinary saved shortcut, and which display a
keyboard-started recording prefers (the frontmost window's, then the pointer's,
then the first). A valid explicit Apparent choice retains precedence on Linux.

Cargo uses Node 22 to compile this policy into the native app at build time.
The native adapter resolves the keyboard-layout code on Linux, verifies
compositor bindings, and keeps sole responsibility for registration and config
transactions. Settings and onboarding use the native effective label,
managed state and Mac Fn suggestion over their existing bridges. Reset and
startup resolve the default through the same native adapter. The standalone
legacy Electron onboarding launch still accepts old presenter snapshots
without a suggestion field and uses the existing physical Mac Fn mapping.

Run the owner tests with
`node --experimental-strip-types --test record/enablement/shortcuts/policy.test.ts`.
The desktop integration checks exercise both Electron editors. Native delivery
still needs a real shortcut registration, start, finish and relaunch on each
platform. Roll back the producer and both renderer consumers together. The
on-disk format and transaction writer are shared by both revisions.

## Push to talk in Labs

On Hyprland Wayland with Lua dispatchers and readable input devices, enable
**Push to talk** in Settings → Labs. A tap uses the usual Record shortcut.
Hold the shortcut for 300 ms to start quick screen recording, then release
the key or a required modifier to finish. Hold mode uses the focused display's
quick recording path. Start in a graphical composer and keep that window
focused through processing. With Auto paste on, Apparent pastes a draft into the
focused editable field and leaves submission to you. If paste cannot run, the saved recording and
manual handoff remain available. The setting applies on the next press.

Bend defines the gesture's transitions and threshold. The Linux Cargo build
compiles them to a table used by the native shortcut coordinator. Record's
completion worker requests the draft paste only for the corresponding saved
recording. The existing Hyprland adapter checks focus and clipboard ownership
while dispatching the paste.

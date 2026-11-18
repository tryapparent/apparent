# Quit confirmation

The macOS and Linux tray menus and the app’s own Quit key handler open the shared Electron dialog. The existing native shutdown path still handles OS termination and finishes active capture work. If the Electron dialog fails before it displays, an explicit Quit takes the existing native path.

Both buttons send any changed startup preference to the host before returning. The host uses the Settings mutation contract for the config file and native registration. A failed write leaves the app running and the dialog offers a retry. Closing the window by its system control discards the draft. Escape takes the same path as Keep shortcut active. On Linux a persistent desktop binding can have its own launch behavior, so the dialog gives conditional advice.

The desktop frontend build emits the surface in `dist/quit`, which is included in the popup assets staged by the existing packagers. The [Electron smoke check](enablement/smoke.ts) covers the renderer and the piped decision contract with synthetic native responses.

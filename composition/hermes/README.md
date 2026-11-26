# Record for Hermes dialog

The native Apparent URL launcher still invokes the packaged Hermes bridge and preload. The bridge assembles the Record capture request, the native CLI and the authenticated Hermes mailbox. The existing Desktop renderer loads while the first capture-state probe runs.

The interactive window displays pending availability and admits Record only after that probe settles. An occupied response is shown in the dialog and reported through the mailbox. An unavailable recorder still takes the existing launch-and-wait route after explicit confirmation. The bridge takes a fresh state snapshot during preparation, and native Start makes the final atomic admission decision. Trusted autostart remains windowless.

The frontend build emits the existing `dist/hermes-main.cjs` and `dist/hermes-preload.cjs` entrypoints. Existing Desktop Linux and Mac Electron suites exercise these emitted bundles. Reverting this slice restores the synchronous opening probe and its previous renderer wiring together.

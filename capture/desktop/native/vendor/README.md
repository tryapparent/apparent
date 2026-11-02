# Pinned GPUI native-handle correction

`gpui-0.2.2/` is an external Apache-2.0 dependency, not a first-party ownership crate. Its 183 files are a bounded third-party dependency exception to repository directory-size targets. The complete published crate is retained, including `LICENSE-APACHE`.

Source: <https://crates.io/api/v1/crates/gpui/0.2.2/download>.
Published archive SHA-256: `979b45cfa6ec723b6f42330915a1b3769b930d02b2d505f9697f8ca602bee707`.

Exactly one upstream file is changed: `src/platform/linux/x11/window.rs`. `X11Window::window_handle` now returns a borrowed XCB handle for the actual toolkit-owned `self.0.x_window`, rejecting zero, instead of panicking with `unimplemented!()`. It does not guess a window from PID properties, class/title, creation order or another window's layout. `HasDisplayHandle` is not changed or called by Apparent.

The correction is required for the real ordinary-ink surface association. GPUI 0.2.2 is still the latest non-yanked published crate at the provenance check; adding a trait dependency alone would leave the backend panic. The repository-owned pinned source avoids edits to shared Cargo cache/donors or an unpinned fork. All other upstream source, resources, build inputs and license bytes are preserved. macOS source is unchanged; the changed implementation is compiled only for Linux X11. A package/source hash comparison must continue to show this single-file delta.

This supplies an actual toolkit XID, not a compositor capability. XRes process-instance checks, native allocation/mapping epochs, consent/revocation, input usability, buffer receipts and joint native proof remain separate requirements. A successful build or raw-handle conversion test does not admit those behaviors.

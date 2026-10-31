# Hyprland clean-capture producer (#229)

This is a separately built compositor/portal producer, not a renderer fix or an
installed Apparent feature. A normal Apparent build does not enable it. It
requires all three patched external components below and an explicit client
request. Do not install these candidates over a personal desktop session.

## Source and build contract

`sources.json` pins upstream commits and archive SHA256 values. `prepare.py`
verifies every input, applies the three patches in a new directory, and writes
`apparent-clean-source.json`. It does not install, launch, change host services,
request capture access, or read captures. `--offline` requires the cache to be
complete. A digest mismatch fails before source publication.

Use an absolute, absent destination and an explicit cache directory:

```sh
python3 native/linux-clean-capture/prepare.py /path/to/clean-sources \
  --cache /path/to/source-cache
```

Build on Linux with the upstream development dependencies for the pinned
Hyprland, xdg-desktop-portal and xdg-desktop-portal-hyprland sources. This includes
GCC with C++23, CMake, Ninja, Meson, Python, wayland-scanner,
hyprwayland-scanner, gdbus-codegen, Qt6 tools, GLib/GIO Unix, libsystemd, PipeWire,
and the graphics/input development libraries required by Hyprland. The current
build closure uses GCC 16 and libsystemd 262. Older SDK compatibility is not
claimed. Do not substitute the historical portal package recipe's older
protocol snapshot: both pinned source trees use hyprland-protocols
`bd153e76f751f150a09328dbdeb5e4fab9d23622`.

```sh
S=/path/to/clean-sources
cmake -S "$S/Hyprland" -B "$S/build-hyprland" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DFETCHCONTENT_FULLY_DISCONNECTED=ON \
  -DFETCHCONTENT_SOURCE_DIR_GLAZE="$S/glaze" -DBUILD_TESTING=OFF
cmake --build "$S/build-hyprland" --target Hyprland -j 2
cmake -S "$S/backend" -B "$S/build-backend" -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug -DAPPARENT_CLEAN_PROTOCOL_DIR="$S/Hyprland/protocols"
cmake --build "$S/build-backend" --target xdg-desktop-portal-hyprland -j 2
meson setup "$S/build-portal" "$S/portal" --wrap-mode=nodownload \
  --prefix=/usr --libexecdir=lib -Dtests=disabled -Ddocumentation=disabled \
  -Dman-pages=disabled -Dflatpak-interfaces=disabled -Dgeoclue=disabled -Dgudev=disabled
meson compile -C "$S/build-portal" -j 2
cmake -S native/linux-clean-capture -B "$S/build-client" -G Ninja \
  -DAPPARENT_CLEAN_SOURCES="$S" -DCMAKE_BUILD_TYPE=Debug
cmake --build "$S/build-client" -j 2
ctest --test-dir "$S/build-client" --output-on-failure
```

The tests exercise the production lease and peer-instance helpers, generated
Wayland messages and SCM_RIGHTS transfer, and the shared receipt validator.
They are **not** native compositor, real portal, pixel, or PipeWire acceptance.
The bridge is a minimal native Wayland ordinary-window ink client and portal
consumer. Run it only in an owned disposable guest after starting the candidate
compositor, frontend, backend, PipeWire and session bus. It still requires the
ordinary portal source picker and the compositor's original capture permission.
It must not be used as an unattended personal-desktop test.

## Authority and lifecycle

- A role capability is transferred as a Unix socket FD. Its possession alone does
  not authorize screen capture. The compositor binds it to the original
  Wayland client, live native surface, and process instance.
- The frontend duplicates the caller's actual FD-list entry, forwards it with a
  newly assigned handle, and keeps the public caller and frontend identities
  distinct. A numeric caller PID, role number or session string is not proof.
- The backend checks that its peer is the running frontend process instance.
  A substituted process, malformed FD handle, stale role or unsupported capture
  source fails closed for the explicit clean request.
- A clean context belongs to one real Screencopy frame and the original
  authorized monitor/area geometry. Window capture is not added here.
  Attaching a context does not override the DynamicPermissionManager decision.
- During that frame only, the compositor omits the exact role surface from its
  own render path. It leaves the ordinary visible surface and unrelated
  same-process surfaces untouched. It never globally hides windows or erases
  red pixels after capture.
- The context retains strong references only after validating the live role,
  window and surface. Role, surface, grant or frame teardown invalidates its
  generation. A sample can finish once; late or reused samples fail.
- Unmodified clients do not request clean mode. Their existing capture path is
  unchanged. An explicit clean request is not silently downgraded to ordinary
  pixels when capability, permission, source or receipt validation fails.

## Consumer contract for #228

`apparent-clean-v1.xml` defines the internal role/grant/sample exchange.
`apparent-clean-receipt.h` defines the bounded per-buffer receipt ABI and
`apparent-clean-receipt-validate.h` contains the common acceptance checks.
The backend registers `Apparent:CleanFrame:v1` PipeWire metadata. It associates
one compositor-issued receipt with the exact dequeued, copied and queued buffer;
there is no timestamp lookup or stream-wide "clean" flag. Failed frames do not
reuse a prior receipt. The client requests that metadata and validates it before
accepting a frame.

A consumer must retain the receipt with its own buffer identity, validate its
size/version, stream and generation, frame sequence, original source/area and
payload geometry, and reject missing, stale, malformed or mismatched metadata.
It must also invalidate the association on session/role/source teardown.
Advertising metadata or successfully starting a stream is not proof that any
particular buffer is clean. The producer does not change bundle provenance,
historical captures, still rendering, video composition, or the Rust capture
consumer. Those are separate workstreams; absent provenance remains unknown.

## Verification state

This source checkpoint is not native acceptance. Full-link build receipts,
private VM logs and synthetic frame comparisons must identify the exact built
source, compositor, portal frontend, backend and bridge binaries. Required
native checks include live versus clean pixels through partial/completed/faded
ink, unrelated same-process window retention, ordinary-stream behavior,
permission denial, forged/malformed FD handles, foreign frontend/PID-instance
rejection, original source binding, session/role/frame teardown, and receipt
association with the actual PipeWire buffers. No installed package equivalence
or end-to-end Apparent rendering result is claimed by a compile or a CPU test.

Upstream patches retain the respective upstream projects' licenses. They are
source changes against the pinned versions, not vendored release binaries.
Private captures, recordings, VM images and environment files do not belong in
this directory or its PR.

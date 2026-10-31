# Disposable Linux GUI tests

Use `gui-vm-volume.py` around the existing `gui-vm.py`. Each invocation gets a
new preallocated ext4 image, writable overlay, firmware copy, loopback SSH port,
private Unix VNC/QMP sockets and a random DMI UUID checked over SSH **before
candidate staging**. The existing persistent VM is not a template. Do not clone
its live disk or remove another run's locks/sockets.

```sh
python3 scripts/linux/test-gui-vm.py
sudo env TMPDIR="$TMPDIR" python3 scripts/linux/test-gui-vm-volume.py
sudo python3 scripts/linux/gui-vm-volume.py \
  --image "$EVIDENCE/test-unique.ext4" --disk-gib 8 --seconds 1200 -- \
  --template "$OFFLINE_BASE/system.qcow2" \
  --ovmf-vars "$OFFLINE_BASE/OVMF_VARS.fd" \
  --ssh-user "$TEST_USER" --ssh-key "$TEST_KEY" \
  --binary "$REVIEWED_RUNTIME/apparent" --scenario "$SCENARIO" \
  --isolated-network --memory 3072
```

Inputs must be trusted, powered-off and immutable. By default the base is a
standalone qcow2. `--immutable-chain` permits an offline derivative only if every
backing member has no write bits and no detected QEMU owner. File modes and a
process scan do not defend against a hostile same-UID writer. Do not use this
tool as a multi-tenant security sandbox. Sanitize the test account/session and
review its base provenance before boot; a readonly image is not sanitization.
The proof21 derivative isolates the synthetic account from a retained private
original home; it does **not** certify erasure of all original disk history.

The wrapper reserves the complete disk budget with `posix_fallocate` before
formatting. All runner output (including logs, recursive artifact retention,
QEMU disk, firmware and temporary files) stays in that filesystem. ext4 ENOSPC
bounds aggregate allocation, including many files and `FALLOC_FL_KEEP_SIZE`.
The backing ext4 file cannot grow from guest writes. The existing immutable
base and caller-owned input runtime are outside this per-run allocation.
Do not place retained images on a sparse network filesystem or run unlimited
jobs: each job reserves 2–16 GiB; concurrent jobs reserve their sum.

The root systemd service drops to the caller plus KVM access. It enforces 5 GiB
RAM, no swap, 200% CPU, 128 tasks and a 60–3600 second lifetime across the entire
process tree. Host files are read-only except the owned volume. The guest has
no outbound network when `--isolated-network` is selected. This caps each test;
it does not resize, stop or replace any existing worker. Verify host headroom
before admitting concurrent tests. No host compilation is performed.

The wrapper waits for service termination, stops its exact unit, then unmounts
without lazy detach. It never deletes the image. `<image>.json` records exit,
mountpoint, unit and cleanup. A failed artifact copy retains the cold guest disk
inside the image. Successful runs retain copied artifacts and remove only their
own overlay/firmware/sockets. A runner failure is not a native product pass.

Inspect retained evidence by mounting the image read-only in an owned directory:

```sh
sudo mount -o loop,ro,noload,nodev,nosuid test-unique.ext4 "$OWNED_MOUNT"
# job/artifacts, job/scenario.log, job/qemu.log, controller.log
sudo umount "$OWNED_MOUNT"
```

SIGTERM triggers the wrapper's cleanup. If the wrapper itself is SIGKILLed,
the independent systemd lifetime still expires its children, but the mount may
remain. Recover using the **exact** unit/mount printed in the receipt (or the
owned `/run/apparent-vm-<token>` and `apparent-vm-<token>.service` pair): stop that
unit, verify no writers, then normal unmount. Never use broad process kills,
lazy unmount, or delete a live image. Retain evidence before manual disposal.

This runner proves only what the supplied production scenario actually tests.
A boot, a CLI help response or fixture tests are not Settings/capture proof.

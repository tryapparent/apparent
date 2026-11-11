# Disposable Omarchy input

Use the existing `gui-vm.py` runner. The default tablet profile remains suitable
for previously qualified absolute-coordinate recipes. For held strokes, select
`--input-profile mouse`: one relative USB mouse/keyboard path, with the implicit
PS/2 devices disabled. Never mix tablet/VNC absolute motion with a held mouse
button. Relative deltas are accelerated by the guest; they are not guaranteed
pixel coordinates. Re-read actual cursor/window geometry before product actions.

Qualify the driver in a fresh synthetic guest before diagnosing product input:

```sh
node --experimental-strip-types capture/desktop/scripts/linux/gui/input/selfcheck.ts \
  --template "$GUI_TEMPLATE/system.qcow2" \
  --ovmf-vars "$GUI_TEMPLATE/OVMF_VARS.fd" \
  --ssh-key "$GUI_TEST_KEY" --ssh-user "$GUI_TEST_USER" \
  --results "$JOB/input-proof"
```

`JOB` must be a private `/tmp/apparent-dev-<job>-<run>/` directory. The new results
directory must not exist. Use a stopped sanitized Omarchy template, measured
capacity and existing execution authority. Requires host Node 22.18+, QEMU,
Python, SSH and the runner's independent systemd expiry; guest Chromium. Missing tools fail before scenario execution; nothing is installed.
The fixture uses the guest's normal sandboxed Chromium and keyboard configuration.
The deadline is four minutes, including cleanup. The existing runner owns all VM
allocation, expiry and retention; this command supplies a synthetic scenario.

`input-qualification.json` records observed native input, geometry, runner exit
and cleanup. `observed-events.json`, screenshots and `vm/` retain raw evidence.
CDP only observes the owned page; QMP supplies all input. The check requires one
pointer ID throughout down/held movement/up, Shift-click, physical Shift release
and subsequent neutral pointer state. Omarchy's `shift:both_capslock_cancel` may
label `ShiftLeft` keyup as CapsLock; the physical code and subsequent neutral
state establish release. A transport acknowledgment does not qualify input.
A successful fixture always reports `product: unrun`. It does not qualify an
installed product, global shortcut, picker, capture, clipboard, multi-output or
Mac behavior. Execute the task's actual product scenario afterward. Do not spend
another guest solely to change a source SHA when relevant inputs are unchanged.

For an already owned live runner guest, send a reviewed JSON plan:

```sh
node --experimental-strip-types capture/desktop/scripts/linux/gui/input/cli.ts \
  send "$RUN/qmp.sock" "$JOB/input-plan.json"
```

Example plan (relative coordinates, QEMU qcodes, explicit paired edges):

```json
{"profile":"mouse","actions":[
  {"kind":"relative","x":20,"y":10},
  {"kind":"button","down":true},
  {"kind":"relative","x":30,"y":20},
  {"kind":"relative","x":30,"y":-20},
  {"kind":"button","down":false}
]}
```

Keys use `{"kind":"key","code":"shift","down":true}` and a matching false
edge; numeric X keycodes/keysym strings are not QEMU qcodes. Wait actions use
`{"kind":"wait","ms":200}`. Tablet-only absolute actions include current
`x,y,width,height`; mouse plans reject them. Each send is bounded to ten seconds,
including a release/restoration reserve. The helper selects/read-backs the actual
HID device, restores the previous selection and releases uncertain held inputs
on errors, timeout or handled cancellation. A disconnected QMP channel can prevent
release: retain the failure and let the owning runner stop the guest. Never
retry product clicks just because a driver returned success.

The runner's `result.json` exposes the owned live transport after boot. Supply
`--require-host-command <name>` before allocation and
`--require-command <name>` repeatedly on ordinary scenarios for required decoders
or fixture tools. The readiness stage creates a short private guest TMPDIR and
imports only known desktop variables without shell evaluation. No environment
check proves decoder support for a particular movie. Idle/lock policy remains
part of the owning scenario: the short selfcheck sends input immediately after
readiness; it does not disable or qualify a long-running desktop's idle behavior.

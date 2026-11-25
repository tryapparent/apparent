import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hostedInterference,
  hostedMeter,
} from "../diagnostics/hosted-guard.ts";
import { pressureDelta, pressureSample } from "../pressure.ts";

const [scratch, evidence, kernel, initrd, disk] = process.argv.slice(2);
const meter = hostedMeter();
const pressure = await pressureSample();
const before = meter.snapshot();
const console = openSync(join(evidence, "guest-console.log"), "wx", 0o600);
let result;
try {
  result = spawnSync(
    "qemu-system-x86_64",
    [
      "-machine",
      "q35,accel=kvm",
      "-cpu",
      "host",
      "-m",
      "3072",
      "-smp",
      "4",
      "-display",
      "none",
      "-vnc",
      "unix:" + join(scratch, "display.sock"),
      "-monitor",
      "none",
      "-serial",
      "stdio",
      "-nic",
      "none",
      "-no-reboot",
      "-device",
      "virtio-vga",
      "-device",
      "qemu-xhci",
      "-device",
      "usb-tablet",
      "-device",
      "usb-kbd",
      "-kernel",
      kernel,
      "-initrd",
      initrd,
      "-append",
      "root=/dev/vda rw console=tty0 console=ttyS0 init=/bench/boot.ts quiet noresume",
      "-drive",
      "if=virtio,format=raw,cache=none,file=" + disk,
    ],
    {
      cwd: scratch,
      stdio: ["ignore", console, console],
      timeout: 150_000,
      killSignal: "SIGKILL",
    },
  );
} finally {
  closeSync(console);
}
const after = meter.snapshot();
const delta = pressureDelta(pressure, await pressureSample());
const interference = hostedInterference(before, after, delta.ioPercent, 5);
writeFileSync(
  join(evidence, "interference.json"),
  JSON.stringify({ ...interference, hostPressure: delta }, null, 2) + "\n",
);
if (result.error) throw result.error;
assert.equal(result.status, 0, "QEMU failed. See guest-console.log");
assert.ok(interference.qualified, "Hosted interference rejected the run");

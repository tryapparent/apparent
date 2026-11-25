import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  apt,
  command,
  hostCounters,
  openJob,
  parseCpu,
  receipt,
  stealSince,
} from "./job.ts";

const job = openJob("native-probe");
const evidence = join(job.evidence, "native-feasibility.json");
const flags =
  /^flags\s*:\s*(.+)$/m
    .exec(readFileSync("/proc/cpuinfo", "utf8"))?.[1]
    .split(/\s+/) ?? [];
const virtualization = flags.includes("vmx")
  ? "vmx"
  : flags.includes("svm")
    ? "svm"
    : null;

function kvmDevice() {
  const device = statSync("/dev/kvm", { throwIfNoEntry: false });
  return device
    ? {
        characterDevice: device.isCharacterDevice(),
        mode: (device.mode & 0o777).toString(8),
        gid: device.gid,
      }
    : null;
}

const report = {
  hostedNestedVirtualizationSupported: false,
  qualifiedForNativeScore: false,
  runner: hostCounters(),
  requiredGuestVcpus: 4,
  guestFixture: "BusyBox initramfs with the hosted runner's Linux kernel",
  appDesktopTemplate:
    "The Record native benchmark requires the sanitized Omarchy guest, PipeWire, Hyprland, QMP input and independent clipboard observation.",
  virtualization,
  deviceBefore: kvmDevice(),
  device: kvmDevice(),
  moduleLoad: null as null | {
    module: string;
    status: number | null;
    detail: string;
  },
  guestBooted: false,
  guest: null as null | {
    online: string;
    siblings: string[];
    pressure: string[];
    stealPercent: number;
  },
  outcome: "Started feasibility probe",
};
receipt(evidence, report);
try {
  if (!report.device && virtualization) {
    const module = virtualization === "vmx" ? "kvm_intel" : "kvm_amd";
    const load = spawnSync("sudo", ["-n", "modprobe", module], {
      env: job.env,
      encoding: "utf8",
      timeout: 5000,
    });
    report.moduleLoad = {
      module,
      status: load.status,
      detail: load.error?.message ?? load.stderr?.trim() ?? "",
    };
    report.device = kvmDevice();
  }
  assert.ok(
    report.device?.characterDevice,
    "Hosted runner has no /dev/kvm character device",
  );
  apt("qemu-system-x86", "busybox-static", "cpio");
  const kernel = command("uname", ["-r"], { capture: true });
  assert.match(kernel, /^[a-zA-Z0-9.+_-]+$/);
  const kernelPath = join(job.scratch, "vmlinuz");
  command("sudo", [
    "-n",
    "install",
    "-m",
    "0644",
    "/boot/vmlinuz-" + kernel,
    kernelPath,
  ]);
  const init = join(job.scratch, "initramfs");
  for (const path of [
    init,
    join(init, "bin"),
    join(init, "proc"),
    join(init, "sys"),
    join(init, "dev"),
  ])
    mkdirSync(path, { mode: 0o755 });
  copyFileSync("/bin/busybox", join(init, "bin/busybox"));
  writeFileSync(
    join(init, "init"),
    `#!/bin/busybox sh
set -e
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
test -c /dev/ttyS1 || /bin/busybox mknod -m 600 /dev/ttyS1 c 4 65
exec > /dev/ttyS1
echo RECORD_GUEST_BEGIN
/bin/busybox cat /sys/devices/system/cpu/online
/bin/busybox cat /sys/devices/system/cpu/cpu*/topology/thread_siblings_list
/bin/busybox cat /proc/pressure/cpu /proc/pressure/io
/bin/busybox grep '^cpu ' /proc/stat
/bin/busybox sleep 1
/bin/busybox grep '^cpu ' /proc/stat
echo RECORD_GUEST_END
/bin/busybox poweroff -f
`,
    { mode: 0o755 },
  );
  const disk = join(job.scratch, "initramfs.cpio");
  const archive = spawnSync("cpio", ["-o", "-H", "newc", "-F", disk], {
    cwd: init,
    input: ".\nbin\nbin/busybox\nproc\nsys\ndev\ninit\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  assert.equal(archive.status, 0, archive.error?.message);
  const uid = process.getuid!();
  const gid = process.getgid!();
  const groups = [
    ...new Set([...process.getgroups!(), report.device.gid]),
  ].sort((a, b) => a - b);
  const kernelConsole = join(job.evidence, "native-kernel.log");
  writeFileSync(kernelConsole, "", { mode: 0o600 });
  const qemu = spawnSync(
    "sudo",
    [
      "-n",
      "setpriv",
      "--reuid=" + uid,
      "--regid=" + gid,
      "--groups=" + groups.join(","),
      "--",
      "/usr/bin/qemu-system-x86_64",
      "-machine",
      "q35,accel=kvm",
      "-cpu",
      "host",
      "-smp",
      "4",
      "-m",
      "512",
      "-nodefaults",
      "-display",
      "none",
      "-serial",
      "file:" + kernelConsole,
      "-serial",
      "stdio",
      "-monitor",
      "none",
      "-nic",
      "none",
      "-kernel",
      kernelPath,
      "-initrd",
      disk,
      "-append",
      "console=ttyS0 rdinit=/init panic=1 psi=1",
      "-no-reboot",
    ],
    {
      env: job.env,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const sampleOutput = qemu.stdout ?? "";
  writeFileSync(join(job.evidence, "native-guest.log"), sampleOutput, {
    mode: 0o600,
  });
  if (qemu.stderr)
    writeFileSync(join(job.evidence, "native-qemu.log"), qemu.stderr, {
      mode: 0o600,
    });
  report.guestBooted = readFileSync(kernelConsole, "utf8").includes(
    "Run /init as init process",
  );
  assert.equal(
    qemu.status,
    0,
    qemu.error?.message ?? "KVM guest failed. See native-guest.log",
  );
  const sample = /RECORD_GUEST_BEGIN\r?\n([\s\S]+?)RECORD_GUEST_END/.exec(
    sampleOutput,
  );
  assert.ok(sample, "Missing guest counter frame. See native-guest.log");
  report.guestBooted = true;
  const rows = sample[1]
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  const [online, ...siblings] = rows.slice(0, 5);
  const pressure = rows.filter((row) => /^(some|full) avg10=/.test(row));
  const ticks = rows.filter((row) => /^cpu\s+/.test(row)).map(parseCpu);
  assert.equal(online, "0-3");
  assert.equal(siblings.length, 4);
  assert.equal(ticks.length, 2);
  assert.ok(pressure.filter((row) => row.startsWith("some")).length >= 2);
  report.guest = {
    online,
    siblings,
    pressure,
    stealPercent: stealSince(ticks[0], ticks[1]),
  };
  report.outcome =
    "Four-vCPU KVM guest booted without networking. Full native scoring requires supported nested virtualization and the sanitized desktop template.";
} catch (error) {
  report.outcome = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  receipt(evidence, { ...report, after: hostCounters() });
}

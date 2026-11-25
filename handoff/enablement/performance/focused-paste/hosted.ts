import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { summarize } from "./summary.ts";

const [control, candidate, evidence, ...extra] = process.argv.slice(2);
assert.ok(
  control &&
    candidate &&
    evidence &&
    !extra.length &&
    [control, candidate, evidence].every(isAbsolute),
);
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const source = fileURLToPath(new URL("./", import.meta.url));
const guest = join(source, "guest");
const scratch = mkdtempSync("/tmp/apparent-dev-handoff-focused-");
const temp = join(scratch, "tmp");
const stage = join(scratch, "stage");
const root = join(scratch, "root");
const target = join(scratch, "target");
const bench = join(stage, "bench");
for (const path of [temp, root, stage, bench]) mkdirSync(path, { mode: 0o700 });
const env = {
  ...process.env,
  TMPDIR: temp,
  CARGO_TARGET_DIR: target,
  APPARENT_REPORTING_ENVIRONMENT: "synthetic",
  CMAKE_BUILD_PARALLEL_LEVEL: "3",
};
const command = (
  file: string,
  args: string[],
  cwd?: string,
  extraEnv?: NodeJS.ProcessEnv,
) =>
  execFileSync(file, args, {
    cwd,
    env: { ...env, ...extraEnv },
    stdio: "inherit",
    timeout: 22 * 60_000,
  });
const capture = (file: string, args: string[], cwd?: string) =>
  execFileSync(file, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30_000,
  }).trim();

const uid = process.getuid?.();
const gid = process.getgid?.();
assert.ok(uid && gid, "Run hosted measurement as an unprivileged runner");
if (!statSync("/dev/kvm", { throwIfNoEntry: false })) {
  const cpu = readFileSync("/proc/cpuinfo", "utf8");
  const module = /\bvmx\b/.test(cpu)
    ? "kvm_intel"
    : /\bsvm\b/.test(cpu)
      ? "kvm_amd"
      : null;
  assert.ok(module, "The standard runner must expose nested virtualization");
  command("sudo", ["-n", "modprobe", module]);
}
const kvm = statSync("/dev/kvm");
assert.ok(kvm.isCharacterDevice());
command(
  "bash",
  ["capture/desktop/scripts/linux/appimage/dependencies.sh"],
  control,
);
command("sudo", [
  "-n",
  "apt-get",
  "install",
  "-y",
  "--no-install-recommends",
  "qemu-system-x86",
  "e2fsprogs",
]);
command("rustup", ["toolchain", "install", "1.99.1", "--profile", "minimal"]);
const image =
  "ubuntu@sha256:ed2128eae94f1dce83f9aafb8e1dc2e3f098b5ce733ed4a13ccaf94330e3e0a8";
const container = capture("docker", [
  "create",
  "--platform=linux/amd64",
  "--env=DEBIAN_FRONTEND=noninteractive",
  image,
  "/usr/bin/sleep",
  "600",
]);
assert.match(container, /^[0-9a-f]{64}$/);
const guestCommand = (...args: string[]) =>
  command("docker", ["exec", container, ...args]);
try {
  const archive = join(scratch, "guest.tar");
  command("docker", ["start", container]);
  guestCommand("apt-get", "update");
  guestCommand(
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    "initramfs-tools",
    "linux-image-virtual",
    "hyprland",
    "xwayland",
    "wl-clipboard",
    "seatd",
    "dbus-daemon",
    "gjs",
    "gir1.2-gtk-3.0",
    "mesa-vulkan-drivers",
    "libvulkan1",
    "libgstreamer1.0-0",
    "libgstreamer-plugins-base1.0-0",
    "libxcb-shape0",
    "libxcb-randr0",
    "libxcb-xinput0",
    "libxcb-xfixes0",
    "libxcb-xtest0",
    "libxcb-composite0",
    "libxkbcommon-x11-0",
    "libx11-xcb1",
    "libasound2t64",
    "libssl3t64",
    "fontconfig",
    "fonts-dejavu-core",
    "iproute2",
    "mount",
    "passwd",
    "udev",
    "util-linux",
    "x11-utils",
  );
  guestCommand(
    "useradd",
    "--create-home",
    "--uid",
    "2000",
    "--groups",
    "video,render,input",
    "benchmark",
  );
  guestCommand("apt-get", "clean");
  guestCommand("rm", "-rf", "/var/lib/apt/lists");
  command("docker", ["stop", container]);
  command("docker", ["export", "--output", archive, container]);
  command("sudo", ["-n", "tar", "--numeric-owner", "-xf", archive, "-C", root]);
  command("rm", ["--", archive]);
} finally {
  command("docker", ["rm", "-f", container]);
}

async function build(checkout: string, label: "control" | "candidate") {
  const revision = capture("git", ["rev-parse", "HEAD"], checkout);
  const frontend = join(checkout, "capture/desktop/ui/frontend");
  command(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    frontend,
  );
  command(process.execPath, ["node_modules/electron/install.js"], frontend);
  command(process.execPath, ["enablement/prerequisites/native.ts"], checkout);
  command(
    "cargo",
    [
      "+1.99.1",
      "build",
      "--release",
      "--locked",
      "--bin",
      "apparent",
      "-j",
      "3",
    ],
    checkout,
    { GITHUB_SHA: revision },
  );
  const profile = join(target, "release");
  const destination = join(bench, label);
  mkdirSync(destination);
  const libraries = readdirSync(profile).filter((name) =>
    /^lib(?:transcribe|ggml).*\.so(?:\.|$)/.test(name),
  );
  assert.ok(libraries.some((name) => name.startsWith("libtranscribe.so.")));
  const hashes: Record<string, string> = {};
  for (const name of ["apparent", ...libraries]) {
    const path = join(destination, name);
    copyFileSync(join(profile, name), path);
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    hashes[name] = hash.digest("hex");
  }
  writeFileSync(
    join(evidence, label + "-build.json"),
    JSON.stringify({ revision, hashes }) + "\n",
  );
  return revision;
}
const controlSha = await build(control, "control");
const candidateSha =
  control === candidate ? controlSha : await build(candidate, "candidate");
writeFileSync(
  join(bench, "revisions.json"),
  JSON.stringify({ control: controlSha, candidate: candidateSha }) + "\n",
);
for (const name of ["boot.ts", "session.ts", "replay.ts", "clipboard-fault.ts"])
  copyFileSync(join(guest, name), join(bench, name));
copyFileSync(process.execPath, join(bench, "node"));
writeFileSync(
  join(bench, "editor.mjs"),
  stripTypeScriptTypes(readFileSync(join(guest, "editor.ts"), "utf8")),
);
command("chmod", [
  "0755",
  bench,
  join(bench, "boot.ts"),
  join(bench, "clipboard-fault.ts"),
]);
command("sudo", ["-n", "cp", "-a", bench, root]);
const boot = join(root, "boot");
const kernels = readdirSync(boot).filter((name) => name.startsWith("vmlinuz-"));
assert.equal(kernels.length, 1, "Expected one pinned-image guest kernel");
const kernel = join(boot, kernels[0]);
const initrd = join(boot, kernels[0].replace("vmlinuz-", "initrd.img-"));
assert.ok(statSync(initrd).size > 0);
command("sudo", [
  "-n",
  "install",
  "-m",
  "0644",
  kernel,
  join(scratch, "kernel"),
]);
command("sudo", [
  "-n",
  "install",
  "-m",
  "0644",
  initrd,
  join(scratch, "initrd"),
]);
const disk = join(scratch, "guest.ext4");
command("truncate", ["-s", "5G", disk]);
command("sudo", ["-n", "mkfs.ext4", "-q", "-F", "-d", root, disk]);
command("sudo", ["-n", "chown", `${uid}:${gid}`, disk]);
try {
  command("sudo", [
    "-n",
    "systemd-run",
    "--quiet",
    "--wait",
    "--collect",
    "--expand-environment=no",
    "--service-type=exec",
    "--unit=apparent-handoff-" + randomUUID() + ".service",
    "--uid=" + uid,
    "--gid=" + gid,
    "--property=SupplementaryGroups=" + kvm.gid,
    "--property=CPUAccounting=yes",
    "--property=NoNewPrivileges=yes",
    "--property=RuntimeMaxSec=160s",
    "--",
    process.execPath,
    join(source, "measure.ts"),
    scratch,
    evidence,
    join(scratch, "kernel"),
    join(scratch, "initrd"),
    disk,
  ]);
} finally {
  try {
    command("/usr/sbin/debugfs", ["-R", "rdump /out " + evidence, disk]);
  } catch (error) {
    console.error("Could not recover guest evidence", error);
  }
}
const consoleLog = readFileSync(join(evidence, "guest-console.log"), "utf8");
assert.match(consoleLog, /^PASTE_GUEST_EXIT 0\r?$/m);
const out = join(evidence, "out");
const result = summarize(
  readFileSync(join(out, "replay.jsonl"), "utf8"),
  readFileSync(join(out, "passed"), "utf8").trim(),
  controlSha,
  candidateSha,
);
writeFileSync(
  join(evidence, "comparison.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
assert.ok(
  result.qualified,
  "Focused draft comparison did not clear the measured noise and resource limits",
);

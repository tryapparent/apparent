#!/bench/node
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";

process.umask(0o077);
process.env.PATH = "/usr/local/bin:/usr/bin:/usr/sbin";
const run = (file: string, ...args: string[]) =>
  execFileSync(file, args, { stdio: "inherit", timeout: 12_000 });

let status = 1;
try {
  for (const [path, type, options] of [
    ["/proc", "proc", "defaults"],
    ["/sys", "sysfs", "defaults"],
    ["/run", "tmpfs", "mode=755"],
    ["/tmp", "tmpfs", "mode=1777"],
    ["/dev/shm", "tmpfs", "mode=1777"],
  ]) {
    run("mkdir", "-p", path);
    if (spawnSync("mountpoint", ["-q", path]).status !== 0)
      run("mount", "-t", type, "-o", options, type, path);
  }
  run("install", "-d", "-m", "1777", "/tmp", "/tmp/.X11-unix");
  run(
    "install",
    "-d",
    "-o",
    "benchmark",
    "-g",
    "benchmark",
    "-m",
    "700",
    "/tmp/benchmark",
    "/out",
  );
  run("modprobe", "virtio_gpu");
  run("modprobe", "usbhid");
  run("/usr/lib/systemd/systemd-udevd", "--daemon");
  run("udevadm", "trigger", "--action=add");
  run("udevadm", "settle", "--timeout=10");
  const seatLog = openSync("/out/seatd.log", "wx");
  const seat = spawn("seatd", ["-g", "video"], {
    env: { ...process.env, SEATD_VTBOUND: "0" },
    stdio: ["ignore", seatLog, seatLog],
  });
  closeSync(seatLog);
  for (let retry = 0; retry < 100 && !existsSync("/run/seatd.sock"); retry++)
    await pause(50);
  assert.ok(
    existsSync("/run/seatd.sock") && seat.exitCode === null,
    "Guest seat is unavailable",
  );
  const bootstrapLog = openSync("/out/bootstrap.log", "wx");
  try {
    const session = spawnSync(
      "runuser",
      [
        "-u",
        "benchmark",
        "--",
        "env",
        "-i",
        "PATH=" + process.env.PATH,
        "HOME=/home/benchmark",
        "USER=benchmark",
        "LANG=C.UTF-8",
        "XDG_RUNTIME_DIR=/tmp/benchmark",
        "XDG_SESSION_TYPE=wayland",
        "XDG_CURRENT_DESKTOP=Hyprland",
        "LIBSEAT_BACKEND=seatd",
        "GDK_BACKEND=wayland",
        "HYPRLAND_NO_SD_VARS=1",
        "LP_NUM_THREADS=1",
        "dbus-run-session",
        "--",
        "/bench/node",
        "/bench/session.ts",
      ],
      {
        stdio: ["ignore", bootstrapLog, bootstrapLog],
        timeout: 100_000,
        killSignal: "SIGKILL",
      },
    );
    if (session.error) throw session.error;
    assert.equal(session.status, 0, "Guest session failed");
    status = 0;
  } finally {
    closeSync(bootstrapLog);
  }
} catch (error) {
  console.error(error);
} finally {
  for (const file of [
    "/out/bootstrap.log",
    "/out/hyprland.log",
    "/out/seatd.log",
  ])
    if (existsSync(file))
      console.error(
        readFileSync(file, "utf8").split("\n").slice(-60).join("\n"),
      );
  console.log("PASTE_GUEST_EXIT " + status);
  run("sync");
  run("poweroff", "-f");
}

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

const directories = (path: string) =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(path)
    : [];
const socket = (path: string) =>
  statSync(path, { throwIfNoEntry: false })?.isSocket();
const runtime = process.env.XDG_RUNTIME_DIR!;
const hypr = join(runtime, "hypr");
const config = "/out/hyprland.lua";
writeFileSync(
  config,
  `hl.monitor({ output = "", mode = "1280x720@60", position = "0x0", scale = 1 })
hl.config({
    animations = { enabled = false },
    misc = { disable_hyprland_logo = true, disable_splash_rendering = true },
})`,
);
const log = openSync("/out/hyprland.log", "wx", 0o600);
const compositor = spawn("Hyprland", ["--config", config], {
  stdio: ["ignore", log, log],
});
closeSync(log);
try {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    assert.equal(compositor.exitCode, null, "Hyprland exited during startup");
    const instances = directories(hypr).filter((dir) =>
      socket(join(hypr, dir, ".socket.sock")),
    );
    const wayland = directories(runtime).filter(
      (file) => file.startsWith("wayland-") && socket(join(runtime, file)),
    );
    const x11 = directories("/tmp/.X11-unix").filter(
      (file) => /^X\d+$/.test(file) && socket(join("/tmp/.X11-unix", file)),
    );
    if (instances.length === 1 && wayland.length === 1 && x11.length === 1) {
      const env = {
        ...process.env,
        HYPRLAND_INSTANCE_SIGNATURE: instances[0],
        WAYLAND_DISPLAY: wayland[0],
        DISPLAY: ":" + x11[0].slice(1),
      };
      if (
        spawnSync("xdpyinfo", [], { env, stdio: "ignore", timeout: 1_000 })
          .status === 0
      ) {
        const result = spawnSync("/bench/node", ["/bench/replay.ts"], {
          env,
          stdio: "inherit",
          timeout: 80_000,
          killSignal: "SIGKILL",
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, "Draft replay failed");
        break;
      }
    }
    await pause(50);
  }
  assert.ok(
    performance.now() < deadline ||
      statSync("/out/passed", { throwIfNoEntry: false })?.isFile(),
    "No isolated compositor session became ready",
  );
} finally {
  compositor.kill("SIGTERM");
}

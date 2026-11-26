import { app } from "electron";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { FrogPlatform } from "../../../onboarding/electron/desktop-frog/host.ts";

const mac = process.platform === "darwin";
const hyprland =
  process.platform === "linux" && !!process.env.HYPRLAND_INSTANCE_SIGNATURE;
const id = randomUUID().replaceAll("-", "");
const title = `Apparent desktop frog ${id}`;
const rule = `apparent_frog_${id}`;
const limits = { timeout: 750, maxBuffer: 8192 };

async function prepareHyprland() {
  const source = `local rule = hl.window_rule({
    name = '${rule}', match = { initial_title = '^${title}$', xwayland = true },
    float = true, pin = true, no_initial_focus = true, border_size = 0,
    no_blur = true, no_shadow = true
  })
  assert(rule:is_enabled(), 'Desktop frog rule unavailable')
  _G['${rule}'] = rule`;
  await new Promise<void>((resolve, reject) => {
    execFile("hyprctl", ["eval", source], limits, (error, stdout) => {
      if (error || stdout.trim() !== "ok")
        reject(Error("Could not configure the desktop frog in Hyprland"));
      else resolve();
    });
  });
  app.once("will-quit", () => {
    try {
      execFileSync(
        "hyprctl",
        [
          "eval",
          `local rule = _G['${rule}']; if rule then rule:set_enabled(false); _G['${rule}'] = nil end`,
        ],
        limits,
      );
    } catch {
      console.error("Could not retire the desktop frog rule");
    }
  });
}

export const frogPlatform: FrogPlatform = {
  flight: mac,
  windowTitle: hyprland ? title : undefined,
  async ready() {
    if (mac) app.setActivationPolicy("accessory");
    if (hyprland) await prepareHyprland();
  },
  configure(window, overlay) {
    if (mac) window.setContentProtection(true);
    window.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: mac });
    window.setIgnoreMouseEvents(overlay);
    if (hyprland)
      window.on("page-title-updated", (event) => event.preventDefault());
  },
  hideForRecording(window) {
    window.hide();
  },
};

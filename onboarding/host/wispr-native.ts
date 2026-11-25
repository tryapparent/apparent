import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  dictationApps,
  type DictationApp,
  type WisprResult,
} from "./dictation.ts";
import table from "../settings/dictation-preference.json" with { type: "json" };
import preferences from "../settings/preferences.json" with { type: "json" };
import type { WisprProvider } from "./wispr.ts";

const wispr = preferences.find(({ id }) => id === "labs.onboardingWisprFlow");
if (!wispr?.legacy) throw Error("Missing dictation conflicts preference");
const {
  id,
  legacy: { path: oldPath },
  default: fallback,
} = wispr;
const [pane, field] = id.split(".");
const [oldGroup, oldField] = oldPath.split(".");

const bundleIds: Record<DictationApp, string> = {
  wisprFlow: "com.electron.wispr-flow",
  superwhisper: "com.superduper.superwhisper",
};

export const wisprScript = String.raw`function run(argv) {
  ObjC.import('AppKit');
  var operation = argv[0];
  var ids = JSON.parse(argv[1]);
  function applications(id) { return $.NSRunningApplication.runningApplicationsWithBundleIdentifier(id); }
  function running(id) { return Number(applications(id).count) > 0; }
  if (operation === 'read') return JSON.stringify(ids.filter(running));
  if (operation !== 'quit') throw Error('Invalid operation');
  for (var j = 0; j < ids.length; j++) {
    var apps = applications(ids[j]);
    for (var i = 0; i < Number(apps.count); i++) {
      apps.objectAtIndex(i).terminate;
    }
  }
  var deadline = Date.now() + 5000;
  while (ids.some(running) && Date.now() < deadline) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
  }
  return JSON.stringify(ids.some(running) ? 'refused' : 'closed');
}`;
export const macWispr: WisprProvider = (operation, signal, apps) => {
  if (process.platform !== "darwin")
    return Promise.resolve({ status: "disabled" });
  const targets = dictationApps.filter(
    (app) => operation === "read" || apps.includes(app),
  );
  if (!targets.length) return Promise.resolve({ status: "unknown" });
  const ids = targets.map((app) => bundleIds[app]);
  return new Promise<WisprResult>((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", wisprScript, operation, JSON.stringify(ids)],
      { timeout: 6500, maxBuffer: 4096, signal },
      (error, stdout) => {
        if (error) {
          resolve({ status: "unknown" });
          return;
        }
        try {
          const value = JSON.parse(stdout.trim());
          if (
            operation === "read" &&
            Array.isArray(value) &&
            value.every((id) => ids.includes(id))
          ) {
            const running = targets.filter((app) =>
              value.includes(bundleIds[app]),
            );
            resolve(
              running.length
                ? { status: "running", apps: running }
                : { status: "closed" },
            );
          } else {
            resolve({
              status:
                value === "closed" || value === "refused" ? value : "unknown",
            });
          }
        } catch {
          resolve({ status: "unknown" });
        }
      },
    );
  });
};
export async function savedWisprExperiment(home: string): Promise<boolean> {
  try {
    const config = JSON.parse(
      await readFile(
        process.env.APPARENT_CONFIG ??
          path.join(home, ".config/apparent/config.json"),
        "utf8",
      ),
    );
    const group = config?.[pane];
    if (
      group !== undefined &&
      (!group || typeof group !== "object" || Array.isArray(group))
    )
      return false;
    const canonical = group?.[field];
    const legacy = config?.[oldGroup]?.[oldField];
    const expected = config?.settingsCompatibility?.[id];
    const previousBuildEdited =
      typeof expected === "boolean" &&
      expected === canonical &&
      legacy !== expected;
    const state =
      canonical === undefined || previousBuildEdited
        ? 0
        : canonical === true
          ? 2
          : 1;
    return table[state][
      Number(typeof legacy === "boolean" ? legacy : fallback)
    ];
  } catch {
    return false;
  }
}

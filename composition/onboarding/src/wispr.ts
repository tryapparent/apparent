import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { wisprExperiment, type WisprResult } from "@apparent/onboarding/wispr";
export const wisprScript = String.raw`function run(argv) {
  ObjC.import('AppKit');
  function applications() { return $.NSRunningApplication.runningApplicationsWithBundleIdentifier('com.electron.wispr-flow'); }
  if (argv[0] !== 'read' && argv[0] !== 'quit') throw Error('Invalid operation');
  if (argv[0] === 'read') return JSON.stringify({status: applications().count > 0 ? 'running' : 'closed'});
  var apps = applications();
  for (var i = 0; i < apps.count; i++) {
    if (!apps.objectAtIndex(i).terminate) return JSON.stringify({status:Number(applications().count) === 0 ? 'closed' : 'refused'});
  }
  var deadline = Date.now() + 5000;
  while (applications().count > 0 && Date.now() < deadline) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));
  }
  return JSON.stringify({status: Number(applications().count) === 0 ? 'closed' : 'refused'});
}`;
export function macWispr(
  operation: "read" | "quit",
  signal: AbortSignal,
): Promise<WisprResult> {
  if (process.platform !== "darwin")
    return Promise.resolve({ status: "disabled" });
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", wisprScript, operation],
      { timeout: 6500, maxBuffer: 4096, signal },
      (error, stdout) => {
        if (error) {
          resolve({ status: "unknown" });
          return;
        }
        try {
          const value = JSON.parse(stdout.trim());
          resolve(
            ["running", "closed", "refused"].includes(value?.status)
              ? { status: value.status }
              : { status: "unknown" },
          );
        } catch {
          resolve({ status: "unknown" });
        }
      },
    );
  });
}
export async function savedWisprExperiment(home: string): Promise<boolean> {
  try {
    const config = JSON.parse(
      await readFile(path.join(home, ".config/apparent/config.json"), "utf8"),
    );
    return config?.experiments?.[wisprExperiment] === true;
  } catch {
    return false;
  }
}

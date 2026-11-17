import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "../snapshot.ts";

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function validateTools(snapshot: Snapshot): void {
  const file = "shared/enablement/dependency-policy/package-lock.json";
  const expected =
    snapshot.files.get(file) ??
    readFileSync(path.join(home, "package-lock.json"), "utf8");
  try {
    const lock = JSON.parse(expected);
    if (lock.lockfileVersion !== 3 || !lock.packages) throw Error();
    const installed = JSON.parse(
      readFileSync(path.join(home, "node_modules/.package-lock.json"), "utf8"),
    );
    for (const [entry, metadata] of Object.entries(lock.packages)) {
      if (!entry) continue;
      const spec = metadata as {
        version: string;
        integrity?: string;
        optional?: boolean;
        os?: string[];
        cpu?: string[];
      };
      if (!entry.startsWith("node_modules/") || entry.includes(".."))
        throw Error();
      const applicable = (allowed: string[] | undefined, current: string) =>
        !allowed ||
        (!allowed.includes("!" + current) &&
          (allowed.every((value) => value.startsWith("!")) ||
            allowed.includes(current)));
      if (
        spec.optional &&
        (!applicable(spec.os, process.platform) ||
          !applicable(spec.cpu, process.arch))
      )
        continue;
      if (!existsSync(path.join(home, entry, "package.json"))) throw Error();
      const actual = JSON.parse(
        readFileSync(path.join(home, entry, "package.json"), "utf8"),
      );
      if (
        actual.version !== spec.version ||
        installed.packages[entry]?.integrity !== spec.integrity
      )
        throw Error();
    }
  } catch {
    throw Error(
      "Installed tool closure does not match staged lock; run npm ci --ignore-scripts --prefix shared/enablement/dependency-policy before committing",
    );
  }
}

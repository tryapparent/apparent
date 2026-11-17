import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const binary = path.join(here, "../node_modules/.bin/biome");
let verified = false;
type Input = { file: string; text: string; old?: string };
type Diagnostic = {
  category: string;
  message: string;
  severity: string;
  location?: {
    path?: string;
    start?: { line: number };
    end?: { line: number };
  };
};
export function checkStyle(file: string, text: string, old?: string): string[] {
  return checkStyles([{ file, text, old }]);
}
export function checkStyles(inputs: Input[]): string[] {
  if (!inputs.length) return [];
  const scratch = mkdtempSync("/tmp/apparent-dev-staged-style-");
  try {
    if (!verified) {
      const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
      if (version.status !== 0 || version.stdout.trim() !== "Version: 2.6.8")
        throw Error(
          "Biome 2.6.8 missing/unusable; run npm ci --ignore-scripts --prefix shared/enablement/dependency-policy before committing",
        );
      verified = true;
    }
    copyFileSync(
      path.join(here, "biome.json"),
      path.join(scratch, "biome.json"),
    );
    const sources = new Map<
      string,
      { input: Input; content: string; before: boolean }
    >();
    for (const [index, input] of inputs.entries()) {
      for (const before of [false, true]) {
        const content = before ? input.old : input.text;
        if (content === undefined) continue;
        const directory = path.join(scratch, before ? "before" : "after");
        mkdirSync(directory, { recursive: true });
        const target = path.join(
          directory,
          index + "-" + path.basename(input.file),
        );
        writeFileSync(target, content);
        sources.set(target, { input, content, before });
      }
    }
    const result = spawnSync(
      binary,
      [
        "check",
        "--config-path=" + path.join(scratch, "biome.json"),
        "--reporter=json",
        "--max-diagnostics=none",
        scratch,
      ],
      { cwd: scratch, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.error || ![0, 1].includes(result.status!))
      throw Error("Biome could not completely inspect staged batch");
    const report = JSON.parse(result.stdout);
    if (
      report.summary.skipped ||
      report.summary.diagnosticsNotPrinted ||
      report.summary.unchanged + report.summary.changed !== sources.size + 1
    )
      throw Error("Biome did not completely check staged batch");
    const baseline = new Map<Input, Map<string, number>>();
    const candidate: { input: Input; key: string; diagnostic: Diagnostic }[] =
      [];
    for (const d of report.diagnostics as Diagnostic[]) {
      if (!["error", "fatal"].includes(d.severity)) continue;
      const entry =
        d.location?.path && sources.get(path.resolve(scratch, d.location.path));
      if (!entry) throw Error("Biome returned an unassigned staged diagnostic");
      let identity = "";
      if (d.category.startsWith("lint/")) {
        const start = d.location?.start?.line,
          end = d.location?.end?.line;
        if (!start || !end)
          throw Error("Biome lint diagnostic lacks source identity");
        identity = entry.content
          .split("\n")
          .slice(start - 1, end)
          .join("\n")
          .trim();
      }
      const key = d.category + ":" + d.message + ":" + identity;
      if (entry.before) {
        const allowance =
          baseline.get(entry.input) ?? new Map<string, number>();
        allowance.set(key, (allowance.get(key) ?? 0) + 1);
        baseline.set(entry.input, allowance);
      } else candidate.push({ input: entry.input, key, diagnostic: d });
    }
    const errors: string[] = [];
    for (const { input, key, diagnostic: d } of candidate) {
      const allowance = baseline.get(input),
        count = allowance?.get(key) ?? 0;
      if (count && (d.category === "format" || d.category.startsWith("lint/")))
        allowance!.set(key, count - 1);
      else
        errors.push(`${input.file}: staged style ${d.category}: ${d.message}`);
    }
    return errors;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

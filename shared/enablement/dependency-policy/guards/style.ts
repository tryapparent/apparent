import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const binary = path.join(here, "../node_modules/.bin/biome");
export function checkStyle(file: string, text: string, old?: string): string[] {
  const scratch = mkdtempSync("/tmp/apparent-dev-staged-style-");
  try {
    const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
    if (version.status !== 0 || version.stdout.trim() !== "Version: 2.6.8")
      throw new Error(
        "Biome 2.6.8 missing/unusable; run npm ci --ignore-scripts --prefix shared/enablement/dependency-policy before committing",
      );
    copyFileSync(
      path.join(here, "biome.json"),
      path.join(scratch, "biome.json"),
    );
    const target = path.join(scratch, path.basename(file));
    function inspect(content: string) {
      writeFileSync(target, content);
      const result = spawnSync(
        binary,
        [
          "check",
          "--config-path=" + path.join(scratch, "biome.json"),
          "--reporter=json",
          "--max-diagnostics=none",
          target,
        ],
        { cwd: scratch, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      );
      if (result.error || ![0, 1].includes(result.status!))
        throw new Error(
          `Biome could not check ${file}: ${result.error?.message ?? result.stderr}`,
        );
      const report = JSON.parse(result.stdout);
      if (
        report.summary.skipped ||
        report.summary.diagnosticsNotPrinted ||
        report.summary.unchanged + report.summary.changed !== 1
      )
        throw new Error(
          `Biome did not completely check ${file}: ${result.stderr}`,
        );
      return report.diagnostics.filter((d: any) =>
        ["error", "fatal"].includes(d.severity),
      ) as { category: string; message: string }[];
    }
    const candidate = inspect(text);
    const baseline = old === undefined ? [] : inspect(old);
    const allowance = new Map<string, number>();
    for (const d of baseline) {
      const key = d.category + ":" + d.message;
      allowance.set(key, (allowance.get(key) ?? 0) + 1);
    }
    const errors: string[] = [];
    for (const d of candidate) {
      const key = d.category + ":" + d.message;
      const count = allowance.get(key) ?? 0;
      if (count && (d.category === "format" || d.category.startsWith("lint/")))
        allowance.set(key, count - 1);
      else errors.push(`${file}: staged style ${d.category}: ${d.message}`);
    }
    return errors;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

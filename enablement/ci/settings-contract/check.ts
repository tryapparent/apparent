import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
} from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCatalog } from "./catalog.ts";
import { preferenceSource } from "../../../shared/enablement/ci/settings-inputs.ts";
import { sourceChecker } from "./source.ts";

const root = resolve(import.meta.dirname, "../../..");
const baselinePath = "enablement/ci/settings-contract/legacy-writers.json";

function parseBaseline(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every((row) => typeof row === "string"))
    throw Error("Invalid Settings legacy writer allowances");
  return parsed;
}

export function enforceBaseline(
  raw: readonly string[],
  baseline: readonly string[],
) {
  const limits = new Map<string, number>();
  for (const row of baseline) limits.set(row, (limits.get(row) ?? 0) + 1);
  const failures = [];
  for (const row of raw) {
    const count = limits.get(row) ?? 0;
    if (count === 0) failures.push(`Unregistered raw config writer: ${row}`);
    else limits.set(row, count - 1);
  }
  for (const [row, count] of limits) {
    if (count > 0)
      failures.push(`Remove superseded config writer allowance: ${row}`);
  }
  return failures;
}

export function enforceBaselineShrink(
  current: readonly string[],
  previous: readonly string[],
) {
  const limits = new Map<string, number>();
  for (const row of previous) limits.set(row, (limits.get(row) ?? 0) + 1);
  return current.flatMap((row) => {
    const allowance = limits.get(row) ?? 0;
    if (allowance === 0)
      return [`Cannot add raw config writer allowance: ${row}`];
    limits.set(row, allowance - 1);
    return [];
  });
}

function previousBaseline(cwd: string, base: string): string[] | undefined {
  if (!/^[\da-f]{40}(?:\^1)?$/.test(base) || /^0{40}$/.test(base)) return;
  const args: ExecFileSyncOptionsWithStringEncoding = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  };
  const paths = execFileSync(
    "git",
    ["ls-tree", "--name-only", base, "--", baselinePath],
    args,
  );
  if (paths.trim() !== baselinePath) return;
  return parseBaseline(
    execFileSync("git", ["show", `${base}:${baselinePath}`], args),
  );
}

export async function inspectRepository(cwd: string) {
  const inspect = await sourceChecker(loadCatalog(cwd));
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd, encoding: "utf8" },
  );
  const failures = [];
  const raw = [];
  for (const path of new Set(paths.split("\0").filter(preferenceSource))) {
    const absolute = resolve(cwd, path);
    const file = lstatSync(absolute, { throwIfNoEntry: false });
    if (!file) continue;
    if (!file.isFile()) throw Error(`${path}: expected ordinary source file`);
    const result = inspect(path, readFileSync(absolute, "utf8"));
    failures.push(...result.failures);
    raw.push(...result.raw);
  }
  return { failures, raw };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const baseline = parseBaseline(
    readFileSync(resolve(root, baselinePath), "utf8"),
  );
  const previous = previousBaseline(
    root,
    process.env.SETTINGS_CONTRACT_BASE ?? process.argv[2] ?? "",
  );
  const { failures, raw } = await inspectRepository(root);
  failures.push(...enforceBaseline(raw, baseline));
  if (previous) failures.push(...enforceBaselineShrink(baseline, previous));
  if (failures.length) {
    process.stderr.write(failures.sort().join("\n") + "\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "Settings catalog and guarded preference call sites passed.\n",
    );
  }
}

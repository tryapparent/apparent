import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const owners = ["capture", "connect", "public", "shared"];
const extensions = new Set([".css", ".tsx", ".ts", ".html", ".js", ".cjs"]);
const excludedDirectories = new Set([
  "test",
  "tests",
  "scripts",
  "enablement",
  "node_modules",
]);
const desktopElectron = "capture/desktop/ui/frontend/electron/";
const generatedDirectories = new Set([
  "agent-media",
  "record-completion",
  "record-media",
  "storage-owner",
]);
const generatedFiles = new Set([
  "connect.cjs",
  "storage-policy.cjs",
  "notes/lifecycle.cjs",
  "notes/presentation.cjs",
  "notes/record-transcription.cjs",
]);
const color =
  /#[\da-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)|\b(?:bg|text|border|ring|fill|stroke)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b|color-scheme\s*:\s*(?:light|dark)\s*[;}]/gu;
const named =
  /\b(?:background(?:Color|-color)?|color|fill|stroke|borderColor|outlineColor|border-color|outline-color|accent-color)\s*:\s*['"]?(?!var\b|url\b|none\b|transparent\b|currentColor\b|inherit\b|initial\b|unset\b|revert\b)([a-zA-Z]+)\b(?=\s*(?:['";}]|!important|$))/g;

type Baseline = Record<string, Record<string, number>>;

function isGenerated(path: string): boolean {
  if (!path.startsWith(desktopElectron)) return false;
  const output = path.slice(desktopElectron.length);
  return (
    generatedFiles.has(output) ||
    generatedDirectories.has(output.split("/")[0]) ||
    /^(?:pill|settings)\/[^/]+\.cjs$/.test(output)
  );
}

function* archivePaths(root: string, directory: string): Generator<string> {
  if (
    !statSync(join(root, directory), { throwIfNoEntry: false })?.isDirectory()
  )
    return;
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    if (
      entry.name.startsWith(".") ||
      entry.name.startsWith("dist") ||
      excludedDirectories.has(entry.name)
    )
      continue;
    const path = directory + "/" + entry.name;
    if (isGenerated(path)) continue;
    if (entry.isDirectory()) yield* archivePaths(root, path);
    else yield path;
  }
}

function sourcePaths(root: string, selected: string[]): string[] {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
  });
  if (git.status === 0 && realpathSync(git.stdout.trimEnd()) === root) {
    return execFileSync(
      "git",
      [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ...selected,
      ],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    ).split("\0");
  }
  return selected.flatMap((directory) =>
    Array.from(archivePaths(root, directory)),
  );
}

function violations(
  root: string,
  selected: string[],
  baseline: Baseline,
): string[] {
  const failures: string[] = [];
  for (const path of [...new Set(sourcePaths(root, selected))].sort()) {
    if (
      !extensions.has(extname(path)) ||
      path === "shared/ui/src/tokens.css" ||
      path.split("/").some((part) => excludedDirectories.has(part))
    )
      continue;
    const file = join(root, path);
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    const source = readFileSync(file, "utf8");
    const matches = [...source.matchAll(color)]
      .map(([match]) => match)
      .concat([...source.matchAll(named)].map(([, name]) => "named:" + name));
    const counts = new Map<string, number>();
    for (const match of matches)
      counts.set(match, (counts.get(match) ?? 0) + 1);
    for (const [literal, count] of [...counts].sort()) {
      const limit = baseline[path]?.[literal] ?? 0;
      if (count > limit)
        failures.push(
          path + ": " + literal + " (" + count + " > " + limit + ")",
        );
    }
  }
  return failures;
}

const { values } = parseArgs({
  options: { owner: { type: "string" }, help: { type: "boolean", short: "h" } },
});
const owner = values.owner;
if (values.help) {
  console.log("Usage: check-theme [--owner {public,connect,capture}]");
} else if (
  owner !== undefined &&
  (!owners.includes(owner) || owner === "shared")
) {
  console.error("Expected --owner public, connect, or capture.");
  process.exitCode = 2;
} else {
  const root = realpathSync(resolve(import.meta.dirname, "../../.."));
  const baseline = JSON.parse(
    readFileSync(join(import.meta.dirname, "legacy-colors.json"), "utf8"),
  ) as Baseline;
  const failures = violations(
    root,
    owner ? [owner, "shared"] : owners,
    baseline,
  );
  if (failures.length) {
    console.error(
      "New fixed frontend colors: use shared/ui/src/tokens.css semantic tokens.\n" +
        failures.join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log("Shared theme color contract passed.");
  }
}

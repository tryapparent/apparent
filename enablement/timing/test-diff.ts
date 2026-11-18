import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const commit = (ref: string) =>
  git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();

const suite = (path: string) =>
  /\.(test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|(?:^|\/)tests\/[^/]+\.rs$/.test(
    path,
  );
const fixture = (path: string) =>
  !suite(path) &&
  !/\.md$/i.test(path) &&
  /(?:^|\/)(?:fixtures?|__fixtures__|testdata|mocks?|__mocks__)\/|(?:^|[\/_\-.])fixtures?\.[^/]+$/.test(
    path,
  );

function timing(path: string, base: string, head: string) {
  const observations = [];
  let otherRevisionRows = 0;
  let startRows = 0;
  let invalidRows = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const { schema, sha, state, label, started, elapsed_ms, code, signal } =
        JSON.parse(line);
      if (
        schema !== 1 ||
        typeof label !== "string" ||
        !/^[a-z0-9-]{1,64}$/.test(label) ||
        !Number.isSafeInteger(elapsed_ms) ||
        elapsed_ms < 0 ||
        (state !== undefined &&
          !["started", "finished", "spawn-failed"].includes(state))
      ) {
        invalidRows++;
      } else if (sha !== base && sha !== head) {
        otherRevisionRows++;
      } else if (state === "started") {
        startRows++;
      } else {
        observations.push({
          sha,
          label,
          started: typeof started === "string" ? started : null,
          elapsedMs: elapsed_ms,
          state: state ?? "observed",
          exitCode: Number.isInteger(code) ? code : null,
          signal: typeof signal === "string" ? signal : null,
        });
      }
    } catch {
      invalidRows++;
    }
  }
  return { observations, otherRevisionRows, startRows, invalidRows };
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      head: { type: "string" },
      timing: { type: "string" },
    },
  });
  if (!values.base || !values.head) {
    throw Error(
      "Usage: test-diff.ts --base <commit> --head <commit> [--timing <jsonl>]",
    );
  }
  const base = commit(values.base);
  const head = commit(values.head);
  const audit = readFileSync(
    new URL("../docs/test-audit/inventory.md", import.meta.url),
    "utf8",
  );
  const inventoried = new Set(
    [
      ...audit.matchAll(
        /^\| [^|]+ \| (.*?) \| (?:source candidate|support\/scenario) \|/gm,
      ),
    ].map((row) => row[1]),
  );
  const fields = git(
    "diff",
    "--raw",
    "--no-abbrev",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "-z",
    base,
    head,
    "--",
  ).split("\0");
  const suiteFiles = [];
  const fixtureFiles = [];
  const otherInventoryCandidates = [];
  let fixtureDeltaBytes = 0;
  for (let i = 0; i < fields.length - 1; ) {
    const [oldMode, newMode, oldBlob, newBlob, status] = fields[i++]
      .slice(1)
      .split(" ");
    const path = fields[i++];
    const from = status.startsWith("R") ? path : null;
    const to = from ? fields[i++] : path;
    const before = /^100(644|755)$/.test(oldMode) ? (from ?? path) : null;
    const after = /^100(644|755)$/.test(newMode) ? to : null;
    const change = { status, before, after };
    const isSuite = (before && suite(before)) || (after && suite(after));
    const wasFixture = before && fixture(before);
    const isFixture = after && fixture(after);
    if (isSuite) suiteFiles.push(change);
    if (wasFixture || isFixture) {
      const beforeBytes = wasFixture
        ? Number(git("cat-file", "-s", oldBlob))
        : 0;
      const afterBytes = isFixture ? Number(git("cat-file", "-s", newBlob)) : 0;
      fixtureFiles.push({ ...change, beforeBytes, afterBytes });
      fixtureDeltaBytes += afterBytes - beforeBytes;
    } else if (
      !isSuite &&
      ((before && inventoried.has(before)) || (after && inventoried.has(after)))
    ) {
      otherInventoryCandidates.push(change);
    }
  }
  console.log(
    JSON.stringify(
      {
        base,
        head,
        suiteFiles,
        fixtureFiles,
        fixtureDeltaBytes,
        otherInventoryCandidates,
        commandTiming: values.timing ? timing(values.timing, base, head) : null,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

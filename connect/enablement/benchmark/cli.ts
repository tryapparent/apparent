import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  type MeasuredWait,
  measuredWait,
} from "../../../shared/enablement/performance/measurement.ts";

const [configPath, id, ...extra] = process.argv.slice(2);
const { APPARENT_BENCH_BINARY: binary, APPARENT_BENCH_RESULTS: directory } =
  process.env;
if (
  !binary ||
  !isAbsolute(binary) ||
  !directory ||
  !isAbsolute(directory) ||
  !configPath ||
  !isAbsolute(configPath) ||
  extra.length
) {
  throw Error(
    "Connect CLI measurement requires a pinned executable, private job and local fixture",
  );
}
const expected = JSON.parse(
  readFileSync(join(directory, "connect-assets.json"), "utf8"),
) as {
  expectedFiles: Record<string, string>;
  selectedFiles: string[];
  summaryMarker: string;
};
const fixture = { ...expected, config: configPath, id };
if (
  !/^[0-9a-f]{32}$/.test(fixture.id) ||
  !isAbsolute(fixture.config) ||
  !fixture.summaryMarker ||
  !fixture.selectedFiles.length ||
  !/^[0-9a-f]{64}$/.test(fixture.expectedFiles["apparent.json"]) ||
  !fixture.selectedFiles.every((file) =>
    Object.hasOwn(fixture.expectedFiles, file),
  ) ||
  !Object.values(fixture.expectedFiles).every((hash) =>
    /^[0-9a-f]{64}$/.test(hash),
  )
) {
  throw new Error("Invalid isolated Connect fixture");
}
const config = JSON.parse(readFileSync(fixture.config, "utf8"));
const server = new URL(config.cloud.server);
if (
  !["http:", "https:"].includes(server.protocol) ||
  !["127.0.0.1", "[::1]", "localhost"].includes(server.hostname) ||
  server.username ||
  server.password ||
  server.pathname !== "/" ||
  server.search ||
  server.hash
) {
  throw new Error("Connect benchmark requires an isolated loopback origin");
}

const job = mkdtempSync(join(directory, "connect-cli-"));
const env = {
  ...process.env,
  APPARENT_CONFIG: fixture.config,
  APPARENT_CAPTURES_DIR: join(job, "captures"),
  TMPDIR: job,
};
const waits: Record<string, MeasuredWait> = {};
const run = (args: string[], cwd: string) =>
  execFileSync(binary, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 150_000,
  });
const version = run(["--version"], job).trim();

function measure(
  id: string,
  cwd: string,
  args: string[],
  verify: (stdout: string) => void,
) {
  const start = performance.now();
  const stdout = run(args, cwd);
  const end = performance.now();
  verify(stdout);
  waits["inspect-remote/" + id] = measuredWait(start, end);
}

function verifyFiles(root: string, files: string[]) {
  for (const file of files) {
    const path = resolve(root, file);
    const leaf = relative(root, path);
    if (
      !leaf ||
      leaf.startsWith("../") ||
      isAbsolute(leaf) ||
      !lstatSync(path).isFile()
    ) {
      throw new Error("Invalid returned fixture asset");
    }
    const actual = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    if (actual !== fixture.expectedFiles[file])
      throw new Error("Returned fixture asset digest differs");
  }
}

const all = Object.keys(fixture.expectedFiles);
const inspectWork = join(job, "inspect");
mkdirSync(inspectWork, { mode: 0o700 });
const bundle = join(inspectWork, fixture.id + ".apparent");
const verifySummary = (stdout: string) => {
  if (
    !stdout.startsWith("[apparent ") ||
    !stdout.includes(fixture.summaryMarker)
  ) {
    throw new Error("Missing usable fixture summary");
  }
  verifyFiles(bundle, all);
};
measure("inspect-first", inspectWork, ["inspect", fixture.id], verifySummary);
measure("inspect-cached", inspectWork, ["inspect", bundle], verifySummary);
for (const selected of [false, true]) {
  const kind = selected ? "selected" : "full";
  for (const pass of ["first", "repeat"]) {
    const name = "fetch-" + kind + "-" + pass;
    const output = join(job, name + (selected ? "" : ".apparent"));
    const args = ["fetch", fixture.id, "--out", output];
    if (selected)
      args.push(...fixture.selectedFiles.flatMap((file) => ["--file", file]));
    measure(name, job, args, () =>
      verifyFiles(output, selected ? fixture.selectedFiles : all),
    );
  }
}
const receipt = join(job, "connect-cli-waits.json");
writeFileSync(receipt, JSON.stringify({ version, waits }, null, 2) + "\n", {
  mode: 0o600,
});
console.log(receipt);

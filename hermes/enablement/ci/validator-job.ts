import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import {
  restoreDownloads,
  snapshot,
} from "../../distribution/cache/downloads.ts";
import { check, install, prepare, revision } from "./validator.ts";

const job = "/tmp/apparent-dev-hermes-validator-ci";
const runtime = path.join(job, "runtime");
const profile = path.join(job, "profile");
const cache = path.join(profile, "cache", "uv");
const downloads = path.join(job, "downloads");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw Error(`Missing ${name}`);
  return value;
}

function run(
  command: string,
  args: string[],
  cwd = process.cwd(),
  env = process.env,
) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}

function prepareCandidate() {
  const output = required("GITHUB_OUTPUT");
  mkdirSync(job, { mode: 0o700 });
  run("git", ["init", runtime]);
  run(
    "git",
    [
      "remote",
      "add",
      "origin",
      "https://github.com/NousResearch/hermes-agent.git",
    ],
    runtime,
  );
  run("git", ["fetch", "--depth", "1", "origin", revision], runtime);
  run("git", ["checkout", "--detach", "FETCH_HEAD"], runtime);
  if (existsSync(path.join(runtime, ".venv")))
    throw Error("Validator environment must be fresh");
  prepare(job);
  appendFileSync(output, `job=${job}\n`);
  const identity = readFileSync(
    path.join(job, "validator-identity.json"),
    "utf8",
  ).trim();
  run(
    process.execPath,
    [
      "--experimental-strip-types",
      "hermes/distribution/cache/downloads.ts",
      "key",
      runtime,
      ".github/workflows/hermes.yml",
      output,
    ],
    process.cwd(),
    {
      ...process.env,
      VALIDATOR_IDENTITY: [
        revision,
        identity,
        required("RUNNER_OS"),
        required("RUNNER_ARCH"),
        required("MATRIX_OS"),
      ].join("|"),
    },
  );
}

async function installCandidate() {
  if (existsSync(downloads)) await restoreDownloads(downloads, cache);
  install(job);
  appendFileSync(
    required("GITHUB_PATH"),
    `${path.join(runtime, ".venv", "bin")}\n`,
  );
}

function validateCandidate() {
  const source = path.resolve(required("PACKAGE"));
  const env = { ...process.env, HERMES_HOME: profile };
  const plugin = path.join(profile, "plugins", "apparent");
  if (existsSync(path.dirname(plugin)))
    throw Error("Plugin profile must be fresh");
  check(job);
  const extracted = mkdtempSync("/tmp/apparent-dev-hermes-profile-");
  const files = readdirSync(source);
  const sums = files
    .filter((file) => file.endsWith(".sha256"))
    .map((file) => `./${file}`);
  const archives = files.filter((file) => file.endsWith(".tar.gz"));
  if (archives.length !== 1 || !sums.length)
    throw Error("Expected a single archive and its checksum");
  run("shasum", ["-a", "256", "-c", ...sums], source, env);
  run(
    "tar",
    ["-xzf", path.join(source, archives[0]), "-C", extracted],
    source,
    env,
  );
  run(
    process.execPath,
    [path.join(extracted, "install.cjs"), "--profile", profile],
    source,
    env,
  );
  run("hermes", ["plugins", "validate", plugin, "--install-deps"], source, env);
  run("hermes", ["plugins", "doctor", plugin, "--ci"], source, env);
  check(job);
}

switch (process.argv[2]) {
  case "prepare":
    prepareCandidate();
    break;
  case "install":
    await installCandidate();
    break;
  case "snapshot":
    await snapshot(cache, downloads);
    break;
  case "validate":
    validateCandidate();
    break;
  default:
    throw Error("Expected prepare, install, snapshot or validate");
}

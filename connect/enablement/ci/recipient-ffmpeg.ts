import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const installArgs = ["-y", "--no-install-recommends", "install", "ffmpeg"];
const apt = (args: string[], capture = false) =>
  execFileSync("sudo", ["env", "LC_ALL=C", "apt-get", ...args], {
    encoding: "utf8",
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });

export function packageHashes(output: string) {
  const hashes = new Map<string, string>();
  for (const line of output
    .split("\n")
    .filter((line) => line.startsWith("'"))) {
    const entry =
      /^'[^']+' ([a-zA-Z0-9+.%_~-]+\.deb) \d+ SHA256:([0-9a-f]{64})$/.exec(
        line,
      );
    if (!entry || hashes.has(entry[1]))
      throw new Error("Unexpected APT archive metadata: " + line);
    hashes.set(entry[1], entry[2]);
  }
  return [...hashes].sort(([a], [b]) => a.localeCompare(b, "en"));
}

export function matchesArchive(path: string, expected: string) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return false;
  return execFileSync("sha256sum", ["--", path], {
    encoding: "utf8",
  }).startsWith(expected + " ");
}

function prepare(mode: string) {
  const os = readFileSync("/etc/os-release", "utf8");
  if (
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    !/^ID=ubuntu$/m.test(os) ||
    !/^VERSION_CODENAME=noble$/m.test(os)
  ) {
    throw new Error("Recipient FFmpeg preparation requires Ubuntu 24.04 x64");
  }
  const base = join(process.env.RUNNER_TEMP!, "apparent-recipient-ffmpeg");
  const spool = join(base, "spool");
  const archives = join(base, "archives");
  const options = [
    "-o",
    "Acquire::ForceHash=sha256",
    "-o",
    "Dir::Cache::archives=" + spool,
  ];

  if (mode === "plan") {
    mkdirSync(base);
    mkdirSync(spool);
    chmodSync(base, 0o755);
    chmodSync(spool, 0o755);
    apt(["update"]);
    const manifest = JSON.stringify(
      packageHashes(apt([...options, "--print-uris", ...installArgs], true)),
    );
    writeFileSync(join(base, "manifest.json"), manifest);
    if (manifest !== "[]") {
      const identity = createHash("sha256").update(manifest).digest("hex");
      appendFileSync(
        process.env.GITHUB_OUTPUT!,
        "key=recipient-ffmpeg-noble-amd64-v1-" + identity + "\n",
      );
    }
    return;
  }

  if (mode !== "install") throw new Error("Expected plan or install");
  const manifest: [string, string][] = JSON.parse(
    readFileSync(join(base, "manifest.json"), "utf8"),
  );
  let cached = 0;
  if (lstatSync(archives, { throwIfNoEntry: false })?.isDirectory()) {
    for (const [name, hash] of manifest) {
      const candidate = join(archives, name);
      if (!lstatSync(candidate, { throwIfNoEntry: false })?.isFile()) continue;
      const staged = join(spool, name);
      copyFileSync(candidate, staged);
      if (matchesArchive(staged, hash)) cached++;
      else rmSync(staged);
    }
  }
  console.log(
    `Verified ${cached}/${manifest.length} Ubuntu package archives from cache`,
  );
  apt([...options, "--download-only", ...installArgs]);
  for (const [name, hash] of manifest) {
    if (!matchesArchive(join(spool, name), hash))
      throw new Error("APT archive verification failed: " + name);
  }
  if (manifest.length && process.env.RECIPIENT_ARCHIVE_HIT !== "true") {
    rmSync(archives, { recursive: true, force: true });
    mkdirSync(archives);
    for (const [name] of manifest)
      copyFileSync(join(spool, name), join(archives, name));
  }
  apt([...options, "--no-download", ...installArgs]);
  execFileSync("dpkg-query", ["-W", "ffmpeg"], { stdio: "inherit" });
}

if (import.meta.main) prepare(process.argv[2]);

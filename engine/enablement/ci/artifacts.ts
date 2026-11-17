import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const targets = [
  "linux-x64",
  "linux-arm64",
  "darwin-arm64",
  "darwin-x64",
];

export function sdkDigest(directory: string): void {
  const files = readdirSync(directory).filter((file) =>
    /^apparent-engine-sdk-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/.test(file),
  );
  if (files.length !== 1) throw Error("Expected one qualified Engine SDK");
  const file = files[0];
  const digest = createHash("sha256")
    .update(readFileSync(join(directory, file)))
    .digest("hex");
  writeFileSync(join(directory, `${file}.sha256`), `${digest}  ${file}\n`);
}

export function validateArtifacts(directory: string, candidate: string): void {
  if (!/^[a-f0-9]{40}$/.test(candidate))
    throw Error("Invalid Engine candidate SHA");
  const inventory = readdirSync(directory).sort();
  const sdk = inventory.filter((file) =>
    /^apparent-engine-sdk-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/.test(file),
  );
  if (sdk.length !== 1) throw Error("Expected one qualified Engine SDK");
  const archives = [
    ...sdk,
    ...targets.map((target) => `engine-media-${target}.tar.gz`),
  ];
  const expected = archives.flatMap((file) => [file, `${file}.sha256`]).sort();
  if (JSON.stringify(inventory) !== JSON.stringify(expected))
    throw Error("Incomplete or unexpected Engine artifact inventory");
  for (const file of archives) {
    const digest = createHash("sha256")
      .update(readFileSync(join(directory, file)))
      .digest("hex");
    if (
      readFileSync(join(directory, `${file}.sha256`), "utf8") !==
      `${digest}  ${file}\n`
    )
      throw Error(`Invalid Engine digest: ${file}`);
  }
  for (const target of targets) {
    const name = `engine-media-${target}`;
    const manifest = JSON.parse(
      execFileSync(
        "tar",
        ["-xOf", join(directory, `${name}.tar.gz`), `${name}/manifest.json`],
        { encoding: "utf8" },
      ),
    );
    const [platform, arch] = target.split("-");
    if (
      manifest.schema !== 1 ||
      manifest.sourceCommit !== candidate ||
      manifest.sourceDirty !== false ||
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      `apparent-engine-sdk-${manifest.sdkVersion}.tgz` !== sdk[0] ||
      !manifest.capabilities?.includes("movie-probe/1") ||
      !manifest.capabilities?.includes("movie-frames/1")
    ) {
      throw Error(`Unqualified Engine manifest: ${target}`);
    }
    const files = [
      "apparent-engine-media",
      "apparent-engine-frames",
      "LICENSE",
    ];
    if (platform === "darwin")
      files.push("apparent-engine-probe", "apparent-engine-frames-native");
    if (
      !Array.isArray(manifest.files) ||
      JSON.stringify(
        manifest.files.map((file: { path: string }) => file.path).sort(),
      ) !== JSON.stringify(files.sort())
    ) {
      throw Error(`Incomplete Engine runtime: ${target}`);
    }
    for (const file of manifest.files) {
      const bytes = execFileSync(
        "tar",
        ["-xOf", join(directory, `${name}.tar.gz`), `${name}/${file.path}`],
        { maxBuffer: 128 * 1024 * 1024 },
      );
      if (
        !bytes.length ||
        file.mode !== (file.path === "LICENSE" ? 0o644 : 0o755) ||
        createHash("sha256").update(bytes).digest("hex") !== file.sha256
      )
        throw Error(`Invalid Engine runtime: ${target}/${file.path}`);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [directory, candidate] = process.argv.slice(2);
  validateArtifacts(directory, candidate);
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { distribution } from "../distribution.ts";

export const repository = "tryapparent/apparent";
export const gh = (args: string[]) =>
  execFileSync("gh", args, { encoding: "utf8", timeout: 120_000 });
export async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
export async function verified(directory: string) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest-macos-aarch64.json"), "utf8"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(
    manifest.producer?.workflow,
    ".github/workflows/verification.yml",
  );
  assert.match(manifest.producer?.runId ?? "", /^\d+$/);
  assert(
    Number.isSafeInteger(manifest.producer?.runAttempt) &&
      manifest.producer.runAttempt > 0,
  );
  assert.match(manifest.producer?.controlSha ?? "", /^[a-f0-9]{40}$/);
  assert.equal(manifest.repository, repository);
  assert(["stable", "main", "mac-nightly"].includes(manifest.channel));
  assert.equal(manifest.platform, "macos");
  assert.equal(manifest.architecture, "aarch64");
  assert.deepEqual(manifest.evidence, {
    nativeChecks: true,
    signing: true,
    notarization: true,
  });
  const entries = manifest.files as {
    name: string;
    sha256: string;
    size: number;
  }[];
  assert(
    Array.isArray(entries) &&
      new Set(entries.map((f) => f.name)).size === entries.length,
  );
  for (const entry of entries) {
    assert.equal(basename(entry.name), entry.name);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    const file = join(directory, entry.name),
      stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(stat.size, entry.size);
    assert.equal(await hash(file), entry.sha256);
  }
  const raw = JSON.parse(
    readFileSync(join(directory, "mac-update.json"), "utf8"),
  );
  for (const name of [
    "mac-update.json",
    ...(manifest.channel === "stable" ? ["apparent.rb"] : []),
    "sparkle-signature-attributes.txt",
    raw.zipName,
    raw.dmgName,
    raw.dmgName + ".sha256",
  ])
    assert(entries.some((entry) => entry.name === name));
  const { metadata, cask } = distribution(
    {
      APPARENT_VERSION: manifest.version,
      RELEASE_TAG: manifest.tag,
      CANDIDATE_SHA: manifest.sourceSha,
      APPARENT_PREVIEW_BUILD_NUMBER: raw.buildNumber,
      RELEASE_CHANNEL: manifest.channel,
    },
    await hash(join(directory, raw.dmgName)),
    readFileSync(join(directory, "sparkle-signature-attributes.txt"), "utf8"),
    lstatSync(join(directory, raw.zipName)).size,
  );
  assert.deepEqual(raw, metadata);
  if (cask)
    assert.equal(readFileSync(join(directory, "apparent.rb"), "utf8"), cask);
  assert.equal(
    readFileSync(join(directory, metadata.dmgName + ".sha256"), "utf8"),
    `${metadata.dmgSha256}  ${metadata.dmgName}\n`,
  );
  const ref = JSON.parse(
    gh(["api", `repos/${repository}/git/ref/tags/${metadata.tag}`]),
  );
  assert.equal(ref.object?.type, "commit");
  assert.equal(ref.object.sha, metadata.sourceSha);
  const release = JSON.parse(
    gh(["api", `repos/${repository}/releases/tags/${metadata.tag}`]),
  );
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, metadata.channel !== "stable");
  assert.equal(release.tag_name, metadata.tag);
  const scratch = mkdtempSync(join(tmpdir(), "apparent-dev-mac-publication-"));
  try {
    for (const name of [
      metadata.dmgName,
      metadata.dmgName + ".sha256",
      metadata.zipName,
    ]) {
      const entry = entries.find((entry) => entry.name === name)!;
      const assets = release.assets.filter(
        (asset: { name: string }) => asset.name === name,
      );
      assert.equal(assets.length, 1);
      assert.equal(
        assets[0].browser_download_url,
        `https://github.com/${repository}/releases/download/${metadata.tag}/${name}`,
      );
      assert.equal(assets[0].digest, "sha256:" + entry.sha256);
      gh([
        "release",
        "download",
        metadata.tag!,
        "--repo",
        repository,
        "--pattern",
        name,
        "--dir",
        scratch,
      ]);
      assert.equal(await hash(join(scratch, name)), entry.sha256);
      assert.equal(lstatSync(join(scratch, name)).size, entry.size);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { metadata, cask };
}

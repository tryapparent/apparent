import { homebrewCask } from "./publication/homebrew.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function distribution(
  env: NodeJS.ProcessEnv,
  checksum: string,
  signatureAttributes: string,
  zipSize: number,
) {
  const version = env.APPARENT_VERSION;
  assert.match(version ?? "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(env.RELEASE_TAG, `v${version}`);
  assert.match(env.CANDIDATE_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.match(env.APPARENT_PREVIEW_BUILD_NUMBER ?? "", /^\d+\.\d+$/);
  assert.match(checksum, /^[a-f0-9]{64}$/);
  const signature =
    /^sparkle:edSignature="([A-Za-z0-9+/]+={0,2})" length="(\d+)"$/.exec(
      signatureAttributes.trim(),
    );
  assert(
    signature && Buffer.from(signature[1], "base64").length === 64,
    "Invalid Sparkle signature attributes",
  );
  assert.equal(Number(signature[2]), zipSize);
  const dmgName = `Apparent-Preview-${version}-arm64.dmg`;
  const zipName = `Apparent-Preview-${version}-arm64.zip`;
  const base = `https://github.com/tryapparent/apparent/releases/download/${env.RELEASE_TAG}`;
  const metadata = {
    schemaVersion: 1,
    sourceSha: env.CANDIDATE_SHA,
    version,
    tag: env.RELEASE_TAG,
    channel: "stable",
    buildNumber: env.APPARENT_PREVIEW_BUILD_NUMBER,
    bundleIdentifier: "dev.simonvanlaak.apparent.preview",
    feedUrl:
      "https://raw.githubusercontent.com/tryapparent/apparent/preview-mac-feed/appcast.xml",
    dmgName,
    dmgSha256: checksum,
    dmgUrl: `${base}/${dmgName}`,
    zipName,
    zipUrl: `${base}/${zipName}`,
    signatureAttributes: signatureAttributes.trim(),
    edSignature: signature[1],
    length: zipSize,
  };
  const cask = homebrewCask(version!, checksum, env.RELEASE_TAG);
  return { metadata, cask };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  assert(directory);
  const dmg = join(
    directory,
    `Apparent-Preview-${process.env.APPARENT_VERSION}-arm64.dmg`,
  );
  const zip = join(
    directory,
    `Apparent-Preview-${process.env.APPARENT_VERSION}-arm64.zip`,
  );
  const checksum = createHash("sha256").update(readFileSync(dmg)).digest("hex");
  const attributes = readFileSync(
    join(directory, "sparkle-signature-attributes.txt"),
    "utf8",
  );
  const { metadata, cask } = distribution(
    process.env,
    checksum,
    attributes,
    statSync(zip).size,
  );
  writeFileSync(
    join(directory, "mac-update.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  writeFileSync(join(directory, "apparent.rb"), cask);
}

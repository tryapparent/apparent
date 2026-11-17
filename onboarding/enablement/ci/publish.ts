import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const output = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
const source = process.env.GITHUB_SHA;
if (
  !output ||
  repo !== "tryapparent/apparent" ||
  process.env.GITHUB_REF !== "refs/heads/main" ||
  process.env.GITHUB_EVENT_NAME !== "push" ||
  !source?.match(/^[0-9a-f]{40}$/)
) {
  throw Error("Onboarding publication requires the canonical main push");
}
const receiptFile = join(output, "package-receipt.json");
const {
  name,
  version,
  archive,
  sha256,
  source: built,
} = JSON.parse(readFileSync(receiptFile, "utf8"));
if (
  built !== source ||
  name !== "@apparent/onboarding" ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
  archive !== `apparent-onboarding-${version}.tgz`
) {
  throw Error("Onboarding artifact identity does not match the main push");
}
const bundle = join(output, archive);
const checksum = bundle + ".sha256";
if (
  createHash("sha256").update(readFileSync(bundle)).digest("hex") !== sha256 ||
  readFileSync(checksum, "utf8") !== `${sha256}  ${archive}\n`
) {
  throw Error("Onboarding artifact does not match its checksum");
}
const tag = `onboarding-v${version}`;
const existing = spawnSync(
  "gh",
  ["release", "view", tag, "--repo", repo, "--json", "assets,isDraft"],
  { encoding: "utf8" },
);
if (existing.error) throw existing.error;
if (existing.status === 0) {
  const release = JSON.parse(existing.stdout);
  if (
    !release.isDraft &&
    release.assets.some(
      (asset: { name: string; digest: string }) =>
        asset.name === archive && asset.digest === `sha256:${sha256}`,
    )
  ) {
    console.log(
      `Onboarding ${version} is already published with these package bytes`,
    );
    process.exit(0);
  }
  throw Error(
    `Onboarding release ${tag} exists with a different or unfinished artifact`,
  );
}
if (!/release not found/i.test(existing.stderr))
  throw Error(
    existing.stderr.trim() || "Could not verify Onboarding release state",
  );
const ref = spawnSync(
  "git",
  ["ls-remote", "--exit-code", "origin", `refs/tags/${tag}`],
  { encoding: "utf8" },
);
if (ref.error) throw ref.error;
if (ref.status !== 2)
  throw Error(`Could not establish that release tag ${tag} is unused`);
execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--target",
    source,
    "--latest=false",
    "--title",
    `Onboarding package ${version}`,
    "--notes",
    `Independent Node package for Apparent Onboarding policy. Source: ${source}. Verify the checksum before installing the tarball.`,
    bundle,
    checksum,
    receiptFile,
  ],
  { stdio: "inherit" },
);

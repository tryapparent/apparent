import { compareVersions, cargoVersion } from "./version.ts";
import type { Release, Asset, Ref } from "./github.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { restore } from "./candidate.ts";
import { api, gh, optional, pages } from "./github.ts";
import type { Manifest } from "./manifest.ts";
import { candidateIdentity, repository } from "./manifest.ts";

function isAncestor(ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  ]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw Error(
    `Could not compare Main source history: ${result.stderr?.toString()}`,
  );
}

export function assertAssets(
  release: Pick<Release, "assets">,
  manifests: Manifest[],
  complete = false,
): void {
  const expected = manifests.flatMap((m) => m.files);
  for (const asset of release.assets) {
    const file = expected.find((f) => f.name === asset.name);
    if (
      !file ||
      asset.digest !== `sha256:${file.sha256}` ||
      asset.size !== file.size ||
      asset.state !== "uploaded"
    )
      throw Error("Release contains unexpected or altered bytes");
  }
  if (complete && release.assets.length !== expected.length)
    throw Error("Release assets incomplete");
}

function recordOutput(lines: string): void {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

function recordPublicAssets(candidate: Manifest, manifests: Manifest[]): void {
  const downloads = manifests
    .flatMap((manifest) => manifest.files)
    .filter(({ name }) => /\.(AppImage|dmg|zip)$/.test(name))
    .map(({ name, size }) => ({ name, size }));
  recordOutput(
    `tag=${candidate.tag}\ndownloads=${JSON.stringify(downloads)}\n`,
  );
}

export async function publish(
  runId: string,
  attempt: number,
  directory: string,
): Promise<void> {
  const mode = process.env.RELEASE_CHANNEL || "stable";
  const pairedMain = mode === "paired-main";
  const channel = pairedMain ? "main" : mode;
  if (channel !== "main" && channel !== "mac-main" && channel !== "stable")
    throw Error("Invalid publication channel");
  const manifests = await restore(
    runId,
    attempt,
    directory,
    channel,
    pairedMain,
  );
  const candidate = candidateIdentity(manifests, channel, pairedMain);
  const prerelease = channel !== "stable";
  recordOutput(`source_sha=${candidate.sourceSha}\n`);
  execFileSync(
    "python3",
    [
      "enablement/release_gate.py",
      "--platform",
      "linux",
      "--sha",
      candidate.sourceSha,
    ],
    { stdio: "inherit" },
  );
  if (cargoVersion(candidate.sourceSha) !== candidate.version)
    throw Error("Candidate Cargo version mismatch");
  const existingTag = optional<Ref>(`git/ref/tags/${candidate.tag}`);
  if (
    existingTag &&
    (existingTag.object.type !== "commit" ||
      existingTag.object.sha !== candidate.sourceSha)
  )
    throw Error("Release tag/source mismatch");
  const releases = pages<Release>("releases");
  let release = releases.find((r) => r.tag_name === candidate.tag);
  if (release && !existingTag)
    throw Error("Existing release has no source tag");
  if (channel === "main") {
    for (const current of releases) {
      const prior = /^linux-main-v2-([a-f0-9]{40})$/.exec(
        current.tag_name,
      )?.[1];
      if (
        !prior ||
        prior === candidate.sourceSha ||
        current.draft ||
        !current.prerelease
      )
        continue;
      if (
        isAncestor(prior, "origin/main") &&
        isAncestor(candidate.sourceSha, prior)
      ) {
        recordOutput(`superseded_tag=${current.tag_name}\n`);
        throw Error(`Newer Main release already public: ${current.tag_name}`);
      }
    }
  } else if (channel === "stable") {
    for (const current of releases.filter(
      (r) => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name),
    )) {
      if (compareVersions(current.tag_name.slice(1), candidate.version) > 0) {
        recordOutput(`superseded_tag=${current.tag_name}\n`);
        throw Error("Newer stable release already public");
      }
      const prior = api<{ sha: string }>(`commits/${current.tag_name}`).sha;
      execFileSync("git", [
        "merge-base",
        "--is-ancestor",
        prior,
        candidate.sourceSha,
      ]);
    }
  }
  if (!existingTag)
    api("git/refs", "POST", {
      ref: `refs/tags/${candidate.tag}`,
      sha: candidate.sourceSha,
    });
  const previewName = pairedMain
    ? "Paired Main"
    : channel === "main"
      ? "Linux Main"
      : "Mac Main";
  const notes = prerelease
    ? `${previewName} candidate ${candidate.sourceSha}\nProducer ${repository}/actions/runs/${runId}/attempts/${attempt}\n\n${JSON.stringify(manifests)}`
    : `Paired stable candidate ${candidate.sourceSha}\nProducer ${repository}/actions/runs/${runId}/attempts/${attempt}\nChannel stable; fork Mac Preview identity and preview Sparkle feed retained.\n\n${JSON.stringify(manifests)}`;
  if (release) {
    if (
      release.target_commitish !== candidate.sourceSha ||
      release.body !== notes ||
      release.prerelease !== prerelease
    )
      throw Error("Release belongs to another candidate");
    assertAssets(release, manifests, !release.draft);
    if (!release.draft) {
      recordPublicAssets(candidate, manifests);
      return;
    }
  } else {
    release = api<Release>("releases", "POST", {
      tag_name: candidate.tag,
      target_commitish: candidate.sourceSha,
      name: prerelease
        ? `Apparent ${channel === "mac-main" ? "Mac Main" : "Main"} ${candidate.version} (${candidate.sourceSha.slice(0, 12)})`
        : `Apparent ${candidate.version}`,
      body: notes,
      draft: true,
      prerelease,
      make_latest: "false",
    });
  }
  for (const manifest of manifests)
    for (const file of manifest.files) {
      if (release.assets.some((asset: Asset) => asset.name === file.name))
        continue;
      const path = join(
        directory,
        `stable-${manifest.platform}-${manifest.architecture}-${attempt}`,
        file.name,
      );
      gh(["release", "upload", candidate.tag, path, "--repo", repository]);
    }
  release = api<Release>(`releases/${release.id}`);
  assertAssets(release, manifests, true);
  const tag = optional<Ref>(`git/ref/tags/${candidate.tag}`);
  if (
    !tag ||
    tag.object.type !== "commit" ||
    tag.object.sha !== candidate.sourceSha
  )
    throw Error("Tag missing or moved during staging");
  api(`releases/${release.id}`, "PATCH", {
    draft: false,
    make_latest: prerelease ? "false" : "true",
  });
  const publicRelease = api<Release>(`releases/${release.id}`);
  if (publicRelease.draft || publicRelease.prerelease !== prerelease)
    throw Error("Release visibility or channel mismatch");
  assertAssets(publicRelease, manifests, true);
  const finalTag = api<Ref>(`git/ref/tags/${candidate.tag}`);
  if (
    finalTag.object.type !== "commit" ||
    finalTag.object.sha !== candidate.sourceSha
  )
    throw Error("Published tag mismatch");
  recordPublicAssets(candidate, manifests);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [runId, attempt, directory] = process.argv.slice(2);
  const output =
    directory || mkdtempSync(join(tmpdir(), "apparent-dev-stable-"));
  try {
    await publish(runId, Number(attempt), output);
  } finally {
    if (!directory) rmSync(output, { recursive: true, force: true });
  }
}

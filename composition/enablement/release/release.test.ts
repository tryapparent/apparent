import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { producer } from "./candidate.ts";
import { create, paired, repository, verify, workflow } from "./manifest.ts";
import { assertAssets } from "./publish.ts";
import { compareVersions } from "./version.ts";

const source = "1".repeat(40),
  control = "2".repeat(40);
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-release-test-"));
  const manifests = [];
  const paths = [];
  for (const [platform, architecture] of [
    ["linux", "x86_64"],
    ["linux", "aarch64"],
    ["macos", "aarch64"],
  ]) {
    const path = join(directory, `${platform}-${architecture}`);
    mkdirSync(path);
    const name =
      platform === "linux"
        ? `Apparent-1.2.3-linux-${architecture}.AppImage`
        : "Apparent-Preview-1.2.3-arm64.dmg";
    writeFileSync(join(path, name), "verified payload");
    const { digest } = await import("./manifest.ts");
    writeFileSync(
      join(path, name + ".sha256"),
      `${await digest(join(path, name))}  ${name}\n`,
    );
    if (platform === "macos")
      writeFileSync(
        join(path, "Apparent-Preview-1.2.3-arm64.zip"),
        "signed zip",
      );
    manifests.push(
      await create(path, platform, architecture, {
        GITHUB_REPOSITORY: repository,
        CANDIDATE_SHA: source,
        APPARENT_VERSION: "1.2.3",
        RELEASE_TAG: "v1.2.3",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_WORKFLOW_SHA: control,
        RELEASE_NATIVE_CHECKS: "true",
        RELEASE_SIGNING: "true",
        RELEASE_NOTARIZATION: "true",
      }),
    );
    paths.push(path);
  }
  return { directory, manifests, paths };
}
test("paired final-byte manifests refuse incomplete, altered and mismatched candidates", async () => {
  const { directory, manifests, paths } = await fixture();
  try {
    assert.equal(paired(manifests).sourceSha, source);
    assert.notEqual(paired(manifests).producer.controlSha, source);
    assert.throws(() => paired(manifests.slice(0, 2)), /Both Linux/);
    for (const patch of [
      { sourceSha: control },
      { version: "1.2.4" },
      { tag: "v1.2.4" },
      { channel: "preview" },
      { producer: { ...manifests[0].producer, runAttempt: 3 } },
      { evidence: { nativeChecks: true, signing: false, notarization: true } },
    ]) {
      const changed = structuredClone(manifests);
      Object.assign(changed[2], patch);
      assert.throws(() => paired(changed));
    }
    writeFileSync(
      join(paths[0], manifests[0].files[0].name),
      "altered payload",
    );
    await assert.rejects(verify(paths[0], manifests[0]), /digest mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("producer requires exact trusted workflow, repository and successful native jobs at actual attempt", () => {
  const run = {
    id: 123,
    status: "completed",
    conclusion: "failure",
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    path: workflow,
    head_branch: "main",
    head_sha: control,
    event: "workflow_dispatch",
    run_attempt: 2,
  };
  const jobs = [
    "linux / Linux x86_64",
    "linux / Linux aarch64",
    "macos / Build signed Mac candidate",
  ].map((name) => ({
    name,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
  }));
  producer(run, jobs, "123", 2);
  producer({ ...run, run_attempt: 3 }, jobs, "123", 2);
  for (const patch of [
    { path: ".github/workflows/release-linux.yml" },
    { head_branch: "feature" },
    { repository: { full_name: "fork/apparent" } },
    { event: "pull_request" },
    { run_attempt: 1 },
  ]) {
    assert.throws(() => producer({ ...run, ...patch }, jobs, "123", 2));
  }
  for (const conclusion of ["failure", "skipped", "cancelled", null]) {
    assert.throws(() =>
      producer(run, [jobs[0], jobs[1], { ...jobs[2], conclusion }], "123", 2),
    );
  }
  assert.throws(() => producer(run, jobs, "123", 1));
});
test("draft may resume exact uploaded bytes; public release must already be complete and immutable", async () => {
  const { directory, manifests } = await fixture();
  try {
    const assets = manifests.flatMap((m) =>
      m.files.map((f) => ({
        name: f.name,
        size: f.size,
        digest: `sha256:${f.sha256}`,
        state: "uploaded",
      })),
    );
    assertAssets({ assets: assets.slice(0, 1) }, manifests);
    assert.throws(
      () => assertAssets({ assets: assets.slice(0, 1) }, manifests, true),
      /incomplete/,
    );
    assertAssets({ assets }, manifests, true);
    assert.throws(
      () =>
        assertAssets(
          { assets: [{ ...assets[0], digest: "sha256:" + "f".repeat(64) }] },
          manifests,
        ),
      /altered/,
    );
    assert.equal(compareVersions("1.10.0", "1.9.99"), 1);
    assert.equal(compareVersions("1.9.99", "1.10.0"), -1);
    assert.equal(compareVersions("1.9.99", "1.9.99"), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/release-linux.yml", "utf8");
const job = (name: string) =>
  workflow.split(`\n  ${name}:\n`)[1].split(/\n  [\w-]+:\n/)[0];

test("Linux packaging receives the coordinator's exact CI run and attempt", () => {
  const coordinator = readFileSync(
    ".github/workflows/verification.yml",
    "utf8",
  );
  const admission = coordinator
    .split("\n  admit:\n")[1]
    .split("\n  linux:\n")[0];
  const caller = coordinator.split("\n  linux:\n")[1].split("\n  macos:\n")[0];
  for (const [key, env] of [
    ["verification_run_id", "VERIFY_RUN_ID"],
    ["verification_run_attempt", "VERIFY_RUN_ATTEMPT"],
  ]) {
    assert.ok(
      admission.includes(key + ": ${{ steps.candidate.outputs." + key + " }}"),
    );
    assert.ok(
      caller.includes(key + ": ${{ needs.admit.outputs." + key + " }}"),
    );
    assert.ok(job("admit").includes(env + ": ${{ inputs." + key + " }}"));
  }
  assert.ok(job("admit").includes("fetch-depth: 0"));
});
test("Linux verify-only retains both architectures and native packaging gates", () => {
  const build = job("linux");
  assert.ok(workflow.includes("verify_only:"));
  for (const gate of [
    "arch: x86_64",
    "arch: aarch64",
    "cargo build --release --locked",
    "cargo test --release --locked -- --test-threads=2",
    "cargo test --release --locked speech:: -- --nocapture",
    "cargo test --release --locked --bin apparent --no-run --message-format=json",
    'test -f "$test"',
    "GGML_NATIVE:BOOL=OFF",
    "GGML_BACKEND_DL:BOOL=ON",
    "No build-machine CPU specialization",
    "CPU tiers contain only their declared instructions",
    '/.release-control/composition/enablement/release/linux/appimage.ts" ${{ matrix.arch }}',
    "ref: ${{ github.workflow_sha }}",
    "path: .release-control",
    "AppImage runs headless without FUSE",
    "Bundled GStreamer decodes an H.264 MP4",
    "Bundled GStreamer encodes a playable H.264 MP4",
    "Run two seconds of audio with the packaged CPU backend",
    "petarpetrovt/setup-sde@v6.0",
    "Run packaged model on Ice Lake (AVX512-VNNI, no AVX-VNNI)",
  ])
    assert.ok(build.includes(gate), gate);
});

test("independent stable attachment is retired and paired coordinator owns publication", () => {
  assert.ok(!workflow.includes("  attach-release:"));
  const coordinator = readFileSync(
    ".github/workflows/verification.yml",
    "utf8",
  );
  const publish = coordinator.split("\n  publish:\n")[1].split("\n  feed:")[0];
  assert.ok(publish.includes("GH_TOKEN: ${{ github.token }}"));
  assert.ok(publish.includes("composition/enablement/release/publish.ts"));
  assert.ok(publish.includes("needs: [admit, linux, macos]"));
});

test("the Amazon Linux CLI is verified on the x86-64 candidate before sealing", () => {
  const compile = job("cli");
  assert.ok(compile.includes("needs: admit"));
  assert.ok(compile.includes("build.ts dist --compile-only"));
  const seal = job("seal-x86");
  assert.ok(seal.includes("name: Linux x86_64"));
  assert.ok(seal.includes("needs: [admit, linux, cli]"));
  for (const [artifact, producer] of [
    ["x86-appimage", job("linux")],
    ["amazon-cli", compile],
  ]) {
    const name = "name: " + artifact + "-${{ github.run_attempt }}";
    assert.ok(producer.includes(name));
    assert.ok(seal.includes(name));
  }
  const verification = seal.indexOf("amazon-linux-cli/verify.ts");
  assert.ok(verification >= 0);
  assert.ok(
    verification <
      seal.indexOf("manifest.ts create candidate/dist linux x86_64"),
  );
});

test("Linux packaging stays read-only and publishes no standalone release", () => {
  const build = job("linux");
  assert.ok(build.includes("ref: ${{ needs.admit.outputs.sha }}"));
  assert.ok(build.includes('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"'));
  assert.ok(build.includes("actions/upload-artifact@v5"));
  assert.ok(!workflow.includes("main-preview:"));
  assert.ok(!workflow.includes("publish_main:"));
  for (const forbidden of [
    "gh release",
    "GH_TOKEN:",
    "actions: write",
    "contents: write",
  ])
    assert.ok(!build.includes(forbidden), forbidden);
});

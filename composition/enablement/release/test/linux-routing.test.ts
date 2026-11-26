import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/release-linux.yml", "utf8");
const job = (name: string) =>
  workflow.split(`\n  ${name}:\n`)[1].split(/\n  [\w-]+:\n/)[0];
const packager = "capture/desktop/scripts/linux/appimage/appimage.sh";
const checker =
  "capture/desktop/scripts/linux/appimage/check-appimage-encoder.sh";
const releaseControl =
  ".release-control/composition/enablement/release/linux/appimage.ts";

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

test("the workflow-SHA wrapper hands off encoder proof to a required dist check", () => {
  const build = job("linux");
  const [header, ...steps] = build.split("\n      - ");
  const packageStep = "name: Package\n        id: package\n";
  const packageIndex = steps.findIndex(
    (step) =>
      step.startsWith(packageStep) &&
      step
        .trimEnd()
        .endsWith(
          'run: node --experimental-strip-types "$GITHUB_WORKSPACE/' +
            releaseControl +
            '" ${{ matrix.arch }}',
        ),
  );
  const proofIndex = steps.findIndex(
    (step) =>
      step.trimEnd() ===
      "name: Bundled GStreamer encodes a playable H.264 MP4\n" +
        `        run: bash ${checker} ` +
        '"dist/${{ steps.package.outputs.name }}"',
  );
  assert.ok(packageIndex >= 0);
  assert.ok(proofIndex > packageIndex);
  assert.ok(!header.includes("continue-on-error:"));
  for (const gate of ["actions/upload-artifact@", "manifest.ts create dist"]) {
    const gateSteps = steps.filter((step) => step.includes(gate));
    assert.ok(gateSteps.length > 0, gate);
    for (const step of gateSteps) {
      assert.ok(steps.indexOf(step) > proofIndex, gate);
      assert.ok(
        !/\balways\s*\(|\bfailure\s*\(|\bcancelled\s*\(/.test(step),
        gate,
      );
    }
  }
});

for (const { name, route, legacy, fails, checks } of [
  { name: "standalone", route: "shell", checks: ["target"] },
  {
    name: "standalone rejects bad encoding",
    route: "shell",
    fails: true,
    checks: ["target"],
  },
  { name: "direct CI packager", route: "direct-ci", checks: ["target"] },
  { name: "non-release wrapper", route: "local", checks: ["target"] },
  { name: "hosted release", route: "hosted", checks: ["dist"] },
  {
    name: "hosted release rejects bad encoding",
    route: "hosted",
    fails: true,
    checks: ["dist"],
  },
  {
    name: "hosted release with a legacy candidate",
    route: "hosted",
    legacy: true,
    checks: ["target", "dist"],
  },
]) {
  test(`AppImage encoder proof: ${name}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "appimage-encoder-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content, { mode: 0o755 });
    };
    const arch = "x86_64";
    const target = `target/appimage/Apparent-${arch}.AppImage`;
    const artifact = `Apparent-1.2.3-linux-${arch}.AppImage`;
    const dist = `dist/${artifact}`;
    const bytes = `#!/bin/bash
set -euo pipefail
sha256sum "$(realpath "$0")" >> "$PROOF_LOG"
test "$1" = encoder-check
${fails ? "exit 1" : 'printf synthetic-video > "$2"'}
`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const direct = route === "shell" || route === "direct-ci";
    const wrapper = route === "local" ? "appimage.ts" : releaseControl;
    const log = join(root, "checks");
    const output = join(root, "output");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      GITHUB_ACTIONS: route === "shell" ? "false" : "true",
      GITHUB_OUTPUT: output,
      APPARENT_RELEASE_VERSION: "1.2.3",
      APPARENT_APPIMAGE_OUT: join(root, "target", "appimage"),
      TAG: "v1.2.3",
      PROOF_LOG: log,
      SYNTHETIC_IMAGE: bytes,
    };
    delete env.APPARENT_APPIMAGE_ENCODER_CHECK_IN_DIST;
    if (route === "local") env.APPARENT_APPIMAGE_ENCODER_CHECK_IN_DIST = "1";
    const copy = (source: string, dest: string) => {
      mkdirSync(dirname(join(root, dest)), { recursive: true });
      cpSync(source, join(root, dest));
    };
    copy("composition/enablement/release/linux/appimage.ts", wrapper);
    copy(packager, packager);
    copy(checker, checker);
    if (legacy) {
      write(
        packager,
        `#!/usr/bin/env bash
set -euo pipefail
mkdir -p target/appimage
printf '%s' "$SYNTHETIC_IMAGE" > "${target}"
chmod +x "${target}"
bash "${checker}" "${target}"
`,
      );
    }
    write(
      "target/appimage/tools/linuxdeploy",
      `#!/bin/sh
set -eu
if [ "$3" = "--output" ]; then
  printf '%s' "$SYNTHETIC_IMAGE" > "$LDAI_OUTPUT"
  chmod +x "$LDAI_OUTPUT"
fi
`,
    );
    for (const command of [
      "node",
      "python3",
      "wl-copy",
      "wl-paste",
      "ffmpeg",
    ]) {
      write(`bin/${command}`, "#!/bin/sh\nexit 0\n");
    }
    write("bin/ffprobe", "#!/bin/sh\nprintf 'h264\\n'\n");
    write("bin/uname", "#!/bin/sh\nprintf 'x86_64\\n'\n");
    write("target/appimage/tools/linuxdeploy-plugin-gstreamer.sh", "unused\n");
    write("target/release/libggml-cpu.so", "");
    write("target/release/apparent", "");
    copy(
      "capture/desktop/scripts/support/apparent-restore-clipboard.py",
      "capture/desktop/scripts/support/apparent-restore-clipboard.py",
    );
    const packageResult = direct
      ? spawnSync("bash", [packager], { cwd: root, env })
      : spawnSync(
          process.execPath,
          ["--experimental-strip-types", wrapper, arch],
          { cwd: root, env },
        );
    assert.equal(
      packageResult.status,
      direct && fails ? 1 : 0,
      packageResult.stderr?.toString(),
    );
    if (route === "hosted") {
      const publishedName = readFileSync(output, "utf8").trim().split("=")[1];
      assert.equal(publishedName, artifact);
      assert.equal(
        readFileSync(join(root, dist + ".sha256"), "utf8"),
        `${hash}  ${artifact}\n`,
      );
      const proof = spawnSync("bash", [checker, join("dist", publishedName)], {
        cwd: root,
        env,
      });
      assert.equal(proof.status, fails ? 1 : 0, proof.stderr?.toString());
    }
    assert.equal(
      readFileSync(log, "utf8"),
      checks
        .map(
          (path) => `${hash}  ${join(root, path === "dist" ? dist : target)}\n`,
        )
        .join(""),
    );
  });
}

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

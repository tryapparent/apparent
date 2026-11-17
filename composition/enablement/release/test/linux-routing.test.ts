import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(".github/workflows/release-linux.yml", "utf8");
const job = (name: string) =>
  workflow.split(`\n  ${name}:\n`)[1].split(/\n  [\w-]+:\n/)[0];
const expression = (
  text: string,
  inputs: object,
  event = "workflow_dispatch",
  result = "success",
  ref = "refs/heads/main",
) =>
  Function(
    "inputs",
    "github",
    "needs",
    `return (${text.replace(/^\$\{\{\s*|\s*\}\}$/g, "")})`,
  )(inputs, { event_name: event, ref }, { linux: { result } });

test("Main preview uses admitted source and the checked publisher", () => {
  const build = job("linux"),
    preview = job("main-preview");
  assert.ok(!workflow.includes("actions: write"));
  assert.ok(build.includes("ref: ${{ needs.admit.outputs.sha }}"));
  assert.ok(build.includes('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"'));
  assert.ok(preview.includes("ref: ${{ needs.admit.outputs.sha }}"));
  assert.ok(
    preview.includes(
      "python3 capture/desktop/scripts/linux/maintenance/publish-main-preview.py",
    ),
  );
  assert.ok(
    job("preview-needed").includes(
      "composition/enablement/release/linux.ts needed",
    ),
  );
  assert.ok(!preview.includes("exit 0"));
});

test("actual Main publication condition excludes stable candidates, failed builds and verification", () => {
  const condition = job("main-preview").split("    if: ")[1].split("\n")[0];
  for (const [event, ref, tag, publish, verify, result, expected] of [
    ["push", "refs/heads/main", "", false, false, "success", false],
    ["schedule", "refs/heads/main", "", false, false, "success", true],
    ["workflow_run", "refs/heads/main", "", false, false, "success", true],
    ["workflow_dispatch", "refs/heads/main", "", true, false, "success", true],
    [
      "workflow_dispatch",
      "refs/heads/main",
      "v1.2.3",
      false,
      false,
      "success",
      false,
    ],
    ["workflow_dispatch", "refs/heads/main", "", false, true, "success", false],
    [
      "workflow_dispatch",
      "refs/heads/topic",
      "",
      true,
      false,
      "success",
      false,
    ],
    ["pull_request", "refs/pull/278/merge", "", false, false, "success", false],
    ["workflow_dispatch", "refs/heads/main", "", true, false, "failure", false],
    ["workflow_dispatch", "refs/heads/main", "", true, false, "skipped", false],
  ] as const)
    for (const stable of [false, true])
      assert.equal(
        Boolean(
          expression(
            condition,
            {
              tag,
              publish_main: publish,
              verify_only: verify,
              stable_candidate: stable,
            },
            event,
            result,
            ref,
          ),
        ),
        expected && !stable,
      );
  for (const name of ["preview-needed", "linux"])
    assert.ok(
      job(name).includes(
        "PUBLISH_MAIN: ${{ !inputs.stable_candidate && (github.event_name == 'workflow_run' || github.event_name == 'schedule' || inputs.publish_main) }}",
      ),
    );
});

test("verification, stable assembly and compatibility cannot evict pending Main publication", () => {
  const concurrency = workflow.split("\nconcurrency:\n")[1].split("\njobs:")[0];
  assert.ok(concurrency.includes("cancel-in-progress: false"));
  const group = concurrency.split("  group: ")[1].split("\n")[0];
  const lane = (
    patch = {},
    event = "workflow_dispatch",
    ref = "refs/heads/main",
  ) =>
    group.replace(/\$\{\{(.*?)\}\}/g, (_, raw) =>
      String(
        expression(
          raw,
          {
            stable_candidate: false,
            verify_only: false,
            publish_main: false,
            tag: "",
            bridge_commit: "",
            ...patch,
          },
          event,
          "success",
          ref,
        ),
      ),
    );
  const main = lane({}, "push");
  assert.equal(lane({}, "schedule"), main);
  assert.equal(lane({ publish_main: true }), main);
  assert.notEqual(lane({ verify_only: true }), main);
  assert.notEqual(lane({ stable_candidate: true }), main);
  assert.notEqual(lane({ tag: "v1.2.3" }), main);
  assert.notEqual(lane({}, "workflow_dispatch", "refs/heads/topic"), main);
  const bridge = lane({ bridge_commit: "a".repeat(40) });
  assert.notEqual(bridge, main);
  assert.notEqual(bridge, lane({ stable_candidate: true }));
  assert.equal(bridge, lane({ bridge_commit: "b".repeat(40) }));
});

test("actual needed entrypoint skips only an already public same-source Main preview", () => {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-linux-needed-"));
  try {
    const fixture = fileURLToPath(
      new URL("./github-fixture.ts", import.meta.url),
    );
    writeFileSync(
      join(directory, "gh"),
      `#!/bin/sh\nexec node --experimental-strip-types '${fixture}' "$@"\n`,
    );
    chmodSync(join(directory, "gh"), 0o700);
    const source = "a".repeat(40),
      output = join(directory, "output");
    const command = job("preview-needed")
      .split("        run: ")[1]
      .split("\n")[0];
    for (const [publish, verify, stable, tag, draft, expected] of [
      [true, false, false, "", false, false],
      [true, false, false, "", true, true],
      [true, false, false, "", undefined, true],
      [false, true, false, "", false, true],
      [false, false, false, "v1.2.3", false, true],
      [false, false, true, "", false, true],
    ] as const) {
      const endpoint = `repos/tryapparent/apparent/releases/tags/linux-main-v2-${source}`;
      writeFileSync(
        join(directory, "routes"),
        JSON.stringify(
          draft === undefined ? {} : { [endpoint]: { json: { draft } } },
        ),
      );
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-eu", "-c", command], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          GH_TOKEN: "",
          FIXTURE_LOG: join(directory, "calls"),
          FIXTURE_ROUTES: join(directory, "routes"),
          FIXTURE_STATE: "",
          PUBLISH_MAIN: String(publish),
          VERIFY_ONLY: String(verify),
          STABLE_CANDIDATE: String(stable),
          TAG: tag,
          CANDIDATE_SHA: source,
          GITHUB_OUTPUT: output,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, "utf8"), `build=${expected}\n`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    "./capture/desktop/scripts/linux/appimage/appimage.sh target/release/apparent",
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

test("verification-only validation fails closed and build jobs cannot publish", () => {
  const build = job("linux"),
    preview = job("main-preview");
  for (const guard of [
    "VERIFY_ONLY: ${{ inputs.verify_only }}",
    '$GITHUB_EVENT_NAME" != "workflow_dispatch',
    '-n "$TAG"',
    '"$PUBLISH_MAIN" == "true"',
    '"$GITHUB_REF" != refs/heads/*',
  ])
    assert.ok(build.includes(guard), guard);
  assert.ok(preview.includes("inputs.verify_only != true"));
  for (const forbidden of [
    "gh release",
    "GH_TOKEN:",
    "actions: write",
    "contents: write",
  ])
    assert.ok(!build.includes(forbidden), forbidden);
  assert.ok(build.includes("actions/upload-artifact@v5"));
  assert.ok(preview.includes("contents: write"));
});

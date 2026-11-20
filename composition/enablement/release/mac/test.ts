import { assertNewVersion, updateFeed } from "./publication/feed.ts";
import {
  homebrewCask,
  verifiedCask,
  assertCaskUpdate,
  releaseVersion,
} from "./publication/homebrew.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stagePortable } from "./frontend.ts";
import { distribution } from "./distribution.ts";
import { test } from "node:test";
import {
  alternateRunner,
  capacityCancelled,
  macToolchain,
  queueReport,
} from "./runner.ts";
import { validate } from "./inputs.ts";

const env = {
  GITHUB_REPOSITORY: "tryapparent/apparent",
  CANDIDATE_SHA: "a".repeat(40),
  APPARENT_VERSION: "1.2.3",
  RELEASE_TAG: "v1.2.3",
  RELEASE_CHANNEL: "stable",
  APPARENT_PREVIEW_NOTARIZE: "true",
};
const cargo =
  '[package]\nname = "apparent"\nversion = "1.2.3"\n[dependencies]\n';
test("accepts exactly the admitted checkout, Cargo version and stable tag", () => {
  validate(env, cargo, env.CANDIDATE_SHA);
  validate(
    {
      ...env,
      RELEASE_CHANNEL: "main",
      RELEASE_TAG: `linux-main-v2-${env.CANDIDATE_SHA}`,
    },
    cargo,
    env.CANDIDATE_SHA,
  );
  for (const [key, value] of Object.entries({
    GITHUB_REPOSITORY: "kitlangton/apparent",
    CANDIDATE_SHA: "main",
    APPARENT_VERSION: "01.2.3",
    RELEASE_TAG: "preview-mac-2-3",
    RELEASE_CHANNEL: "preview",
    APPARENT_PREVIEW_NOTARIZE: "false",
  }))
    assert.throws(
      () => validate({ ...env, [key]: value }, cargo, env.CANDIDATE_SHA),
      key,
    );
  assert.throws(() =>
    validate(env, cargo.replace("1.2.3", "1.2.4"), env.CANDIDATE_SHA),
  );
  assert.throws(() => validate(env, cargo, "b".repeat(40)));
});
test("checks Sparkle public-key bytes and rejects noncanonical encoding", () => {
  const script = "composition/enablement/release/mac/metadata.ts";
  execFileSync(process.execPath, [
    "--experimental-strip-types",
    script,
    "key",
    Buffer.alloc(32, 1).toString("base64"),
  ]);
  for (const key of [
    "",
    "x",
    Buffer.alloc(31).toString("base64"),
    Buffer.alloc(33).toString("base64"),
  ])
    assert.throws(() =>
      execFileSync(
        process.execPath,
        ["--experimental-strip-types", script, "key", key],
        { stdio: "pipe" },
      ),
    );
});
test("reusable Mac workflow shares native gates across the primary and capacity fallback", () => {
  const workflow = readFileSync(
    ".github/workflows/release-mac-preview.yml",
    "utf8",
  );
  const stable = workflow.slice(workflow.indexOf("  frontend:\n"));
  assert.match(stable, /runs-on: \$\{\{ inputs.mac_runner \}\}/);
  assert.match(stable, /runs-on: \$\{\{ needs.capacity.outputs.runner \}\}/);
  assert.match(stable, /steps: &candidate-steps/);
  assert.match(stable, /steps: \*candidate-steps/);
  const fallback = stable.split("\n  fallback:\n")[1].split("\n  confirm:")[0];
  assert.match(
    fallback,
    /if: \$\{\{ !cancelled\(\) && needs\.frontend\.result == 'success' && needs\.capacity\.result == 'success' && needs\.capacity\.outputs\.runner != '' \}\}/,
  );
  assert.match(
    workflow,
    /candidate:\n    name: Build signed Mac candidate\n    needs: frontend/,
  );
  assert.match(workflow, /name: stable-macos-aarch64/);
  const sealing = readFileSync(
    "composition/enablement/release/mac/workflow.ts",
    "utf8",
  );
  assert.match(sealing, /manifest.ts/);
  assert.match(sealing, /"create",\s*directory,\s*"macos",\s*"aarch64"/);
  assert.match(workflow, /RELEASE_NATIVE_CHECKS: 'true'/);
  assert.match(workflow, /RELEASE_SIGNING: 'true'/);
  assert.match(workflow, /RELEASE_NOTARIZATION: 'true'/);
  assert.doesNotMatch(
    stable,
    /contents: write|workflow_dispatch:|gh release|HOMEBREW_TAP_SSH_KEY/,
  );
  assert.match(workflow, /if: inputs.channel == '' && github.repository/);
  assert.match(
    stable,
    /if: \(inputs.channel == 'stable' \|\| inputs.channel == 'mac-main' \|\| inputs.channel == 'main' \|\| inputs.channel == 'mac-nightly'\) && github.repository/,
  );
  assert(
    workflow.indexOf("Validate candidate installation") <
      workflow.indexOf("Sign Sparkle bytes"),
  );
  assert(
    workflow.indexOf("Sign Sparkle bytes") <
      workflow.indexOf("name: stable-macos-aarch64"),
  );
});
test("the alternate Apple Silicon image is used only for verified unassigned jobs", () => {
  const job = {
    name: "macos / Build signed Mac candidate",
    id: 123,
    run_attempt: 1,
    status: "completed",
    conclusion: "cancelled",
    runner_id: 0,
    labels: ["macos-26"],
    steps: [],
  };
  const annotations = [
    {
      message:
        "The job was not acquired by Runner of type hosted even after multiple attempts",
    },
  ];
  assert.equal(alternateRunner("macos-26"), "macos-15");
  assert.equal(alternateRunner("macos-15"), "macos-26");
  assert.equal(alternateRunner("xcode-27"), "macos-26");
  assert.throws(() => alternateRunner("macos-26-intel"));
  assert.equal(capacityCancelled(job, "macos-26", annotations), true);
  assert.equal(capacityCancelled(job, "macos-26", []), false);
  assert.equal(capacityCancelled(job, "macos-15", annotations), false);
  for (const patch of [
    { runner_id: 456 },
    { runner_id: null },
    { steps: [{ name: "Set up job" }] },
    { status: "queued" },
    { conclusion: "failure" },
    { conclusion: "success" },
  ])
    assert.equal(
      capacityCancelled({ ...job, ...patch }, "macos-26", annotations),
      false,
    );
  const created_at = "2026-11-18T14:24:31Z";
  assert.equal(
    queueReport([
      { ...job, created_at, completed_at: "2026-11-18T14:39:32Z" },
      {
        ...job,
        name: "macos / Build signed Mac candidate fallback",
        labels: ["macos-15"],
        created_at,
        runner_id: 456,
        steps: [{ name: "Set up job", started_at: "2026-11-18T14:25:14Z" }],
      },
    ]),
    "- macos-26: 901s before cancellation without a runner\n- macos-15: 43s to runner setup",
  );
});
test("opting into xcode-27 retains the pinned SDK on the standard fallback", () => {
  assert.deepEqual(macToolchain("xcode-27", "candidate"), {
    xcode: "27.2",
    sdkMajor: "27",
  });
  for (const [runner, job] of [
    ["xcode-27", "fallback"],
    ["macos-26", "candidate"],
    ["macos-15", "candidate"],
    ["macos-26", "fallback"],
    ["macos-15", "fallback"],
  ])
    assert.deepEqual(macToolchain(runner, job), {
      xcode: "26.3",
      sdkMajor: "26",
    });
  assert.throws(() => macToolchain("macos-26-intel", "candidate"));
  assert.throws(() => macToolchain("xcode-27", "preview"));
});
test("control checkout precedes nested source checkout on both candidate runners", () => {
  const workflow = readFileSync(
    ".github/workflows/release-mac-preview.yml",
    "utf8",
  );
  for (const name of ["frontend", "candidate"]) {
    const job = workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z]+:/)[0];
    const control = job.indexOf("ref: ${{ github.workflow_sha }}");
    const source = job.indexOf("path: release-source");
    assert.ok(control >= 0 && source > control, name);
    assert.equal(
      job.lastIndexOf("actions/checkout@"),
      job.indexOf("actions/checkout@", control),
    );
  }
});
test("standalone preview fixtures resolve their own isolated source roots", () => {
  const workflow = readFileSync(
    ".github/workflows/release-mac-preview.yml",
    "utf8",
  );
  const standalone = workflow.split("\n  frontend:\n")[0];
  assert.doesNotMatch(standalone, /APPARENT_SOURCE_ROOT:/);
});
test("all Mac shell entrypoints parse without executing native commands", () => {
  execFileSync("bash", [
    "-n",
    "capture/desktop/scripts/packaging/build-mac-preview.sh",
  ]);
});

test("portable staging preserves generated payloads and excludes Linux native providers", () => {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-mac-stage-"));
  const frontend = "capture/desktop/ui/frontend";
  const files = [
    frontend + "/electron/pill/native/window.node",
    frontend + "/electron/record-media/native/apparent-engine-media",
    frontend + "/electron/agent-media/native/apparent-engine-frames",
    frontend + "/electron/notes/main.cjs",
    frontend + "/electron/installer/main.cts",
    frontend + "/dist/src/installer/index.html",
    frontend + "/dist/assets/foundation-a.js",
    frontend + "/dist/pill/index.html",
    frontend + "/dist/settings.html",
    "connect/client/typescript/dist/shares.js",
    "connect/client/typescript/dist/foreground.js",
    "shared/ui/src/window-theme.cjs",
    "shared/ui/src/tokens.css",
  ];
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), file);
    }
    const destination = join(directory, "prepared");
    stagePortable(destination, directory, () => Buffer.alloc(0));
    assert.equal(
      readFileSync(
        join(destination, "app/connect-client/dist/foreground.js"),
        "utf8",
      ),
      "connect/client/typescript/dist/foreground.js",
    );
    assert(existsSync(join(destination, "app/dist/assets/foundation-a.js")));
    assert(
      existsSync(
        join(destination, "app/electron/installer/ui/assets/foundation-a.js"),
      ),
    );
    assert(
      existsSync(
        join(destination, "app/node_modules/@apparent/ui/src/tokens.css"),
      ),
    );
    for (const owner of ["pill", "record-media", "agent-media"])
      assert(!existsSync(join(destination, "app/electron", owner, "native")));
    assert.throws(() => stagePortable(destination, directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("distribution metadata ties signed ZIP length and cask checksum to stable assets", () => {
  const attributes =
    'sparkle:edSignature="' +
    Buffer.alloc(64, 1).toString("base64") +
    '" length="123"';
  const environment = { ...env, APPARENT_PREVIEW_BUILD_NUMBER: "123.2" };
  const { metadata, cask } = distribution(
    environment,
    "b".repeat(64),
    attributes,
    123,
  );
  assert.equal(metadata.tag, "v1.2.3");
  assert.equal(metadata.buildNumber, "123.2");
  assert.equal(metadata.sourceSha, env.CANDIDATE_SHA);
  assert.equal(metadata.edSignature, Buffer.alloc(64, 1).toString("base64"));
  assert.match(cask, /releases\/download\/v1.2.3\/Apparent-Preview-/);
  assert(cask.includes("b".repeat(64)));
  assert.throws(() =>
    distribution(environment, "b".repeat(64), attributes, 124),
  );
  assert.throws(() =>
    distribution(
      { ...environment, RELEASE_TAG: "preview-mac-2-3" },
      "b".repeat(64),
      attributes,
      123,
    ),
  );
  assert.throws(() =>
    distribution(
      environment,
      "b".repeat(64),
      'sparkle:edSignature="bad" length="123"',
      123,
    ),
  );
});

test("stable feed refuses downgrade early and supports identical publication retries", () => {
  const feed =
    '<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Apparent Preview</title><item><sparkle:version>500.1</sparkle:version><sparkle:shortVersionString>1.2.2</sparkle:shortVersionString></item></channel></rss>';
  assertNewVersion(feed, "1.2.3");
  assert.throws(() => assertNewVersion(feed, "1.2.2"));
  assert.throws(() => assertNewVersion(feed, "1.2.1"));
  const attrs =
    'sparkle:edSignature="' +
    Buffer.alloc(64, 1).toString("base64") +
    '" length="123"';
  const { metadata } = distribution(
    { ...env, APPARENT_PREVIEW_BUILD_NUMBER: "10000.1" },
    "b".repeat(64),
    attrs,
    123,
  );
  const next = updateFeed(feed, metadata, new Date("2026-11-17T00:00:00Z"));
  assert(next.includes(metadata.zipUrl));
  assert.equal(updateFeed(next, metadata), next);
  assert.throws(() =>
    updateFeed(next, {
      ...metadata,
      edSignature: Buffer.alloc(64, 2).toString("base64"),
    }),
  );
  assert.throws(() => updateFeed(feed, { ...metadata, buildNumber: "499.1" }));
});
test("stable cask requires public digest, canonical tag, and nondecreasing immutable bytes", () => {
  assert.equal(releaseVersion("v1.2.3"), "1.2.3");
  const name = "Apparent-Preview-1.2.3-arm64.dmg";
  const url =
    "https://github.com/tryapparent/apparent/releases/download/v1.2.3/" + name;
  const hash = "b".repeat(64);
  const release = {
    draft: false,
    tag_name: "v1.2.3",
    assets: [
      { name, browser_download_url: url, digest: "sha256:" + hash },
      {
        name: name + ".sha256",
        browser_download_url: url + ".sha256",
        digest: null,
      },
    ],
  };
  const cask = verifiedCask("v1.2.3", release, hash + "  " + name + "\n", hash);
  assert.equal(cask, homebrewCask("1.2.3", hash, "v1.2.3"));
  assertCaskUpdate(cask, cask);
  assert.throws(() =>
    assertCaskUpdate(homebrewCask("1.2.4", hash, "v1.2.4"), cask),
  );
  assert.throws(() =>
    assertCaskUpdate(cask, homebrewCask("1.2.3", "c".repeat(64), "v1.2.3")),
  );
  assert.throws(() =>
    verifiedCask(
      "v1.2.3",
      {
        ...release,
        assets: [{ ...release.assets[0], digest: null }, release.assets[1]],
      },
      hash + "  " + name + "\n",
      hash,
    ),
  );
});

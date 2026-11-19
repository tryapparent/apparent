import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { matchesArchive, packageHashes } from "./recipient-ffmpeg.ts";

test("the package cache identity follows Ubuntu archive bytes across mirrors", () => {
  const hash = "a".repeat(64);
  const archive = "ffmpeg_7%3a6.1.1-3ubuntu5_amd64.deb";
  const first = `'https://archive.ubuntu.com/a' ${archive} 123 SHA256:${hash}`;
  const second = `'https://archive.ubuntu.com/b' codec_1+dfsg_amd64.deb 456 SHA256:${hash}`;
  const expected = [
    ["codec_1+dfsg_amd64.deb", hash],
    [archive, hash],
  ];
  assert.deepEqual(packageHashes(first + "\n" + second), expected);
  assert.deepEqual(
    packageHashes(
      second + "\n" + first.replace("archive.ubuntu.com", "mirror.example"),
    ),
    expected,
  );
  assert.notDeepEqual(
    packageHashes(first + "\n" + second.replace(hash, "b".repeat(64))),
    expected,
  );
  assert.deepEqual(packageHashes("0 newly installed"), []);
  for (const invalid of [
    first.replace("SHA256", "MD5Sum"),
    first.replace(archive, "../" + archive),
    first + "\n" + first,
  ]) {
    assert.throws(
      () => packageHashes(invalid),
      /Unexpected APT archive metadata/,
    );
  }
});

test("missing, same-size corrupt and linked archives cannot satisfy the signed archive hash", () => {
  const root = mkdtempSync("/tmp/apparent-dev-recipient-archive-");
  try {
    const archive = join(root, "fixture.deb");
    const hash = createHash("sha256").update("good").digest("hex");
    assert.equal(matchesArchive(archive, hash), false);
    writeFileSync(archive, "good");
    assert.equal(matchesArchive(archive, hash), true);
    symlinkSync(archive, join(root, "linked.deb"));
    assert.equal(matchesArchive(join(root, "linked.deb"), hash), false);
    writeFileSync(archive, "evil");
    assert.equal(matchesArchive(archive, hash), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hosted recipient jobs prepare the Ubuntu archives before running the existing browser suite", () => {
  const read = (name: string) =>
    readFileSync(new URL("../../../" + name, import.meta.url), "utf8");
  const workflow = (name: string) =>
    Bun.YAML.parse(read(".github/workflows/" + name + ".yml")) as {
      jobs: Record<
        string,
        {
          steps: {
            id?: string;
            if?: string;
            uses?: string;
            run?: string;
            with?: Record<string, string>;
          }[];
        }
      >;
    };
  const command =
    "node --experimental-strip-types connect/enablement/ci/recipient-ffmpeg.ts";
  for (const [file, condition] of [
    [
      "checks",
      "needs.select.result != 'success' || fromJSON(needs.select.outputs.plan).service",
    ],
    ["stream-connect", undefined],
  ] as const) {
    const { steps } = workflow(file).jobs.portable;
    const apt = steps.findIndex(
      (step) => step.uses === "./.github/actions/ubuntu-apt",
    );
    const plan = steps.findIndex((step) => step.run === command + " plan");
    const restore = steps.findIndex((step) => step.id === "ffmpeg_archives");
    const install = steps.findIndex(
      (step) => step.run === command + " install",
    );
    const save = steps.findIndex(
      (step) => step.uses === "actions/cache/save@v4",
    );
    const run = steps.findIndex((step) => step.run?.includes("--portable"));
    assert.ok(
      apt >= 0 &&
        apt < plan &&
        plan < restore &&
        restore < install &&
        install < save &&
        save < run,
    );
    assert.equal(steps[plan].if, condition);
    assert.equal(steps[install].if, condition);
    assert.equal(steps[restore].if, "steps.ffmpeg_plan.outputs.key != ''");
    assert.equal(steps[restore].with?.path, steps[save].with?.path);
    assert.equal(steps[restore].with?.key, steps[save].with?.key);
    assert.match(
      steps[save].if ?? "",
      /github.event_name == 'push' && github.ref == format/,
    );
    assert.equal(
      steps.find((step) => step.id === "chrome")?.with?.["chrome-version"],
      "stable",
    );
  }
  const manual = workflow("verification-platform").jobs.select.steps;
  const run = manual.findIndex((step) => step.run?.includes("--portable"));
  const install = manual.findIndex((step) =>
    step.run?.endsWith("install -y --no-install-recommends ffmpeg"),
  );
  assert.ok(install >= 0 && install < run);
  assert.equal(manual[install].if, "inputs.portable");
  assert.equal(
    manual.find((step) => step.id === "chrome")?.with?.["chrome-version"],
    "stable",
  );
  const recipient = read("connect/service/test/sharing/recipient-browser.mjs");
  assert.match(recipient, /execFileSync\('ffmpeg'/);
  assert.match(recipient, /libx264/);
});

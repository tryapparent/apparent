import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

const root = new URL("../../../../", import.meta.url);
const installer = "./capture/desktop/scripts/linux/appimage/dependencies.sh";
const archive =
  "https://archive.ubuntu.com/ubuntu/pool/main/a/alsa-lib/libasound2-dev_1.2.11-1ubuntu0.5_amd64.deb";
const archiveSummary =
  "E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?\n";
const missingArchive = (url = archive) =>
  `E: Failed to fetch ${url}  404  Not Found [IP: 192.0.2.5 443]\n${archiveSummary}`;
const missing = { status: 100, stderr: missingArchive() };
const good = { status: 0, stderr: "" };
const badSignature = {
  status: 100,
  stderr: "W: GPG error: Ubuntu InRelease: NO_PUBKEY 0123456789ABCDEF\n",
};
const hostedUpdate = "update --error-on=any";

type Result = typeof good;

function run(receipts: Result[], hosted = true, entry = installer) {
  const dir = mkdtempSync(join(tmpdir(), "apparent-dev-apt-fixture-"));
  try {
    const stub = (name: string, script: string) =>
      writeFileSync(join(dir, name), `#!/bin/bash\nset -eu\n${script}`, {
        mode: 0o700,
      });
    stub(
      "sudo",
      `if [[ "$GITHUB_ACTIONS" == true ]]; then
  [[ "$1" == env && "$2" == LC_ALL=C ]]
  export LC_ALL=C
  shift 2
fi
[[ "$1" == apt-get ]]
shift
exec "$FIXTURE/apt-get" "$@"`,
    );
    stub(
      "apt-get",
      `printf '%s\\n' "$*" >> "$FIXTURE/commands"
step=$(wc -l < "$FIXTURE/commands")
cat "$FIXTURE/$step.stderr" >&2
exit "$(cat "$FIXTURE/$step.status")"`,
    );
    if (!hosted) stub("node", "exit 97");
    receipts.forEach(({ status, stderr }, index) => {
      writeFileSync(join(dir, `${index + 1}.status`), String(status));
      writeFileSync(join(dir, `${index + 1}.stderr`), stderr);
    });
    writeFileSync(join(dir, "commands"), "");
    const result = spawnSync("bash", ["-c", entry], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: [dir, process.env.PATH].join(delimiter),
        LC_ALL: "",
        GITHUB_ACTIONS: String(hosted),
        RUNNER_ENVIRONMENT: hosted ? "github-hosted" : "",
        RUNNER_OS: "Linux",
        FIXTURE: dir,
      },
    });
    assert.ifError(result.error);
    const commands = readFileSync(join(dir, "commands"), "utf8")
      .trimEnd()
      .split("\n");
    return { commands, status: result.status, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the documented manual command installs the same inventory without requiring Node", () => {
  const guide = readFileSync(
    new URL("capture/desktop/docs/linux/linux.md", root),
    "utf8",
  );
  assert.ok(guide.includes(`\n${installer}\ncargo build`));
  const local = run([good, good], false);
  const hosted = run([good, good]);
  assert.equal(local.status, 0);
  assert.equal(hosted.status, 0);
  assert.deepEqual(local.commands, ["update", hosted.commands[1]]);
  assert.deepEqual(hosted.commands, [hostedUpdate, hosted.commands[1]]);
  assert.match(hosted.commands[1], /^install -y --no-install-recommends /);
  assert.match(hosted.commands[1], /\blibasound2-dev\b/);
  const localFailure = run([good, missing], false);
  assert.deepEqual(localFailure.commands, local.commands);
  assert.equal(localFailure.status, 100);
  assert.equal(localFailure.stderr, missing.stderr);
});

test("the verification and release caller stages recover the Ubuntu pool 404 once", () => {
  const callers = [
    {
      workflow: "verification-platform.yml",
      step: "Linux application dependencies",
      guard: "runner.os == 'Linux' && needs.select.outputs.root == 'true'",
      before: "Prepare hosted Ubuntu package transport",
    },
    {
      workflow: "release-linux.yml",
      step: "Install build and packaging dependencies",
      before: "Confirm build identity",
    },
  ];
  for (const { workflow, step, guard, before } of callers) {
    const source = readFileSync(
      new URL(`.github/workflows/${workflow}`, root),
      "utf8",
    );
    const stage = source
      .split(`      - name: ${step}\n`)[1]
      ?.split("\n      - ")[0];
    assert.ok(stage, step);
    assert.ok(source.indexOf(`      - name: ${before}\n`) >= 0);
    assert.ok(source.indexOf(before) < source.indexOf(step));
    if (guard) assert.ok(stage.includes(`        if: ${guard}\n`));
    if (workflow === "release-linux.yml") {
      assert.ok(source.includes("ref: ${{ needs.admit.outputs.sha }}"));
      assert.ok(source.includes("runner: ubuntu-24.04-arm"));
      assert.match(
        source,
        /name: Prepare hosted Ubuntu package transport\n\s+if: runner\.os == 'Linux' && runner\.arch == 'X64'[\s\S]*?uses: tryapparent\/apparent\/\.github\/actions\/ubuntu-apt@[0-9a-f]{40}\n/,
      );
    } else {
      assert.match(source, /uses: \.\/\.github\/actions\/ubuntu-apt\n/);
      const helper = readFileSync(
        new URL(".github/actions/ubuntu-apt/action.yml", root),
        "utf8",
      );
      assert.match(helper, /uses: actions\/setup-node@v4\n/);
    }
    const entry = /^        run: (.+)$/m.exec(stage)?.[1];
    assert.equal(entry, installer);
    const result = run([good, missing, good, good], true, entry);
    assert.equal(result.status, 0, workflow);
    assert.deepEqual(result.commands, [
      hostedUpdate,
      result.commands[1],
      hostedUpdate,
      result.commands[1],
    ]);
    assert.ok(result.stderr.startsWith(missing.stderr));
  }
});

test("the Ubuntu Ports archive shape has the same bounded recovery", () => {
  const ports = missingArchive(
    archive
      .replace("archive.ubuntu.com/ubuntu/", "ports.ubuntu.com/ubuntu-ports/")
      .replace("_amd64.deb", "_arm64.deb"),
  );
  const result = run([good, { status: 100, stderr: ports }, good, good]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.commands, [
    hostedUpdate,
    result.commands[1],
    hostedUpdate,
    result.commands[1],
  ]);
});

test("a failed refresh prevents retry and persistent 404 exits after the second install", () => {
  const persistent = run([good, missing, good, missing]);
  const [update, install] = persistent.commands;
  assert.deepEqual(persistent.commands, [update, install, update, install]);
  assert.equal(persistent.status, 100);
  assert.equal(persistent.stderr.split(missing.stderr).length, 3);

  for (const refresh of [
    badSignature,
    { status: 41, stderr: "APT refresh subprocess failed\n" },
  ]) {
    const failedRefresh = run([good, missing, refresh]);
    assert.deepEqual(failedRefresh.commands, [update, install, update]);
    assert.equal(failedRefresh.status, refresh.status);
    assert.ok(failedRefresh.stderr.startsWith(missing.stderr));
    assert.ok(failedRefresh.stderr.endsWith(refresh.stderr));
  }

  const initialFailure = run([badSignature]);
  assert.deepEqual(initialFailure.commands, [update]);
  assert.equal(initialFailure.status, 100);
  assert.equal(initialFailure.stderr, badSignature.stderr);
});

test("unrelated or ambiguous install failures keep their status and stderr and stop", () => {
  const unrelated = [
    { status: 23, stderr: missing.stderr },
    badSignature,
    { status: 100, stderr: missing.stderr + badSignature.stderr },
    {
      status: 100,
      stderr:
        missing.stderr + `E: Failed to fetch ${archive}  Hash Sum mismatch\n`,
    },
    {
      status: 100,
      stderr: missing.stderr.replace(
        "404  Not Found",
        "503  Service Unavailable",
      ),
    },
    {
      status: 100,
      stderr: missingArchive(
        "https://archive.ubuntu.com/ubuntu/dists/noble/InRelease",
      ),
    },
    {
      status: 100,
      stderr: missingArchive(
        archive.replace("archive.ubuntu.com", "packages.example.invalid"),
      ),
    },
    { status: 100, stderr: "E: Unable to locate package libasound2-dev\n" },
    {
      status: 100,
      stderr: missing.stderr + "W: unexpected diagnostic\n".repeat(3000),
    },
  ];
  for (const receipt of unrelated) {
    const result = run([good, receipt]);
    assert.deepEqual(result.commands, [hostedUpdate, result.commands[1]]);
    assert.equal(result.status, receipt.status);
    assert.equal(result.stderr, receipt.stderr);
  }
});

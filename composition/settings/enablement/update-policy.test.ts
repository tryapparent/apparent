import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  needsChannelRelease,
  selectRelease,
  type UpdateFacts,
} from "../update-policy.ts";

const script = fileURLToPath(
  new URL(
    "../../../capture/desktop/ui/frontend/electron/settings/update-worker.cjs",
    import.meta.url,
  ),
);

const main = { channel: "main" as const, id: "a".repeat(40) };
const stable = { channel: "stable" as const, id: "v0.3.13" };
test("every installed branch/version converges on the chosen release", () => {
  for (const candidate of [main, stable]) {
    for (const installed of [
      null,
      { ...main, id: "fork-revision" },
      { ...stable, id: "v99.0.0" },
      { ...stable, id: "v0.1.0" },
      { ...stable, id: "unparseable" },
      candidate,
    ]) {
      const facts = {
        candidate,
        installed,
        revision: "b".repeat(40),
        modified: false,
      };
      assert.equal(needsChannelRelease(facts), installed !== candidate);
    }
  }
});
test("a clean unmarked Main package is current; a modified build is replaced", () => {
  const facts = {
    candidate: main,
    installed: null,
    revision: main.id,
    modified: false,
  };
  assert.equal(needsChannelRelease(facts), false);
  assert.equal(needsChannelRelease({ ...facts, modified: true }), true);
  assert.equal(needsChannelRelease({ ...facts, revision: null }), true);
});
test("installed identity wins over the still-running old executable after staging", () => {
  assert.equal(
    needsChannelRelease({
      candidate: stable,
      installed: stable,
      revision: main.id,
      modified: false,
    }),
    false,
  );
});
test("the packaged worker executes the same policy without repository imports", () => {
  for (const candidate of [main, stable]) {
    const facts: UpdateFacts = {
      candidate,
      installed: null,
      revision: main.id,
      modified: false,
    };
    const output = execFileSync(process.execPath, [script], {
      cwd: "/",
      encoding: "utf8",
      input: JSON.stringify({ operation: "needsChannelRelease", ...facts }),
    });
    assert.equal(JSON.parse(output), needsChannelRelease(facts));
  }
});

test("the packaged selector reads a multi-page history from stdin", () => {
  const release = (version: string) => {
    const name = `Apparent-${version}-linux-x86_64.AppImage`;
    return {
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      published_at: "2026-11-01T00:00:00Z",
      assets: [{ name }, { name: name + ".sha256" }],
    };
  };
  const releases = Array.from({ length: 999 }, () => release("2.9.0"));
  releases.push(release("2.10.0"));
  const request = {
    operation: "selectRelease",
    channel: "stable",
    arch: "x86_64",
    releases,
  };
  const output = execFileSync(process.execPath, [script], {
    cwd: "/",
    encoding: "utf8",
    input: JSON.stringify(request),
  });
  assert.deepEqual(JSON.parse(output), {
    kind: "selected",
    release: 999,
    image: 0,
    checksum: 1,
  });
  assert.deepEqual(selectRelease("stable", "aarch64", releases), {
    kind: "noRelease",
  });
  assert.deepEqual(selectRelease("stable", "riscv64", releases), {
    kind: "unsupported",
  });
});

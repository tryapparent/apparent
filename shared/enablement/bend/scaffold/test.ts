import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bendScratch } from "../build.ts";
import { bendDirectory } from "../manifest.ts";

const script = fileURLToPath(new URL("./run.ts", import.meta.url));

test("scaffold registers a starter, respects existing routes and prints the owner check", async () => {
  await bendScratch(async (root) => {
    const directory = bendDirectory("connect");
    const manifest = join(root, directory, "modules.json");
    const consumers = join(root, directory, "consumers.json");
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(join(root, directory, "build.ts"), "");
    writeFileSync(join(root, directory, "check.ts"), "");
    mkdirSync(join(root, "connect/src"));
    mkdirSync(join(root, "connect/lib"));
    writeFileSync(manifest, '{"modules":[],"inputs":["src/"]}\n');
    const routing = '{"connect/src/":["web","service"]}\n';
    writeFileSync(consumers, routing);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd: root,
        encoding: "utf8",
      });
    const help = run("--help");
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--consumers/);

    const first = run("connect/src/policy.bend");
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /node connect\/enablement\/ci\/bend\/check\.ts/);
    assert.match(
      readFileSync(join(root, "connect/src/policy.bend"), "utf8"),
      /def identity/,
    );
    assert.equal(readFileSync(consumers, "utf8"), routing);

    const before = readFileSync(manifest, "utf8");
    const attempts = [
      { args: ["connect/lib/other.bend"], error: /No consumer route/ },
      {
        args: ["connect/lib/other.bend", "--consumers", "bogus"],
        error: /Invalid consumer targets/,
      },
      { args: ["connect/lib/policy.bend"], error: /duplicate output/ },
      {
        args: ["connect/src/../escape.bend"],
        error: /invalid Bend source path/,
      },
    ];
    writeFileSync(join(root, "connect/src/existing.bend"), "owned by author\n");
    attempts.push({
      args: ["connect/src/existing.bend"],
      error: /already exists/,
    });
    symlinkSync(join(root, "connect/src"), join(root, "connect/link"));
    attempts.push({
      args: ["connect/link/link.bend"],
      error: /must be a real directory/,
    });
    for (const { args, error } of attempts) {
      const rejected = run(...args);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, error);
      assert.equal(readFileSync(manifest, "utf8"), before);
      assert.equal(readFileSync(consumers, "utf8"), routing);
      assert.equal(existsSync(join(root, directory, ".scaffold-lock")), false);
    }
    assert.equal(
      readFileSync(join(root, "connect/src/existing.bend"), "utf8"),
      "owned by author\n",
    );
    assert.equal(existsSync(join(root, "connect/lib/other.bend")), false);
    assert.equal(existsSync(join(root, "connect/src/link.bend")), false);

    const routed = run("connect/lib/other.bend", "--consumers", "web,service");
    assert.equal(routed.status, 0, routed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")), {
      modules: ["src/policy.bend", "lib/other.bend"],
      inputs: ["src/"],
    });
    assert.deepEqual(JSON.parse(readFileSync(consumers, "utf8")), {
      "connect/src/": ["web", "service"],
      "connect/lib/other.bend": ["web", "service"],
    });
  });
});

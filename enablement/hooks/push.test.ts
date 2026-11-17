import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";

const prepare = fileURLToPath(new URL("./prepare.ts", import.meta.url));
const legacy =
  "IyEvYmluL3NoCiMgR2l0IHN1cHBsaWVzIG9uZSBsb2NhbC9yZW1vdGUgcmVmIGFuZCBvYmplY3QtSUQgcGFpciBwZXIgbGluZSBvbiBzdGRpbi4Kc2V0IC1ldQoKcmVmcz0kKGNhdCkKWyAtbiAiJHJlZnMiIF0gfHwgZXhpdCAwCgpoZWFkPSQoZ2l0IHJldi1wYXJzZSAtLXZlcmlmeSBIRUFEKSB8fCBleGl0IDEKcHJpbnRmICclc1xuJyAiJHJlZnMiIHwgd2hpbGUgcmVhZCAtciBsb2NhbF9yZWYgbG9jYWxfb2lkIHJlbW90ZV9yZWYgcmVtb3RlX29pZDsgZG8KICAgIFsgLW4gIiRsb2NhbF9yZWYiIF0gJiYgWyAtbiAiJGxvY2FsX29pZCIgXSAmJgogICAgICAgIFsgLW4gIiRyZW1vdGVfcmVmIiBdICYmIFsgLW4gIiRyZW1vdGVfb2lkIiBdIHx8IGV4aXQgMQogICAgY2FzZSAiJGxvY2FsX29pZCIgaW4KICAgICAgICAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwKSBjb250aW51ZSA7OwogICAgZXNhYwogICAgaWYgWyAiJGxvY2FsX29pZCIgIT0gIiRoZWFkIiBdOyB0aGVuCiAgICAgICAgZWNobyAicHJlLXB1c2g6ICRsb2NhbF9yZWYgaXMgbm90IHRoZSBjaGVja2VkLW91dCBIRUFEOyBwdXNoIHRoZSB0ZXN0ZWQgSEVBRCBmcm9tIGl0cyBvd24gd29ya3RyZWUiID4mMgogICAgICAgIGV4aXQgMQogICAgZmkKZG9uZSB8fCBleGl0IDEKCiMgRGVsZXRpb24gc2VuZHMgbm8gbmV3IGNvbW1pdC4gQWxsIG90aGVyIHB1c2hlcyBtdXN0IHRlc3QgdGhlIHByZWNpc2UgdHJlZQojIGJlaW5nIHNlbnQsIG5vdCBhbiBvbGRlciBidWlsZCBvciBhIGRpcnR5IGNoZWNrb3V0J3MgZGlmZmVyZW50IGNvbnRlbnRzLgppZiAhIHByaW50ZiAnJXNcbicgIiRyZWZzIiB8IGdyZXAgLXF2ICcgMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCAnOyB0aGVuCiAgICBleGl0IDAKZmkKaWYgWyAtbiAiJChnaXQgc3RhdHVzIC0tcG9yY2VsYWluIC0tdW50cmFja2VkLWZpbGVzPW5vcm1hbCkiIF07IHRoZW4KICAgIGVjaG8gInByZS1wdXNoOiB3b3JraW5nIHRyZWUgaXMgZGlydHk7IGNvbW1pdCBvciByZW1vdmUgY2hhbmdlcyBiZWZvcmUgdmVyaWZpY2F0aW9uIiA+JjIKICAgIGV4aXQgMQpmaQppZiBnaXQgbHMtZmlsZXMgLXYgfCBMQ19BTEw9QyBncmVwIC1xICdeW2EtelNdICc7IHRoZW4KICAgIGVjaG8gInByZS1wdXNoOiBoaWRkZW4gaW5kZXggZmxhZ3MgKGFzc3VtZS11bmNoYW5nZWQgb3Igc2tpcC13b3JrdHJlZSk7IGNsZWFyIHRoZW0gYmVmb3JlIHZlcmlmaWNhdGlvbiIgPiYyCiAgICBleGl0IDEKZmkKCmVjaG8gInByZS1wdXNoOiB2ZXJpZnlpbmcgJGhlYWQgKGJ1aWxkIGFuZCBmdWxsIHRlc3Qgc3VpdGUpIiA+JjIKaWYgWyAtZiB0ZXN0cy90ZXN0X3ByZV9wdXNoX2d1YXJkLnB5IF0gJiYKICAgICEgcHl0aG9uMyAtbSB1bml0dGVzdCBkaXNjb3ZlciAtcyB0ZXN0cyAtcCB0ZXN0X3ByZV9wdXNoX2d1YXJkLnB5OyB0aGVuCiAgICBlY2hvICJwcmUtcHVzaDogaG9vayB0ZXN0cyBmYWlsZWQ7IHB1c2ggcmVqZWN0ZWQiID4mMgogICAgZXhpdCAxCmZpCmlmIGNvbW1hbmQgLXYgdGFza3BvbGljeSA+L2Rldi9udWxsIDI+JjE7IHRoZW4KICAgIHNldCAtLSB0YXNrcG9saWN5IC1jIHV0aWxpdHkgY2FyZ28KZWxzZQogICAgc2V0IC0tIGNhcmdvCmZpCmlmICEgIiRAIiBidWlsZCAtaiAzIC0tb2ZmbGluZTsgdGhlbgogICAgZWNobyAicHJlLXB1c2g6IGJ1aWxkIGZhaWxlZDsgcHVzaCByZWplY3RlZCIgPiYyCiAgICBleGl0IDEKZmkKaWYgISAiJEAiIHRlc3QgLWogMyAtLW9mZmxpbmUgLS0gLS10ZXN0LXRocmVhZHM9MjsgdGhlbgogICAgZWNobyAicHJlLXB1c2g6IHRlc3RzIGZhaWxlZDsgcHVzaCByZWplY3RlZCIgPiYyCiAgICBleGl0IDEKZmkKaWYgWyAiJChnaXQgcmV2LXBhcnNlIC0tdmVyaWZ5IEhFQUQpIiAhPSAiJGhlYWQiIF0gfHwKICAgIFsgLW4gIiQoZ2l0IHN0YXR1cyAtLXBvcmNlbGFpbiAtLXVudHJhY2tlZC1maWxlcz1ub3JtYWwpIiBdIHx8CiAgICBnaXQgbHMtZmlsZXMgLXYgfCBMQ19BTEw9QyBncmVwIC1xICdeW2EtelNdICc7IHRoZW4KICAgIGVjaG8gInByZS1wdXNoOiB3b3JraW5nIHRyZWUgY2hhbmdlZCBkdXJpbmcgdmVyaWZpY2F0aW9uOyBwdXNoIHJlamVjdGVkIiA+JjIKICAgIGV4aXQgMQpmaQo=";

test("exact legacy Cargo hook is backed up and retired into a worktree-relative maintained entrypoint", (t) => {
  const dir = mkdtempSync("/tmp/apparent-dev-push-install-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) delete env[name];
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  mkdirSync(join(dir, "old"));
  mkdirSync(join(dir, ".githooks"));
  const old = Buffer.from(legacy, "base64");
  assert.equal(
    createHash("sha256").update(old).digest("hex"),
    "8ba11032d420497f232f1096b6b8e52356abf5be264e7c18610eba888f95e920",
  );
  writeFileSync(join(dir, "old/pre-push"), old, { mode: 0o755 });
  writeFileSync(
    join(dir, ".githooks/pre-push"),
    '#!/bin/sh\ncat > .git/push-stdin\nprintf "%s\\n" "$*" > .git/push-args\nexit 7\n',
    { mode: 0o755 },
  );
  git("config", "core.hooksPath", "old");
  const output = join(dir, "prepared");
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      prepare,
      "--output",
      output,
      "--retire-verified-cargo-push",
    ],
    { cwd: dir, env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git("config", "--get", "core.hooksPath"), "old");
  assert.deepEqual(readFileSync(join(output, "preserved-pre-push")), old);
  assert.equal(
    JSON.parse(readFileSync(join(output, "provenance.json"), "utf8"))
      .retiredLegacyCargoPush,
    true,
  );
  const hook = spawnSync(join(output, "pre-push"), ["origin", "synthetic"], {
    cwd: dir,
    env,
    input: "payload\n",
    encoding: "utf8",
  });
  assert.equal(hook.status, 7);
  assert.equal(readFileSync(join(dir, ".git/push-stdin"), "utf8"), "payload\n");
  assert.equal(
    readFileSync(join(dir, ".git/push-args"), "utf8"),
    "origin synthetic\n",
  );
  writeFileSync(join(dir, "old/pre-push"), "#!/bin/sh\nexit 0\n");
  const rejected = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      prepare,
      "--output",
      join(dir, "rejected"),
      "--retire-verified-cargo-push",
    ],
    { cwd: dir, env, encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /does not match/);
});

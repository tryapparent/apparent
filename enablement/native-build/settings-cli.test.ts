import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../ci/settings-contract/catalog.ts";
import { samplePath } from "../ci/settings-contract/coverage.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("the shipped CLI discovers owner preferences and round-trips direct writes", (t) => {
  const binary = process.env.APPARENT_BIN;
  assert.ok(binary, "Point APPARENT_BIN at the exact rebuilt app");
  const home = mkdtempSync(join(tmpdir(), "apparent-dev-settings-cli-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = join(home, "config.json");
  writeFileSync(config, '{"unrelated":"keep"}', { mode: 0o600 });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: home,
    XDG_SESSION_TYPE: process.platform === "linux" ? "wayland" : undefined,
    APPARENT_CONFIG: config,
  };
  const settings = (...args: string[]) =>
    JSON.parse(
      execFileSync(binary, ["settings", ...args, "--json"], {
        cwd: home,
        env,
        encoding: "utf8",
        timeout: 10_000,
      }),
    );
  const catalog = loadCatalog(root);
  const samples = JSON.parse(readFileSync(join(root, samplePath), "utf8"));
  const byId = new Map<string, { id: string; available: boolean }>(
    settings("list").map((entry: { id: string; available: boolean }) => [
      entry.id,
      entry,
    ]),
  );
  assert.deepEqual([...byId.keys()].sort(), catalog.map(({ id }) => id).sort());

  for (const { id, effect } of catalog) {
    const entry = settings("get", id);
    assert.equal(entry.id, id);
    assert.equal(entry.present, false, id);
    if (effect || !byId.get(id)?.available) continue;

    const value = samples[id];
    assert.deepEqual(
      settings("set", id, JSON.stringify(value)).saved,
      value,
      id,
    );
    const [pane, key] = id.split(".");
    const stored = JSON.parse(readFileSync(config, "utf8"));
    assert.deepEqual(stored[pane][key], value, id);
    assert.equal(stored.unrelated, "keep");
    const changed = settings("get", id);
    assert.deepEqual(changed.saved, value, id);
    assert.deepEqual(changed.effective, value, id);
    assert.equal(settings("reset", id).present, false, id);
    assert.equal(settings("get", id).present, false, id);
  }
});

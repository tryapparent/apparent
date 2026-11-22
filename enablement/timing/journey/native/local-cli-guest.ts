import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

async function runGuestCli(
  app: string,
  scratch: string,
  output: string,
  inputs: (name: string) => string,
) {
  const run = promisify(execFile);
  const bundles = join(scratch, "cli-fixtures");
  await mkdir(bundles);
  await run("tar", ["-C", bundles, "-xf", inputs("cli-fixtures")], {
    timeout: 120000,
  });
  const manifest = join(scratch, "cli-fixtures.json");
  const fixtures = Object.fromEntries(
    ["short", "ink", "long"].map((key) => [
      key,
      join(bundles, key + ".apparent"),
    ]),
  );
  await writeFile(manifest, JSON.stringify(fixtures));
  const { stdout } = await run(
    process.execPath,
    [
      fileURLToPath(new URL("../local-cli.ts", import.meta.url)),
      app,
      scratch,
      manifest,
    ],
    {
      timeout: 300000,
      encoding: "utf8",
    },
  );
  const fragment = stdout.trimEnd();
  assert(fragment.startsWith(scratch + "/"));
  await copyFile(fragment, join(output, "cli-waits.json"));
}

const [app, scratch, output, libs, ...extra] = process.argv.slice(2);
assert(!extra.length && app && scratch && output && libs);
assert.match(scratch, /^\/tmp\/ag-[a-z0-9]+$/);
assert.equal(app, join(scratch, "app/squashfs-root/AppRun"));
assert.match(
  output,
  /^\/home\/[a-z0-9_-]+\/scrawl-gui-output-[a-f0-9]+\/artifacts$/,
);
await runGuestCli(app, scratch, output, (name) =>
  join(libs, "libbench.so." + name),
);

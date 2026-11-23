import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { chmod, cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { buildClient } from "../../../enablement/ci/build-client.ts";

export async function makeMcpScratch(label: string): Promise<string> {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), `apparent-dev-mcp-${label}-`),
  );
  await chmod(directory, 0o700);
  return directory;
}

export async function withClientFixture<T>(
  source: URL,
  run: (client: URL) => Promise<T>,
): Promise<T> {
  const directory = await makeMcpScratch("client");
  const client = pathToFileURL(directory + sep);
  try {
    for (const input of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "src",
    ]) {
      await cp(new URL(input, source), new URL(input, client), {
        recursive: true,
      });
    }
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: client,
      stdio: "inherit",
    });
    await buildClient(client);
    return await run(client);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function verifyClientIsolation<T>(
  test: TestContext,
  source: URL,
  transfer: (client: URL) => Promise<T>,
): Promise<T> {
  return withClientFixture(source, async (isolated) => {
    const removed = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const output = new URL("dist", source);
    const remove = fs.rm;
    const pause = test.mock.method(fs, "rm", async (target, options) => {
      await remove(target, options);
      if (target instanceof URL && target.href === output.href) {
        removed.resolve();
        await resume.promise;
      }
    });
    syncBuiltinESMExports();

    const rebuilt = buildClient(source);
    try {
      await Promise.race([
        removed.promise,
        rebuilt.then(() =>
          assert.fail("Rebuild finished before the reader check"),
        ),
      ]);
      await assert.rejects(
        transfer(source),
        /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find module '[^']+\/mcp-cli\.js'/,
      );
      return await transfer(isolated);
    } finally {
      pause.mock.restore();
      syncBuiltinESMExports();
      resume.resolve();
      await rebuilt;
    }
  });
}

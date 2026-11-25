import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { desktopPackage } from "../desktop-install.ts";
import type { Command } from "../run.ts";

export async function interruptedInstall(
  dir: string,
  env: NodeJS.ProcessEnv,
  commands: Command[],
) {
  const frontend = join(dir, desktopPackage);
  const pkg = JSON.parse(readFileSync(join(frontend, "package.json"), "utf8"));
  pkg.scripts.preinstall = "node --experimental-strip-types wait.ts";
  writeFileSync(join(frontend, "package.json"), JSON.stringify(pkg));
  const ready = join(dir, ".git", "install-ready");
  const release = join(dir, ".git", "install-release");
  writeFileSync(
    join(frontend, "wait.ts"),
    `
    import {existsSync, writeFileSync} from 'node:fs';
    writeFileSync(${JSON.stringify(ready)}, '');
    const deadline = Date.now() + 15000;
    while (!existsSync(${JSON.stringify(release)}) && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    if (!existsSync(${JSON.stringify(release)})) throw Error('Fixture install was not released');
  `,
  );
  const runner = new URL("../run.ts", import.meta.url).href;
  const args = [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `import {execute} from ${JSON.stringify(runner)}; execute(${JSON.stringify(commands)}, process.cwd());`,
  ];
  const options = { cwd: dir, env: { ...env, CI: "true" } };
  const owner = spawn(process.execPath, args, { ...options, stdio: "ignore" });
  const exited = new Promise<string | null>((resolve, reject) => {
    owner.once("error", reject);
    owner.once("exit", (_code, signal) => resolve(signal));
  });
  const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
  const probe = () =>
    spawnSync(process.execPath, args, {
      ...options,
      encoding: "utf8",
      timeout: 5000,
    });
  const deadline = Date.now() + 8000;
  try {
    while (
      !existsSync(ready) &&
      owner.exitCode === null &&
      Date.now() < deadline
    )
      await delay();
    assert.ok(
      existsSync(ready),
      "The actual npm install entered its lifecycle script",
    );
    assert.equal(owner.kill("SIGKILL"), true);
    assert.equal(await exited, "SIGKILL");
    const blocked = probe();
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.match(blocked.stderr, /Desktop dependency operation locked/);

    writeFileSync(release, "");
    let resumed = probe();
    while (
      resumed.status === 1 &&
      /Desktop dependency operation locked/.test(resumed.stderr) &&
      Date.now() < deadline
    ) {
      await delay();
      resumed = probe();
    }
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(readFileSync(join(dir, ".git", "checks"), "utf8"), "unit\n");
    assert.equal(
      existsSync(join(dir, ".git", "apparent-desktop-install.lock")),
      false,
    );
  } finally {
    writeFileSync(release, "");
    if (owner.exitCode === null && owner.signalCode === null) owner.kill();
    await exited;
  }
}

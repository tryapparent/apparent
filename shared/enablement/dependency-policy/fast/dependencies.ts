import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { git, type Snapshot } from "../snapshot.ts";
import type { Project } from "./projects.ts";

export const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("GIT_") &&
      !key.startsWith("NODE_") &&
      !/^npm_config_/i.test(key),
  ),
);

export function command(program: string, args: string[], cwd: string): string {
  const run = spawnSync(program, args, {
    cwd,
    env: childEnv,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.status !== 0)
    throw Error(
      run.error?.message ??
        run.stdout
          .split("\n")
          .filter((line) => !path.isAbsolute(line) || line.includes("error TS"))
          .join("\n") + run.stderr,
    );
  return run.stdout;
}

export function localPackages(
  snapshot: Snapshot,
  root: string,
): Map<string, string> {
  const found = new Map<string, string>();
  function visit(dir: string) {
    const manifest = JSON.parse(
      snapshot.files.get(path.posix.join(dir, "package.json")) ?? "{}",
    );
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, version] of Object.entries<string>(
        manifest[section] ?? {},
      )) {
        if (!version.startsWith("file:") || found.has(name)) continue;
        const target = path.posix.join(dir, version.slice(5));
        if (
          target === "." ||
          target.startsWith("../") ||
          path.isAbsolute(target) ||
          !snapshot.files.has(path.posix.join(target, "package.json"))
        )
          throw Error(
            `${dir}: local dependency ${name} needs a tracked package within the staged snapshot`,
          );
        found.set(name, target);
        visit(target);
      }
    }
  }
  visit(root);
  return found;
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const managers = new Map<string, string>();

export function cacheRoot(cwd: string): string {
  const root = `/tmp/apparent-dev-ts-deps-${process.getuid!()}-${hash(cwd).slice(0, 20)}`;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid!() ||
    info.mode & 0o077
  )
    throw Error(`TypeScript setup requires a private cache directory: ${root}`);
  return root;
}

export function lockedDependencies(
  cwd: string,
  tree: string,
  snapshot: Snapshot,
  project: Project,
  work: string,
  setup = false,
): string {
  const { root, lock } = project;
  const manager = lock.endsWith("bun.lock") ? "bun" : "npm";
  const manifestFile = path.posix.join(root, "package.json");
  const manifest = JSON.parse(snapshot.files.get(manifestFile) ?? "{}");
  if (
    !manifest.devDependencies?.typescript &&
    !manifest.dependencies?.typescript
  )
    throw Error(
      `${project.config}: declare TypeScript in ${manifestFile} and update ${lock}`,
    );
  if (!managers.has(manager)) {
    try {
      managers.set(manager, command(manager, ["--version"], cwd).trim());
    } catch {
      throw Error(
        `${project.config}: install ${manager} for the owner lockfile ${lock}`,
      );
    }
  }
  if (
    manifest.packageManager &&
    manifest.packageManager !== `${manager}@${managers.get(manager)}`
  )
    throw Error(
      `${project.config}: install the declared package manager ${manifest.packageManager}`,
    );
  const inputs = [
    lock,
    manifestFile,
    path.posix.join(root, ".npmrc"),
    path.posix.join(root, "bunfig.toml"),
    ...localPackages(snapshot, root).values(),
  ];
  const blobs = git(["ls-tree", "-z", tree, "--", ...inputs], cwd);
  const key = hash(
    JSON.stringify([
      manager === "bun" ? "v3" : "v1",
      root,
      blobs,
      process.versions,
      process.platform,
      process.arch,
      manager,
      managers.get(manager),
    ]),
  );
  const cache = cacheRoot(cwd);
  const entry = path.join(cache, key);
  const modules = path.join(entry, "node_modules");
  if (existsSync(path.join(modules, ".bin/tsc"))) return modules;
  if (!setup)
    throw Error(
      `${project.config}: locked TypeScript dependencies are missing for staged ${lock}. Run node shared/enablement/dependency-policy/fast/setup.ts --staged (outside the commit), then retry.`,
    );
  const args =
    manager === "bun"
      ? ["install", "--frozen-lockfile", "--ignore-scripts"]
      : [
          "ci",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--include=dev",
          "--prefer-offline",
        ];
  mkdirSync(entry, { recursive: true, mode: 0o700 });
  try {
    command(manager, args, work);
    const installed = path.join(work, "node_modules");
    if (manager === "bun") {
      for (const name of localPackages(snapshot, root).keys()) {
        const local = path.join(installed, name);
        const packed = local + ".staged-copy";
        command("cp", ["-RL", local, packed], work);
        rmSync(local, { recursive: true, force: true });
        renameSync(packed, local);
      }
    }
    if (!existsSync(path.join(installed, ".bin/tsc")))
      throw Error("no locked compiler installed");
    try {
      renameSync(installed, modules);
    } catch (error) {
      if (!existsSync(path.join(modules, ".bin/tsc"))) throw error;
      rmSync(installed, { recursive: true, force: true });
    }
    console.error(`Prepared locked TypeScript dependencies: ${root}`);
    return modules;
  } catch (error) {
    throw Error(
      `${root}: ${manager} setup failed for ${lock}: ${String(error)}`,
    );
  }
}

export function attachModules(
  modules: string,
  destination: string,
  local: Map<string, string>,
  stagedRoot: string,
): void {
  if (!local.size) {
    symlinkSync(modules, destination, "dir");
    return;
  }
  mkdirSync(destination, { recursive: true });
  function attach(from: string, to: string, name: string) {
    const target = local.get(name);
    if (target && lstatSync(from).isSymbolicLink()) {
      const link = readlinkSync(from);
      if (path.isAbsolute(link))
        throw Error(`${name}: unsupported absolute dependency link`);
      symlinkSync(path.join(stagedRoot, target), to, "dir");
    } else if (target) {
      cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    } else {
      symlinkSync(from, to);
    }
  }
  for (const name of readdirSync(modules)) {
    const from = path.join(modules, name),
      to = path.join(destination, name);
    if (
      name.startsWith("@") &&
      [...local.keys()].some((pkg) => pkg.startsWith(name + "/"))
    ) {
      mkdirSync(to);
      for (const pkg of readdirSync(from))
        attach(path.join(from, pkg), path.join(to, pkg), `${name}/${pkg}`);
    } else attach(from, to, name);
  }
}

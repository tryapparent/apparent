import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const [executable, archivePath] = process.argv
  .slice(2)
  .map((path) => resolve(path));
const staging = join(dirname(archivePath), "apparent-cli");
const runtime = join(staging, "lib");
mkdirSync(staging);
mkdirSync(runtime);

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: "utf8" });
const systemLibraries = new Set([
  "libgcc_s.so.1",
  ...run("rpm", ["-ql", "glibc"])
    .split("\n")
    .map((path) => basename(path)),
]);

const sourceDirectory = dirname(executable);
const backends = readdirSync(sourceDirectory)
  .filter((name) => /^libggml-cpu.*\.so$/.test(name))
  .map((name) => join(sourceDirectory, name));
if (backends.length === 0) throw Error("Missing packaged speech backends");
const libraries = new Map(
  backends.map((path) => [basename(path), realpathSync(path)]),
);
for (const input of [executable, ...backends]) {
  const report = run("ldd", [input]);
  if (/not found/.test(report)) throw Error(report);
  for (const match of report.matchAll(/^\s+(\S+) => (\/\S+) \(/gm)) {
    const [, name, path] = match;
    if (systemLibraries.has(name)) continue;
    const real = realpathSync(path);
    const prior = libraries.get(name);
    if (prior && prior !== real) throw Error(`Ambiguous dependency ${name}`);
    libraries.set(name, real);
  }
}

const binary = join(staging, "apparent");
copyFileSync(executable, binary);
run("patchelf", ["--set-rpath", "$ORIGIN/lib", binary]);
for (const [name, source] of libraries) {
  const destination = join(runtime, name);
  copyFileSync(source, destination);
  run("patchelf", ["--set-rpath", "$ORIGIN", destination]);
}
for (const file of [
  binary,
  ...Array.from(libraries.keys(), (name) => join(runtime, name)),
]) {
  const needs =
    run("readelf", ["--version-info", "--wide", file]).split(
      "Version needs section",
    )[1] ?? "";
  for (const [, major, minor] of needs.matchAll(/Name: GLIBC_(\d+)\.(\d+)/g)) {
    if (Number(major) > 2 || (Number(major) === 2 && Number(minor) > 34)) {
      throw Error(`${file} requires GLIBC_${major}.${minor}`);
    }
  }
}
copyFileSync("LICENSE", join(staging, "LICENSE"));
execFileSync("zip", ["-q", "-r", archivePath, basename(staging)], {
  cwd: dirname(staging),
});

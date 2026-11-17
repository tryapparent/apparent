import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const revision = "a867bb03fb35d4727ff0e9e2c0527745d4ff27cc";
export function context(job: string) {
  const runtime = path.resolve(job, "runtime");
  return {
    cwd: runtime,
    env: {
      ...process.env,
      HERMES_HOME: path.resolve(job, "profile"),
      PYTHONDONTWRITEBYTECODE: "1",
    },
    encoding: "utf8" as const,
    maxBuffer: 16 * 1024 * 1024,
  };
}

export function python(job: string, args: string[], capture = false): string {
  return (
    execFileSync("python3", args, {
      ...context(job),
      stdio: capture ? "pipe" : "inherit",
    }) || ""
  );
}

export function identity(job: string): string {
  return python(
    job,
    [
      "-c",
      `
import json, os, shutil, subprocess, sys
from pathlib import Path
from pm.environment import managed_environment
e = managed_environment(Path(sys.argv[1]), explicit=True)
probe = '''import json, os, sys, sysconfig
keys = [k for k in os.environ if k.startswith(("CARGO_BUILD_", "CARGO_TARGET_", "CARGO_PROFILE_", "PYO3_", "OPENSSL_", "CMAKE_")) or k in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUSTUP_TOOLCHAIN", "CC", "CXX", "AR", "CFLAGS", "CPPFLAGS", "CXXFLAGS", "LDFLAGS", "LDSHARED", "LDCXXSHARED", "SDKROOT", "DEVELOPER_DIR", "MACOSX_DEPLOYMENT_TARGET", "ARCHFLAGS", "PKG_CONFIG_PATH")]
print(json.dumps({"python": sys.version, "executable": os.path.realpath(sys.executable), "abi": sysconfig.get_config_vars("SOABI", "MULTIARCH", "CC", "CXX", "AR", "CFLAGS", "LDFLAGS", "MACOSX_DEPLOYMENT_TARGET"), "env": {k: os.environ[k] for k in sorted(keys)}}, sort_keys=True))'''
r = e._run(["run", "--no-project", "--no-config", "--python", str(e.python), str(e.python), "-c", probe], cwd=Path.cwd(), timeout=60)
if r.returncode: raise RuntimeError(r.stderr)
facts = json.loads(r.stdout)
facts["tools"] = {t: os.path.realpath(shutil.which(t, path=e.env.get("PATH")) or "missing") for t in ("cc", "c++", "clang", "clang++", "gcc", "g++", "ar", "cargo", "rustc", "pkg-config", "cmake")}
facts.update(uv=subprocess.check_output([str(e.uv), "--version"], text=True).strip(), cache=str(e.cache))
for tool, args in (("cc", ["--version"]), ("clang", ["--version"]), ("rustc", ["-vV"]), ("xcrun", ["--show-sdk-version"])):
    if not shutil.which(tool, path=e.env.get("PATH")): continue
    if tool == "xcrun" and sys.platform != "darwin": continue
    facts[tool] = subprocess.check_output([tool, *args], env=e.env, text=True).strip()
if sys.platform == "darwin":
    facts["sdkPath"] = subprocess.check_output(["xcrun", "--show-sdk-path"], env=e.env, text=True).strip()
print(json.dumps(facts, sort_keys=True))
`,
      path.resolve(job, "identity-probe"),
    ],
    true,
  ).trim();
}

export function prepare(job: string) {
  const options = context(job);
  const head = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
  if (head !== revision) throw new Error("Unexpected Hermes source");
  const lock = JSON.parse(
    readFileSync(path.join(options.cwd, "pm/lock.json"), "utf8"),
  );
  if (
    lock.packages.python.version !== "3.14.9+20261021" ||
    lock.packages.uv.version !== "0.13.5"
  )
    throw new Error("Unexpected PM pins");
  python(job, [
    "-c",
    'import tomllib; assert tomllib.load(open("pyproject.toml", "rb"))["tool"]["uv"]["default-groups"] == []',
  ]);
  mkdirSync(options.env.HERMES_HOME, { mode: 0o700 });
  python(job, ["-m", "pm.cli", "install", "uv", "python"]);
  const value = identity(job);
  const facts = JSON.parse(value);
  if (!facts.uv.startsWith("uv 0.13.5 ") || !facts.python.startsWith("3.14.9 "))
    throw new Error("Unexpected installed tools");
  if (path.resolve(facts.cache) !== path.resolve(job, "profile/cache/uv"))
    throw new Error("Cache escaped job");
  writeFileSync(path.join(job, "validator-identity.json"), value + "\n");
  console.log(value);
}

export function check(job: string) {
  if (
    identity(job) !==
    readFileSync(path.join(job, "validator-identity.json"), "utf8").trim()
  )
    throw new Error("Managed build inputs changed within the job");
}

export function install(
  job: string,
  source = path.resolve(job, "runtime"),
  out = path.join(source, ".venv"),
  offline = false,
) {
  check(job);
  if (existsSync(out)) throw new Error("Validator destination must be fresh");
  python(job, [
    "-m",
    "pm.build_env",
    "--source",
    source,
    "--out",
    out,
    ...(offline ? ["--offline"] : []),
  ]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [mode, job] = process.argv.slice(2);
  if (!job) throw new Error("Expected prepare|install|check JOB");
  if (mode === "prepare") prepare(job);
  else if (mode === "install") install(job);
  else if (mode === "check") check(job);
  else throw new Error("Expected prepare|install|check JOB");
}

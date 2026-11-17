import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { context, identity, revision } from "../../enablement/ci/validator.ts";
import { snapshot } from "./downloads.ts";

test("real PM: one source build, two fresh venvs, cold/failure boundaries", {
  skip: !process.env.HERMES_NATIVE_PROOF_JOB,
  timeout: 900_000,
}, async () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const options = context(job);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
    revision,
  );
  const before = identity(job);
  console.log("native proof input identity", before);
  const sdist = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        'import json,tomllib; print(json.dumps(next(p["sdist"] for p in tomllib.load(open("uv.lock","rb"))["package"] if p["name"]=="cryptography")))',
      ],
      options,
    ),
  );
  const source = path.join(job, "native-source");
  mkdirSync(source);
  writeFileSync(
    path.join(source, "pyproject.toml"),
    `[project]\nname="native-cache-proof"\nversion="0.0.0"\nrequires-python=">=3.14"\ndependencies=["cryptography @ ${sdist.url}#${sdist.hash.replace(":", "=")}"]\n`,
  );
  execFileSync(
    "python3",
    ["-m", "pm.build_env", "--source", source, "--lock-only"],
    { ...options, stdio: "inherit" },
  );
  function build(name: string, offline: boolean, extra: string[] = []) {
    const out = path.join(job, name);
    assert.equal(existsSync(out), false);
    const result = spawnSync(
      "python3",
      [
        "-m",
        "pm.build_env",
        "--source",
        source,
        "--out",
        out,
        ...(offline ? ["--offline"] : []),
        ...extra,
      ],
      {
        ...options,
        env: { ...options.env, HERMES_VERBOSE: "1" },
        timeout: 600_000,
      },
    );
    writeFileSync(
      path.join(job, `${name}.log`),
      `${result.stdout || ""}${result.stderr || ""}`,
    );
    return { out, result, log: `${result.stdout || ""}${result.stderr || ""}` };
  }
  const first = build("native-first", false);
  assert.equal(first.result.status, 0, first.log);
  assert.equal((first.log.match(/Building cryptography/g) || []).length, 1);
  const second = build("native-second", true);
  assert.equal(second.result.status, 0, second.log);
  assert.equal((second.log.match(/Building cryptography/g) || []).length, 0);
  for (const out of [first.out, second.out])
    assert.equal(
      execFileSync(
        path.join(out, "bin/python"),
        [
          "-c",
          'from cryptography.hazmat.primitives import hashes; h=hashes.Hash(hashes.SHA256()); h.update(b"native proof"); print(len(h.finalize()))',
        ],
        { encoding: "utf8" },
      ).trim(),
      "32",
    );
  assert.equal(identity(job), before);
  const old = spawnSync(
    "python3",
    ["-m", "pm.build_env", "--source", source, "--out", second.out],
    options,
  );
  assert.notEqual(old.status, 0);
  const missingCache = path.join(job, "empty-cache");
  const failed = build("native-failed", true, ["--cache", missingCache]);
  assert.notEqual(failed.result.status, 0);
  assert.equal(existsSync(failed.out), false);
  writeFileSync(
    path.join(source, "pyproject.toml"),
    '[project]\nname="native-cache-proof"\nversion="0.0.0"\nrequires-python=">=3.14"\ndependencies=["apparent-deliberately-missing-cache-proof==0.0.0"]\n',
  );
  const incompatible = spawnSync(
    "python3",
    ["-m", "pm.build_env", "--source", source, "--lock-only", "--offline"],
    options,
  );
  assert.notEqual(incompatible.status, 0);
});

test("real pinned uv downloaded-only export after native builds", {
  skip: !process.env.HERMES_NATIVE_PROOF_JOB,
  timeout: 900_000,
}, async () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const downloads = path.join(job, "native-downloads-v7");
  await snapshot(path.join(job, "profile/cache/uv"), downloads);
  assert.equal(existsSync(path.join(downloads, "sdists-v10")), false);
  assert.equal(existsSync(path.join(downloads, "builds-v0")), false);
  rmSync(path.join(job, "native-first"), { recursive: true });
  assert.equal(
    execFileSync(
      path.join(job, "native-second/bin/python"),
      ["-c", "import cryptography; print(cryptography.__version__)"],
      { encoding: "utf8" },
    ).trim(),
    "50.0.2",
  );
});

test("real input guard accepts the validator PATH and rejects changed native flags", {
  skip: !process.env.HERMES_NATIVE_PROOF_JOB,
  timeout: 900_000,
}, () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const args = [
    "--experimental-strip-types",
    "hermes/enablement/ci/validator.ts",
    "check",
    job,
  ];
  const env = {
    ...process.env,
    PATH: path.join(job, "runtime/.venv/bin") + ":" + process.env.PATH,
  };
  assert.equal(spawnSync("node", args, { env }).status, 0);
  assert.notEqual(
    spawnSync("node", args, {
      env: { ...env, CFLAGS: "-DAPPARENT_INCOMPATIBLE_BUILD=1" },
    }).status,
    0,
  );
});

test("real frozen validator retains producer lock bytes and excludes dev tooling", {
  skip: !process.env.HERMES_NATIVE_PROOF_JOB,
  timeout: 900_000,
}, () => {
  const job = process.env.HERMES_NATIVE_PROOF_JOB!;
  const options = context(job);
  execFileSync(
    "git",
    ["diff", "--exit-code", "--", "uv.lock", "pyproject.toml"],
    options,
  );
  execFileSync(
    path.join(job, "runtime/.venv/bin/python"),
    [
      "-c",
      `
import importlib.metadata, tomllib
assert tomllib.load(open("pyproject.toml", "rb"))["tool"]["uv"]["default-groups"] == []
for name in ("pytest", "ruff", "debugpy"):
    try: importlib.metadata.distribution(name)
    except importlib.metadata.PackageNotFoundError: pass
    else: raise AssertionError("unexpected dev dependency: " + name)
`,
    ],
    options,
  );
});

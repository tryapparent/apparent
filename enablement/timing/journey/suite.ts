import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble, type Part } from "./assemble.ts";
import { contract, contractHash, type Receipt } from "./score.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const journey = join(repo, "enablement/timing/journey");
const record = join(repo, "record/enablement/performance");
const connect = join(repo, "connect/enablement/benchmark");
const settings = join(repo, "composition/settings/enablement/performance.ts");
const node = process.execPath;
const [configArg, jobArg, ...extra] = process.argv.slice(2);
assert(
  configArg && jobArg && !extra.length,
  "Usage: suite.ts PLAN.json PRIVATE_JOB",
);
const config = JSON.parse(await readFile(configArg, "utf8")) as {
  revision: string;
  template: string;
  user: string;
  appImage: string;
  appImageSha256: string;
  model: string;
  previewModel: string;
  chromium: string;
  connectTarget: string;
};
const job = await realpath(jobArg);
const permissions = await stat(job);
assert.match(job, /^\/tmp\/apparent-dev-[a-zA-Z0-9_-]+$/);
assert.equal(permissions.uid, process.getuid?.());
assert.equal(permissions.mode & 0o777, 0o700);
process.umask(0o077);

const git = (args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
assert.match(config.revision, /^[a-f0-9]{40}$/);
assert.equal(config.revision, git(["rev-parse", "HEAD"]));
assert.equal(git(["status", "--porcelain"]), "", "Use a clean pinned checkout");
const user = config.user;
assert.match(user, /^[a-z][a-z0-9_-]+$/);
const [template, image, model, preview, chrome, connectTarget] =
  await Promise.all(
    [
      config.template,
      config.appImage,
      config.model,
      config.previewModel,
      config.chromium,
      config.connectTarget,
    ].map((file) => realpath(file)),
  );
const read = async <T>(file: string) =>
  JSON.parse(await readFile(file, "utf8")) as T;
const save = (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest("hex");
}
assert.equal(
  await hash(image),
  config.appImageSha256,
  "AppImage SHA-256 mismatch",
);
assert.match(config.appImageSha256, /^[a-f0-9]{64}$/);
const executable = join(job, "extracted/squashfs-root/AppRun");
await mkdir(join(job, "extracted"));

const env = { ...process.env };
const hostService = {
  XDG_RUNTIME_DIR:
    process.env.XDG_RUNTIME_DIR ?? "/run/user/" + process.getuid?.(),
  DBUS_SESSION_BUS_ADDRESS:
    process.env.DBUS_SESSION_BUS_ADDRESS ??
    "unix:path=/run/user/" + process.getuid?.() + "/bus",
};
for (const key of Object.keys(env))
  if (key.startsWith("APPARENT_BENCH_")) delete env[key];
for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS"])
  delete env[key];
const runtime = join(job, "runtime");
await mkdir(runtime, { mode: 0o700 });
env.XDG_RUNTIME_DIR = runtime;
const temp = join(job, "temp");
await mkdir(temp);
env.TMPDIR = temp;
env.PATH = dirname(node) + ":" + env.PATH;
async function command(
  where: string,
  label: string,
  program: string,
  args: string[],
  options: { cwd?: string; environment?: Record<string, string> } = {},
) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? repo,
    env: { ...env, ...options.environment },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  await writeFile(join(where, label + ".log"), result.stdout ?? "", {
    flag: "wx",
  });
  await writeFile(join(where, label + ".err"), result.stderr ?? "", {
    flag: "wx",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, label + " failed in " + where);
  return result.stdout.trim();
}
await command(job, "extract", image, ["--appimage-extract"], {
  cwd: dirname(dirname(executable)),
});
const version = await command(job, "version", executable, ["--version"]);
const stamp = /^apparent\s+\S+\s+·\s+([a-f0-9]{7,40})$/.exec(version)?.[1];
assert(
  stamp && config.revision.startsWith(stamp),
  "AppImage needs the pinned checkout stamp",
);
const checks = [
  "connect/client/typescript/node_modules/typescript/package.json",
  "connect/service/node_modules/playwright-core/package.json",
  "capture/desktop/ui/frontend/node_modules/@playwright/test/package.json",
];
for (const file of checks) assert((await stat(join(repo, file))).isFile());
for (const owner of ["connect/client/typescript", "connect/service"])
  await command(job, owner.split("/").at(-1) + "-build", "npm", [
    "run",
    "--prefix",
    owner,
    "build",
  ]);
const test = await command(
  job,
  "connect-build",
  "t3-build",
  [
    "--jobs",
    "3",
    "--min-jobs",
    "1",
    "cargo",
    "test",
    "--locked",
    "--offline",
    "-p",
    "apparent-connect-client",
    "--no-run",
    "--message-format=json",
  ],
  { environment: { ...hostService, CARGO_TARGET_DIR: connectTarget } },
);
const compiled = test
  .trim()
  .split("\n")
  .map((row) => JSON.parse(row))
  .find(
    (row) =>
      row.reason === "compiler-artifact" &&
      row.target.name === "apparent_connect_client" &&
      row.profile.test &&
      row.executable,
  );
assert(compiled?.executable, "No pinned Connect fixture executable");

const paths = git([
  "ls-files",
  "enablement/timing/journey",
  "record/enablement/performance",
  "shared/enablement/performance",
  "onboarding/enablement/performance.ts",
  "composition/settings/enablement/performance.ts",
  "composition/pill/enablement/handoff-timing.ts",
  "connect/enablement/benchmark",
  "capture/desktop/scripts/linux/gui",
]);
const inputHashes = Object.fromEntries(
  await Promise.all(
    paths.split("\n").map(async (file) => [file, await hash(join(repo, file))]),
  ),
);
const recipe = {
  contractHash,
  vcpus: contract.limits.vcpus,
  memoryMiB: 6144,
  user,
  template: await hash(join(template, "system.qcow2")),
  firmware: await hash(join(template, "OVMF_VARS.fd")),
  model: await hash(model),
  previewModel: await hash(preview),
  chromium: await hash(chrome),
  node: await hash(node),
  host: (await readFile("/etc/machine-id", "utf8")).trim(),
  hostKernel: (await readFile("/proc/sys/kernel/osrelease", "utf8")).trim(),
  qemu: await command(job, "qemu-version", "qemu-system-x86_64", ["--version"]),
  inputHashes,
};
const runner =
  "clanker-omarchy-" +
  createHash("sha256").update(JSON.stringify(recipe)).digest("hex");
await save(join(job, "recipe.json"), {
  ...recipe,
  host: createHash("sha256").update(recipe.host).digest("hex"),
  runner,
  revision: config.revision,
  imageSha256: config.appImageSha256,
});
const receipts: Receipt[] = [];

async function execute(index: number) {
  const lane = join(job, "run-" + index);
  await mkdir(lane);
  const manifest: Record<string, string> = {};
  const parts: Part[] = [];
  async function collect(label: string, file: string) {
    parts.push(await read<Part>(file));
    manifest[label] = relative(lane, file);
    await writeFile(
      join(lane, "fragments.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  async function native(
    label: string,
    environment: Record<string, string> = {},
  ) {
    const evidence = await mkdtemp("/tmp/apparent-dev-journey-" + label + "-");
    await save(join(lane, label + "-job.json"), { evidence });
    await command(
      lane,
      label,
      node,
      [
        join(journey, "native/run.ts"),
        template,
        user,
        image,
        config.appImageSha256,
        model,
        evidence,
      ],
      { environment: { ...hostService, ...environment } },
    );
    return join(evidence, "vm");
  }
  async function report(label: string, script: string, vm: string) {
    await command(lane, label, node, [script, vm]);
    await collect(label, join(lane, label + ".log"));
  }
  const corpus = await native("corpus");
  await report(
    "recording",
    join(journey, "native/recording-report.ts"),
    corpus,
  );
  const surface = await native("surface", {
    APPARENT_BENCH_SURFACE: "1",
    APPARENT_BENCH_MEDIA: "1",
    APPARENT_BENCH_INK: "1",
    APPARENT_BENCH_DETAIL: "1",
    APPARENT_BENCH_PREVIEW_MODEL: preview,
  });
  await report("surface-report", join(record, "start-report.ts"), surface);

  try {
    const practice = await native("practice", {
      APPARENT_BENCH_ONBOARDING: "1",
    });
    await collect(
      "practice",
      join(practice, "artifacts/artifacts/onboarding-waits.json"),
    );
  } catch (error) {
    console.error("First-success proof unavailable: " + String(error));
  }

  const settingsVm = await native("settings", {
    APPARENT_BENCH_SETTINGS: settings,
  });
  await collect(
    "launch",
    join(settingsVm, "artifacts/artifacts/launch-waits.json"),
  );
  await collect(
    "settings",
    join(settingsVm, "artifacts/artifacts/settings-waits.json"),
  );

  async function bundle(fixture: string) {
    const receipt = await read<{ bundle_path: string; status: string }>(
      join(corpus, "artifacts/artifacts", fixture + "-stop.json"),
    );
    assert.equal(receipt.status, "saved");
    const name = basename(receipt.bundle_path);
    assert.match(name, /^apparent-[a-zA-Z0-9-]+\.apparent$/);
    return join(corpus, "artifacts/captures", name);
  }
  const short = await bundle("quick-voice");
  const fixtures = join(lane, "fixtures.json");
  await save(fixtures, {
    short,
    ink: await bundle("editor-nine-strokes"),
    long: await bundle("long-narration"),
  });
  const local = await native("local-cli", {
    APPARENT_BENCH_LOCAL_CLI_FIXTURES: fixtures,
  });
  await collect("local-cli", join(local, "artifacts/artifacts/cli-waits.json"));

  const expectedFiles = [
    "apparent.json",
    "contact-sheet.png",
    "frames/frame-01.png",
  ];
  await save(join(lane, "connect-assets.json"), {
    expectedFiles: Object.fromEntries(
      await Promise.all(
        expectedFiles.map(async (file) => [
          file,
          await hash(join(short, file)),
        ]),
      ),
    ),
    selectedFiles: expectedFiles.slice(1),
    summaryMarker: "First, open the project settings",
  });
  const connectCli = await command(
    lane,
    "connect-cli",
    compiled.executable,
    ["--ignored", "--nocapture", "benchmark_connect_cli"],
    {
      environment: {
        APPARENT_BENCH_BINARY: executable,
        APPARENT_BENCH_CONNECT_BUNDLE: short,
        APPARENT_BENCH_RESULTS: lane,
      },
    },
  );
  const cliReceipt = connectCli
    .split("\n")
    .find(
      (line) =>
        line.startsWith(lane + "/") && line.endsWith("/connect-cli-waits.json"),
    );
  assert(cliReceipt, "Missing verified Connect CLI receipt");
  await collect("connect-cli", cliReceipt);

  await command(
    lane,
    "handoff",
    "xvfb-run",
    [
      "-a",
      node,
      "--test",
      join(repo, "composition/pill/enablement/handoff-timing.ts"),
    ],
    {
      environment: {
        APPARENT_BENCH_HANDOFF_ROOT: dirname(executable),
        APPARENT_BENCH_RESULTS: lane,
      },
    },
  );
  await collect("handoff", join(lane, "t3-handoff-waits.json"));

  const recipient = await command(
    lane,
    "recipient",
    node,
    [join(connect, "recipient.ts"), lane, chrome],
    {
      cwd: join(repo, "connect/service"),
    },
  );
  assert(
    recipient.startsWith(lane + "/") &&
      recipient.endsWith("/connect-recipient-waits.json"),
  );
  await collect("recipient", recipient);

  const { receipt, coverage } = assemble(
    {
      revision: config.revision,
      runner,
      runId: basename(job) + "-" + index,
      vcpus: recipe.vcpus,
    },
    parts,
  );
  await save(join(lane, "run.json"), receipt);
  await save(join(lane, "coverage.json"), coverage);
  assert(
    coverage.complete,
    "Journey coverage is incomplete: " + JSON.stringify(coverage),
  );
  return receipt;
}
for (const index of [1, 2]) receipts.push(await execute(index));
const ledger = join(job, "ledger.json");
await save(ledger, { reference: receipts, attempts: [] });
await command(job, "baseline", node, [
  join(journey, "run.ts"),
  "evaluate",
  ledger,
]);
console.log(join(job, "baseline.log"));

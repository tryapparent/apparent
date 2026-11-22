import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { commands } from "../../../local-tests/run.ts";
import { currentStream } from "../streams.ts";
import { serviceOnlyRange } from "../../../../shared/enablement/ci/connect-inputs.ts";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
type Step = {
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};
type Workflow = {
  jobs: Record<string, { if: string; steps: Step[] }>;
  on: Record<string, { paths: string[] }>;
};
const workflow = (name: string) =>
  Bun.YAML.parse(read(".github/workflows/" + name)) as Workflow;
const general = workflow("checks.yml");
const connect = workflow("stream-connect.yml");
const service = "connect/service/src/reporting/aggregate-dau.ts";
const contract = "connect/client/typescript/src/transfer/contract.ts";
const shared = "shared/ui/package.json";
const dynamic = "connect/service/src/worker.ts";
const ffmpeg = "connect/enablement/ci/recipient-ffmpeg.ts";
const aNewConsumer = "composition/desktop-activity.ts";
const flows = [
  [general, "checks.yml"],
  [connect, "stream-connect.yml"],
] as const;

test("the committed repository retains the audited service-only consumer boundary", () => {
  assert.equal(
    serviceOnlyRange("HEAD", "HEAD", [service], root.pathname),
    true,
  );
});

function condition(
  job: { if: string },
  github: object,
  needs: object,
  isCancelled = false,
) {
  return Function(
    "github",
    "needs",
    "cancelled",
    "vars",
    `return (${job.if})`,
  )(github, needs, () => isCancelled, { HOSTED_CD_ENABLED: "true" });
}

test("real Connect diffs route hosted delivery and retain Desktop contract integration", {
  timeout: 20_000,
}, () => {
  const cwd = mkdtempSync(join(tmpdir(), "apparent-dev-connect-delivery-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), value);
  };
  const commit = (label: string) => {
    git("add", "-A");
    git("commit", "--allow-empty", "-qm", label);
    return git("rev-parse", "HEAD");
  };
  const run = (
    workflow: Workflow,
    event: string,
    before: string,
    head: string,
    admit = true,
  ) => {
    const step = workflow.jobs.select.steps.find(
      (value) => value.id === "paths",
    );
    const github = {
      event_name: event,
      sha: head,
      event: { before, pull_request: { base: { sha: "stale" } } },
    };
    const range = Function(
      "github",
      "format",
      `return (${step!.env!.BASE_SHA.slice(3, -2)})`,
    )(github, (pattern: string, value: string) =>
      pattern.replace("{0}", value),
    );
    const output = join(cwd, ".git", "output");
    rmSync(output, { force: true });
    const [bun, entry, ...flags] = step!.run!.split(" ");
    const result = spawnSync(
      bun,
      [new URL(entry, root).pathname, ...(admit ? flags : [])],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...env,
          BASE_SHA: range,
          GITHUB_SHA: head,
          GITHUB_EVENT_NAME: event,
          GITHUB_REF:
            event === "push" ? "refs/heads/main" : "refs/pull/1/merge",
          GITHUB_OUTPUT: output,
        },
      },
    );
    if (result.status !== 0)
      return { error: result.stderr, outputs: {} as Record<string, string> };
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    return { error: "", outputs };
  };
  const trigger = (workflow: Workflow, event: string, paths: string[]) =>
    paths.some((path) =>
      workflow.on[event].paths.reduce(
        (match: boolean, pattern: string) =>
          new Bun.Glob(pattern.replace(/^!/, "")).match(path)
            ? !pattern.startsWith("!")
            : match,
        false,
      ),
    );
  try {
    git("init", "-q");
    git("config", "core.hooksPath", join(cwd, ".git", "hooks"));
    git("config", "user.name", "Synthetic");
    git("config", "user.email", "synthetic@example.invalid");
    for (const path of [service, contract, shared, dynamic, ffmpeg])
      put(path, read(path));
    const base = commit("baseline");
    const cases = [
      ["edit", [service], () => put(service, read(service) + "\n"), false],
      ["delete", [service], () => rmSync(join(cwd, service)), false],
      [
        "FFmpeg cache",
        [ffmpeg],
        () => put(ffmpeg, read(ffmpeg) + "\n"),
        false,
        true,
      ],
      [
        "contract",
        [contract],
        () => put(contract, read(contract) + "\n"),
        true,
      ],
      ["runtime", [dynamic], () => put(dynamic, read(dynamic) + "\n"), true],
      ["shared", [shared], () => put(shared, read(shared) + "\n"), true],
      [
        "rename",
        [service, "connect/service/src/reporting/renamed.ts"],
        () => git("mv", service, "connect/service/src/reporting/renamed.ts"),
        true,
      ],
      [
        "mixed",
        [service, contract],
        () => {
          put(service, read(service) + "\n");
          put(contract, read(contract) + "\n");
        },
        true,
      ],
    ] as const;
    for (const [
      label,
      expected,
      change,
      desktop,
      generalTrigger = desktop,
    ] of cases) {
      git("reset", "--hard", base);
      change();
      const head = commit(label);
      const paths = git(
        "diff",
        "--name-only",
        "--no-renames",
        base,
        head,
      ).split("\n");
      assert.deepEqual(paths.sort(), [...expected].sort(), label);
      for (const event of ["pull_request", "push"]) {
        for (const [workflow, name] of flows)
          assert.equal(
            trigger(workflow, event, paths),
            name === "stream-connect.yml" || generalTrigger,
            label,
          );
        const repository = run(general, event, base, head);
        const owner = run(connect, event, base, head);
        assert.equal(repository.error, "", label);
        assert.equal(owner.error, "", label);
        assert.equal(repository.outputs.platform, String(desktop), label);
        assert.equal(repository.outputs.installer, String(desktop), label);
        assert.equal(JSON.parse(repository.outputs.plan).service, true, label);
        assert.equal(
          owner.outputs.native,
          String(desktop || event === "push"),
          label,
        );
        assert.equal(owner.outputs.portable, "true", label);
        assert.equal(JSON.parse(owner.outputs.plan).service, true, label);
        assert.equal(owner.outputs.publish, "true", label);
        assert.equal(
          currentStream("capture", base, head, cwd),
          !desktop,
          label,
        );
        assert.equal(currentStream("connect", base, head, cwd), false, label);
        const github = {
          event_name: event,
          repository: "tryapparent/apparent",
          ref: "refs/heads/main",
          event: { pull_request: { draft: false } },
        };
        const success = { result: "success" };
        const needs = {
          select: { ...success, outputs: owner.outputs },
          contracts: success,
          portable: success,
          linux: {
            result: owner.outputs.native === "true" ? "success" : "skipped",
          },
        };
        assert.equal(
          condition(connect.jobs.linux, github, needs),
          desktop || event === "push",
          label,
        );
        assert.equal(
          condition(general.jobs.linux, github, {
            ...needs,
            select: { ...success, outputs: repository.outputs },
            "record-media": success,
            reuse: { outputs: {} },
          }),
          desktop,
          label,
        );
        assert.equal(
          condition(connect.jobs.admit, github, needs),
          event === "push",
          label,
        );
        assert.equal(
          condition(connect.jobs.admit, github, {
            ...needs,
            linux: { result: "failure" },
          }),
          false,
          label,
        );
        assert.equal(
          condition(connect.jobs.admit, github, {
            ...needs,
            portable: { result: "skipped" },
          }),
          false,
          label,
        );
        assert.equal(
          condition(connect.jobs.admit, github, {
            ...needs,
            select: { ...success, outputs: { ...owner.outputs, publish: "" } },
          }),
          false,
          label,
        );
        assert.equal(
          condition(connect.jobs.admit, github, needs, true),
          false,
          label,
        );
      }
    }
    git("reset", "--hard", base);
    const addedTest = "connect/service/test/lifecycle/aggregate-dau.test.ts";
    put(addedTest, read(addedTest));
    const addition = commit("service test addition");
    assert.equal(trigger(general, "push", [addedTest]), false);
    assert.equal(
      run(general, "push", base, addition).outputs.platform,
      "false",
    );
    assert.equal(run(connect, "push", base, addition).outputs.publish, "true");

    assert.match(
      run(connect, "push", "missing", addition).error,
      /Unknown history/,
    );
    assert.equal(
      run(connect, "push", "missing", addition, false).outputs.native,
      "true",
    );
    assert.equal(
      run(general, "push", "missing", addition, false).outputs.platform,
      "true",
    );
    put(
      aNewConsumer,
      "export const runtimeInput = 'connect/service/src/reporting/aggregate-dau.ts';",
    );
    const withConsumer = commit("added dynamic Desktop input");
    put(service, read(service) + "\n");
    const edited = commit("service edit after new input");
    assert.match(
      run(connect, "push", withConsumer, edited).error,
      /outside the automatic workflow filters/,
    );
    rmSync(join(cwd, aNewConsumer));
    put(service, read(service) + "\n\n");
    const removed = commit("removed dynamic Desktop input");
    assert.equal(
      run(general, "push", withConsumer, removed).outputs.platform,
      "true",
    );
    assert.equal(
      JSON.parse(run(general, "push", withConsumer, removed).outputs.plan)
        .tools,
      true,
    );
    assert.equal(currentStream("capture", withConsumer, removed, cwd), false);
    rmSync(join(cwd, service));
    symlinkSync("unproven.ts", join(cwd, service));
    const typeChanged = commit("unsupported service mode");
    assert.match(
      run(connect, "push", removed, typeChanged).error,
      /outside the automatic workflow filters/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("owner portable verification keeps the service suite and its Ubuntu dependencies", () => {
  for (const [workflow, name] of flows) {
    const steps = workflow.jobs.portable.steps;
    const apt = steps.findIndex(
      (step) => step.uses === "./.github/actions/ubuntu-apt",
    );
    const run = steps.findIndex(
      (step) =>
        step.run ===
        "node --experimental-strip-types enablement/ci/routing/run.ts --portable",
    );
    assert.ok(apt >= 0 && apt < run, name);
    assert.equal(steps[apt].if, "runner.os == 'Linux'");
    assert.equal(
      steps[run].env?.VERIFICATION_PLAN,
      "${{ needs.select.outputs.plan }}",
    );
  }
  const selected = commands(
    ["service", "web"],
    "unknown",
    "HEAD",
    "linux",
    false,
  ).slice(1);
  for (const [cwd, script] of [
    ["connect/service", "test"],
    ["connect/service", "test:mcp"],
    ["connect/service", "test:recipient"],
    ["connect/web", "test"],
    ["connect/tooling/hosting", "test"],
  ])
    assert.ok(
      selected.some(
        (command) => command.cwd === cwd && command.argv.at(-1) === script,
      ),
      cwd + " " + script,
    );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { YAML } from "bun";

const root = process.cwd();
const jobs = YAML.parse(
  readFileSync(".github/workflows/checks.yml", "utf8"),
).jobs;
const evaluate = (expression: string, scope: Record<string, unknown>) =>
  Function(
    ...Object.keys(scope),
    `return (${expression})`,
  )(...Object.values(scope));

test("committed candidate routing selects the workflow contract commands and preserves admission", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "apparent-dev-contract-routing-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: clean }).trim();
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "candidate",
    );
    return git("rev-parse", "HEAD");
  };
  const native = "capture/desktop/linux/capture/portal.rs";
  const theme = "public/site/src/fixture.css";
  const release = "composition/enablement/release/mac/inputs.ts";
  const verifier = "enablement/verification.py";
  const workflow = ".github/workflows/checks.yml";
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  for (const path of [native, theme, release, verifier, workflow]) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), "");
  }
  cpSync("shared/ui/scripts", join(cwd, "shared/ui/scripts"), {
    recursive: true,
  });
  const base = commit();
  const output = join(cwd, ".git", "outputs");
  const select = (
    head: string,
    baseSha = head + "^1",
    event = "pull_request",
    admit = true,
  ) => {
    writeFileSync(output, "");
    execFileSync(
      "bun",
      [resolve("enablement/ci/select.ts"), ...(admit ? ["--admit"] : [])],
      {
        cwd,
        env: {
          ...clean,
          BASE_SHA: baseSha,
          GITHUB_SHA: head,
          GITHUB_EVENT_NAME: event,
          GITHUB_OUTPUT: output,
        },
        stdio: "pipe",
      },
    );
    return Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
  };
  const steps = (outputs: Record<string, string>, result = "success") => {
    const needs = { select: { result, outputs } };
    const env = Object.fromEntries(
      Object.entries(jobs.contracts.env).map(([name, expression]) => [
        name,
        String(evaluate(String(expression).slice(3, -2), { needs })),
      ]),
    );
    return jobs.contracts.steps.filter(
      (step: { if?: string }) => !step.if || evaluate(step.if, { env }),
    );
  };
  const commands = (outputs: Record<string, string>, result?: string) =>
    steps(outputs, result).flatMap((step: { name?: string }) =>
      step.name?.startsWith("Verify") || step.name?.startsWith("Validate")
        ? [step.name]
        : [],
    );

  const checks = {
    release: "Verify paired release contracts",
    theme: "Verify shared theme",
    engineering: "Verify push guards, selection and publication admission",
    tooling: "Verify the shared selected tooling suite",
    workflow: "Validate workflow syntax and job dependencies",
  };
  const all = Object.values(checks);
  for (const [paths, expected] of [
    [[native], []],
    [[theme], [checks.theme]],
    [[verifier], [checks.release, checks.engineering]],
    [[release], [checks.release]],
    [
      [workflow],
      [checks.release, checks.engineering, checks.tooling, checks.workflow],
    ],
    [
      [native, theme, release],
      [checks.release, checks.theme],
    ],
  ] as const) {
    git("reset", "--hard", base);
    for (const path of paths)
      appendFileSync(join(cwd, path), "a { color: red; }\n");
    const head = commit();
    const outputs = select(head);
    assert.deepEqual(commands(outputs), expected, paths.join(","));
    assert.deepEqual(
      commands(select(head, base, "push")),
      expected,
      paths.join(","),
    );
    assert.deepEqual(commands(select(head, base, "workflow_dispatch")), all);
    if (paths[0] === native && paths.length === 1) {
      assert.equal(outputs.platform, "true");
      assert.equal(outputs.installer, "true");
      assert.deepEqual(
        steps(outputs).map((step: { name: string }) => step.name),
        ["Record selected contracts"],
      );
      assert.ok(!jobs.linux.needs.includes("contracts"));
    }
    if (paths[0] === theme) {
      const step = steps(outputs).find(
        (step: { name: string }) => step.name === checks.theme,
      );
      const checker = spawnSync("sh", ["-c", step.run], {
        cwd,
        encoding: "utf8",
      });
      assert.equal(checker.status, 1, checker.stderr);
      assert.match(checker.stderr, /named:red/);

      const needs = Object.fromEntries(
        jobs["linux-admission"].needs.map((name: string) => [
          name,
          { result: "success" },
        ]),
      );
      const plan = JSON.parse(outputs.plan);
      const admit = () =>
        spawnSync(
          "node",
          [
            "--experimental-strip-types",
            "enablement/ci/routing/evidence.ts",
            "--admit",
          ],
          {
            cwd: root,
            env: {
              ...clean,
              VERIFY_PLATFORM: "linux",
              VERIFICATION_PLAN: JSON.stringify(plan),
              MAC_VERIFICATION_PLAN: outputs.mac_plan,
              CI_NEEDS: JSON.stringify(needs),
              CI_REUSE: "{}",
            },
            encoding: "utf8",
          },
        ).status;
      assert.equal(admit(), 0);
      needs.contracts.result = "failure";
      assert.equal(admit(), 1);
      const github = {
        event_name: "pull_request",
        event: { pull_request: { draft: false } },
      };
      assert.equal(
        evaluate(jobs["tree-evidence"].if, {
          needs,
          github,
          always: () => true,
          cancelled: () => false,
        }),
        false,
      );
    }
  }
  assert.deepEqual(commands(select(base, base, "push", false)), all);
  assert.deepEqual(commands(select(base, "missing", "push", false)), all);
  assert.deepEqual(commands({}, "failure"), all);
  assert.deepEqual(commands({}, "success"), all);
  git("reset", "--hard", base);
  rmSync(join(cwd, native));
  symlinkSync("elsewhere", join(cwd, native));
  assert.deepEqual(commands(select(commit(), base, "push", false)), all);
});

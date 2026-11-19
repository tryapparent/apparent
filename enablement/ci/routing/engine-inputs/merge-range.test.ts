import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { YAML } from "bun";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const expression =
  "${{ github.event_name == 'pull_request' && format('{0}^1', github.sha) || github.event.before }}";
const workflows = [
  "checks",
  "stream-engine",
  "stream-connect",
  "stream-public",
  "hermes",
];
const evaluate = (source: string, github: object) =>
  Function(
    "github",
    "format",
    `return (${source.slice(3, -2)});`,
  )(github, (pattern: string, value: string) => pattern.replace("{0}", value));

test("the selected hosted range callers compares the checked PR merge with its first parent; pushes retain the complete delta", () => {
  for (const name of workflows) {
    let callers = 0;
    const workflow = YAML.parse(
      readFileSync(join(root, `.github/workflows/${name}.yml`), "utf8"),
    );
    for (const job of Object.values(workflow.jobs) as {
      steps?: { env?: { BASE_SHA?: string }; name?: string; id?: string }[];
    }[])
      for (const step of job.steps ?? []) {
        if (!step.env?.BASE_SHA) continue;
        callers++;
        assert.equal(
          step.env.BASE_SHA,
          expression,
          `${name}: ${step.name ?? step.id}`,
        );
        assert.equal(
          evaluate(step.env.BASE_SHA, {
            event_name: "pull_request",
            sha: "merge",
            event: { pull_request: { base: { sha: "stale" } } },
          }),
          "merge^1",
        );
        assert.equal(
          evaluate(step.env.BASE_SHA, {
            event_name: "push",
            sha: "head",
            event: { before: "before" },
          }),
          "before",
        );
      }
    assert.equal(callers, 1, name);
  }
});

test("real selector CLIs exclude intervening main routing edits but retain PR mixed, unknown, deleted, renamed and typechanged inputs", () => {
  const cwd = mkdtempSync(join(tmpdir(), "apparent-dev-merge-range-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  try {
    execFileSync(
      "git",
      ["clone", "--shared", "--no-checkout", "--quiet", root, cwd],
      { env },
    );
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    const original = git("rev-parse", "HEAD");
    const blob = (text: string) =>
      execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd,
        env,
        input: text,
        encoding: "utf8",
      }).trim();
    const change = (path: string, text: string, mode = "100644") =>
      git("update-index", "--add", "--cacheinfo", mode, blob(text), path);
    const commit = (parents: string[]) =>
      git(
        "commit-tree",
        git("write-tree"),
        ...parents.flatMap((p) => ["-p", p]),
        "-m",
        "committed range fixture",
      );
    git("read-tree", original);
    change(
      "enablement/ci/routing/consumers.ts",
      git("show", original + ":enablement/ci/routing/consumers.ts") +
        "\n// unrelated main advance\n",
    );
    const main = commit([original]);
    const cli = (
      base: string,
      head: string,
      entry = "enablement/ci/select.ts",
      args: string[] = [],
    ) => {
      const output = join(cwd, "output");
      writeFileSync(output, "");
      const stdout = execFileSync("bun", [join(root, entry), ...args], {
        cwd,
        env: {
          ...env,
          BASE_SHA: base,
          GITHUB_SHA: head,
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_OUTPUT: output,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return entry === "enablement/ci/select.ts"
        ? JSON.parse(stdout)
        : readFileSync(output, "utf8");
    };
    for (const kind of [
      "bounded",
      "renderer",
      "mixed",
      "unknown",
      "delete",
      "rename",
      "typechange",
    ]) {
      git("read-tree", original);
      change(
        "public/site/src/range-fixture.ts",
        "export const fixture = true;\n",
      );
      if (kind === "renderer")
        change(
          "capture/desktop/ui/frontend/src/style.css",
          git("show", original + ":capture/desktop/ui/frontend/src/style.css") +
            "\n/* synthetic renderer edit */\n",
        );
      if (kind === "mixed")
        change(
          "engine/sdk/src/range-fixture.ts",
          "export const fixture = true;\n",
        );
      if (kind === "unknown")
        change("unowned/range-fixture.ts", "export {};\n");
      if (kind === "delete" || kind === "rename") {
        git("update-index", "--force-remove", "engine/sdk/src/index.ts");
        if (kind === "rename")
          change(
            "engine/sdk/src/moved.ts",
            git("show", original + ":engine/sdk/src/index.ts"),
          );
      }
      if (kind === "typechange")
        change("engine/sdk/src/index.ts", "target", "120000");
      const pr = commit([original]);
      git(
        "update-index",
        "--cacheinfo",
        "100644",
        git("rev-parse", main + ":enablement/ci/routing/consumers.ts"),
        "enablement/ci/routing/consumers.ts",
      );
      const merge = commit([main, pr]);
      const base = evaluate(expression, {
        event_name: "pull_request",
        sha: merge,
        event: { pull_request: { base: { sha: original } } },
      });
      const before = cli(original, merge),
        after = cli(base, merge);
      assert.equal(before.plan.root, true, kind);
      assert.equal(
        after.plan.engineMedia,
        ["mixed", "delete", "rename", "typechange"].includes(kind),
        JSON.stringify({
          kind,
          base,
          paths: after.paths,
          reasons: after.reasons,
        }),
      );
      assert.equal(after.plan.public, true, kind);
      const engine = cli(original, merge, "engine/enablement/ci/run.ts", [
        "select",
      ]);
      assert.match(
        engine,
        new RegExp(
          "^selected=" +
            ["mixed", "delete", "rename", "typechange"].includes(kind) +
            "\n",
        ),
        kind,
      );
      assert.match(
        engine,
        /runners=\["ubuntu-24.04","ubuntu-24.04-arm"\]/,
        kind,
      );
      if (kind === "renderer") {
        assert.equal(
          after.mac_rust,
          false,
          "resolved merge-parent range retains renderer-only Mac Rust exemption",
        );
        assert.equal(after.macos, true);
        assert.equal(after.mac_plan.root, false);
        assert.equal(after.mac_plan.desktop, true);
      }
      if (kind === "bounded") {
        assert.deepEqual(after.paths, ["public/site/src/range-fixture.ts"]);
        assert.equal(after.platform, false);
        assert.equal(after.requiredStreams.engine, false);
        assert.equal(after.publicationStreams.engine, false);
        assert.match(
          cli(base, merge, "connect/enablement/ci/select.ts"),
          /native=false/,
        );
      }
    }
    const missing = cli("missing", original);
    assert.equal(missing.historyKnown, false);
    assert.equal(missing.plan.root, true);
    assert.equal(missing.plan.engineMedia, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

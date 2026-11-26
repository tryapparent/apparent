import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { YAML } from "bun";
import { affectsStream, routeDecision, selectedOwners } from "../consumers.ts";
import { commands as localCommands } from "../../../local-tests/run.ts";

type Workflow = {
  on: Record<string, { paths?: string[]; types?: string[] }>;
  permissions: { contents?: string };
  jobs: Record<
    string,
    {
      "runs-on"?: string;
      steps?: { uses?: string; run?: string; with?: Record<string, unknown> }[];
    }
  >;
};

const root = new URL("../../../../", import.meta.url);
const workflow = (name: string) =>
  YAML.parse(
    readFileSync(new URL(`.github/workflows/${name}`, root), "utf8"),
  ) as Workflow;
const ci = () => workflow("checks.yml");

test("stream triggers and PR checkout", () => {
  assert.deepEqual(
    readdirSync(new URL(".github/workflows/", root))
      .filter((name) =>
        Object.keys(workflow(name).on).some(
          (event) => !/^workflow_(dispatch|call)$/.test(event),
        ),
      )
      .sort(),
    "architecture.yml branch-cleanup.yml checks.yml hermes.yml stream-agent.yml stream-connect.yml stream-engine.yml stream-handoff.yml stream-onboarding.yml stream-public.yml stream-record.yml".split(
      " ",
    ),
  );
  assert.deepEqual(Object.keys(workflow("stream-connect.yml").on), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  const { jobs, on, permissions } = ci();
  assert.equal(jobs.connect, undefined);
  assert.equal(jobs["native-evidence"], undefined);
  assert.deepEqual(Object.keys(on), [
    "workflow_dispatch",
    "pull_request",
    "push",
  ]);
  assert.deepEqual(on.pull_request.types, [
    "opened",
    "reopened",
    "synchronize",
    "ready_for_review",
    "converted_to_draft",
  ]);
  assert.equal(permissions.contents, "read");
  assert.deepEqual(Object.keys(workflow("verification.yml").on), [
    "workflow_dispatch",
  ]);
  for (const job of Object.values(ci().jobs))
    for (const step of job.steps ?? []) {
      if (step.uses === "actions/checkout@v4") {
        assert.equal(step.with?.ref, undefined);
        assert.equal(step.with?.["persist-credentials"], false);
      }
    }
});
test("architecture admission runs for every main PR and push on checkout history", () => {
  const architecture = workflow("architecture.yml");
  assert.deepEqual(architecture.on, {
    pull_request: { branches: ["main"] },
    push: { branches: ["main"] },
  });
  assert.deepEqual(architecture.permissions, { contents: "read" });
  const steps = architecture.jobs.architecture.steps ?? [];
  assert.deepEqual(steps[0], {
    uses: "actions/checkout@v4",
    with: { "fetch-depth": 0, "persist-credentials": false },
  });
  const entrypoint =
    "shared/enablement/dependency-policy/guards/architecture.ts";
  assert.ok(
    steps.some((step) => step.run?.endsWith(entrypoint + " HEAD^1 HEAD")),
  );
  assert.ok(
    steps.some((step) =>
      step.run?.endsWith(entrypoint + ' "$PREVIOUS_MAIN" HEAD'),
    ),
  );
});
test("closed PR cleanup runs its mutation only from the trusted repository checkout", () => {
  const cleanup = workflow("branch-cleanup.yml");
  assert.deepEqual(cleanup.on, { pull_request_target: { types: ["closed"] } });
  assert.deepEqual(cleanup.permissions, {});
  const checkout = cleanup.jobs.cleanup.steps?.[0];
  assert.equal(checkout?.uses, "actions/checkout@v4");
  assert.deepEqual(checkout?.with, {
    ref: "refs/heads/${{ github.event.repository.default_branch }}",
    "persist-credentials": false,
  });
  for (const path of [
    ".github/workflows/branch-cleanup.yml",
    "enablement/ci/branch-cleanup/closed-pr.ts",
    "enablement/ci/branch-cleanup/closed-pr.test.ts",
  ]) {
    const decision = routeDecision([path]);
    assert.deepEqual(decision.selected, ["tooling"], path);
    assert.equal(decision.updater, false, path);
    assert.ok(
      Object.values(decision.publicationStreams).every((enabled) => !enabled),
      path,
    );
  }
});
test("Desktop commands build Record capture requests before staging them", () => {
  const { scripts } = JSON.parse(
    readFileSync(
      new URL("capture/desktop/ui/frontend/package.json", root),
      "utf8",
    ),
  );
  const build =
    "node --experimental-strip-types ../../../../record/enablement/ci/capture-request/build.ts";
  const stage =
    "node --experimental-strip-types scripts/capture-request/stage.ts";
  for (const script of ["build", "build:prepare", "test"])
    assert.ok(scripts[script].includes(`${build} && ${stage}`), script);
});

test("Record Bend runs on Linux and shares affected inputs with pre-push", () => {
  const record = workflow("stream-record.yml");
  const paths = [
    "record/completion/**",
    "record/capture-request/**",
    "record/media/src/assembly/crop-publication*",
    "record/media/src/assembly/action-context.bend",
    "record/media/src/assembly/focused-mark.bend",
    "record/media/src/circle/circle-label.bend",
    "record/pill/**",
    "record/shortcuts/push-to-talk.bend",
    "record/enablement/ci/pill/**",
    "record/enablement/ci/bend/**",
    "record/enablement/ci/capture-request/build.ts",
    "shared/enablement/bend/**",
    "shared/enablement/ci/record-inputs.ts",
    "record/enablement/verification.json",
    "record/enablement/performance/fixtures/host-accounting.test.ts",
    "record/enablement/performance/fixtures/smt-subset.test.ts",
    "record/enablement/performance/local/stop-timeline.test.ts",
    "record/enablement/performance/native/start-spans.test.ts",
    "record/enablement/performance/score/compare.test.ts",
    "record/enablement/ci/performance/verify.ts",
    "record/enablement/ci/performance/verify.test.ts",
    "record/enablement/ci/settings/verify.ts",
    "record/enablement/settings/package.json",
    "record/enablement/settings/recording-fixture.ts",
    "record/enablement/settings/recording-fixture.test.ts",
    ".github/workflows/stream-record.yml",
  ];
  assert.deepEqual(record.on.pull_request.paths, paths);
  assert.deepEqual(record.on.push.paths, paths);
  const command = "record/enablement/ci/bend/check.ts";
  assert.equal(record.jobs.bend["runs-on"], "ubuntu-24.04");
  assert.ok(
    record.jobs.bend.steps?.some(
      (step) => step.run === "node " + command + " --proof",
    ),
  );
  const check = (path: string, local = true, entry = command) =>
    localCommands(selectedOwners([path]), "base", "head", "linux", false, {
      paths: [path],
      local,
    }).some(({ argv }) => argv.includes(entry));
  for (const path of [
    "record/completion/src/copy-admission.bend",
    "record/completion/src/policy.ts",
    "record/media/src/assembly/crop-publication.bend",
    "record/media/src/assembly/crop-publication-request.ts",
    "record/media/src/assembly/action-context.bend",
    "record/media/src/assembly/focused-mark.bend",
    "record/media/src/circle/circle-label.bend",
    "record/capture-request/src/capture-admission.bend",
    "record/enablement/ci/bend/capture-request/capture-admission.ts",
    "record/enablement/ci/capture-request/build.ts",
    "record/enablement/ci/bend/build.ts",
    "shared/enablement/bend/toolchain.ts",
    ".github/workflows/stream-record.yml",
  ]) {
    assert.equal(check(path), true, path);
    assert.equal(check(path, false), false, path);
  }
  for (const path of [
    "record/completion/src/copy-admission.bend",
    "record/enablement/ci/bend/build.ts",
    "shared/enablement/bend/toolchain.ts",
  ]) {
    const route = routeDecision([path]);
    assert.equal(route.installer, true, path);
    assert.deepEqual(
      route.selected,
      path.startsWith("shared/")
        ? ["capture", "desktop", "service", "onboarding"]
        : ["capture", "desktop", "onboarding"],
      path,
    );
  }
  for (const path of [
    "record/capture-request/src/capture-admission.bend",
    "record/enablement/ci/bend/capture-request/capture-admission.ts",
  ]) {
    const route = routeDecision([path]);
    assert.equal(route.installer, true, path);
    assert.deepEqual(route.selected, ["capture", "desktop"], path);
  }
  assert.equal(
    routeDecision(["record/enablement/ci/bend/check.ts"]).installer,
    false,
  );
  assert.equal(check("connect/service/src/example.ts"), false);
  assert.equal(check(".github/workflows/stream-agent.yml"), false);
  for (const [owner, path] of [
    ["handoff", "handoff/pure/transcript-only.bend"],
    ["connect", "connect/client/typescript/src/reader/reader-route.bend"],
    ["connect", "connect/client/typescript/src/account/account-status.bend"],
  ]) {
    assert.equal(
      check(path, true, owner + "/enablement/ci/bend/check.ts"),
      true,
      path,
    );
    const route = routeDecision([path]);
    assert.equal(route.plan.desktop, true, path);
    assert.equal(route.installer, true, path);
  }
  const connect = "connect/enablement/ci/bend/check.ts";
  for (const path of [
    "connect/service/src/reporting/activity-preference.bend",
    "connect/service/src/reporting/product-activity.ts",
    "connect/tooling/hosting/package.json",
    "connect/enablement/ci/bend/modules.json",
    "shared/enablement/bend/toolchain.ts",
  ])
    assert.equal(check(path, true, connect), true, path);
  assert.equal(
    check("record/completion/src/copy-admission.bend", true, connect),
    false,
  );
  assert.equal(check("connect/web/package.json", true, connect), false);
  assert.equal(check("public/site/package.json", true, connect), false);
  assert.equal(
    routeDecision(["shared/enablement/bend/toolchain.ts"]).publicationStreams
      .connect,
    true,
  );
  assert.equal(routeDecision([connect]).publicationStreams.connect, false);
});

test("Record-only verification keeps installed and mixed inputs on Desktop CI", () => {
  const fixtures = [
    "record/enablement/verification.json",
    "record/enablement/settings/recording-fixture.ts",
    "record/capture-request/test/lifecycle.test.ts",
  ];
  const generator =
    "record/enablement/ci/bend/performance/recording-performance.ts";
  for (const fixture of fixtures) {
    for (const event of ["pull_request", "push"])
      assert.ok(ci().on[event].paths?.includes("!" + fixture));
    assert.equal(affectsStream("capture", fixture), false);
    assert.equal(routeDecision([fixture]).installer, false);
    assert.equal(routeDecision([fixture, generator]).installer, true);
  }
  assert.equal(routeDecision([generator]).installer, true);
  assert.equal(
    routeDecision(["record/enablement/ci/capture-request/build.ts"]).installer,
    true,
  );
});

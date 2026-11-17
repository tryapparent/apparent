import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const routing = new URL(
  "../../../../../enablement/ci/routing/consumers.ts",
  import.meta.url,
).href;
test("actual CI selector isolates Public workflow edits and retains real Shared UI consumers", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `
    import {routeDecision} from ${JSON.stringify(routing)};
    console.log(JSON.stringify([
      routeDecision(['.github/workflows/stream-public.yml']).plan,
      routeDecision(['shared/ui/src/button.tsx']).plan,
      routeDecision(['.github/workflows/checks.yml']).plan
    ]));
  `,
    ],
    { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "" } },
  );
  assert.equal(result.status, 0, result.stderr);
  const [publicPlan, sharedPlan, coordinatorPlan] = JSON.parse(result.stdout);
  assert.equal(publicPlan.public, true);
  for (const name of ["root", "engine", "desktop", "client", "tools"])
    assert.equal(publicPlan[name], false);
  for (const name of ["public", "browser", "desktop", "root"])
    assert.equal(sharedPlan[name], true);
  for (const name of ["browser", "desktop", "root", "tooling"])
    assert.equal(coordinatorPlan[name], true);
});

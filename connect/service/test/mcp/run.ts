import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clientPackage } from "../../../enablement/ci/build-client.ts";
import { withClientFixture } from "./client-fixture.ts";

await withClientFixture(clientPackage, async (client) => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      fileURLToPath(new URL("client-imports.ts", import.meta.url)),
      "--test",
      "--test-concurrency=1",
      fileURLToPath(new URL("endpoint.integration.ts", import.meta.url)),
    ],
    {
      env: { ...process.env, CONNECT_MCP_FIXTURE: client.href },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.signal)
    throw new Error(`MCP endpoint tests terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
});

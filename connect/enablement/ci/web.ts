import { createServer, type AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";

const evidence =
  process.env.CONNECT_EVIDENCE ||
  mkdtempSync("/tmp/apparent-dev-connect-browser-");
const socket = createServer();
await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(socket.address() as AddressInfo).port}/connect`;
await new Promise<void>((done) => socket.close(() => done()));
function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, CONNECT_EVIDENCE: evidence, ...env },
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error || result.status}`,
    );
}
run("npm", ["run", "build"], {
  VITE_HOSTED_API_ORIGIN: origin,
  CONNECT_BUILD_DIR: "dist-test",
  PUBLIC_POSTHOG_ENABLED: "false",
});
run("node", ["test/browser.mjs"], {
  VITE_HOSTED_API_ORIGIN: origin,
  HOSTED_TEST_API_ORIGIN: origin,
  CONNECT_ARTIFACT: "dist-test",
});
run("node", ["test/analytics-consent.browser.ts"], {
  HOSTED_TEST_API_ORIGIN: origin,
  CONNECT_ARTIFACT: "dist-test",
});

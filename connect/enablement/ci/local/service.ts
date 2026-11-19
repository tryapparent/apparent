export const serviceInputs = [
  "connect/service",
  "connect/enablement/ci/bend/build.ts",
  "connect/enablement/ci/bend/modules.json",
  "connect/enablement/ci/build-client.ts",
  "shared/enablement/bend",
  "connect/client/typescript",
  "shared/ui",
  "shared/assets",
];
export const serviceTree =
  "1066fd88ba12e20955c22d1b1c6e40869bf362be78c4793c91be8e9a43a488ce";
export const serviceTest =
  "npm run build && node --experimental-strip-types --test --test-concurrency=1 test/*/*.test.mjs test/*/*.test.ts";
export const serviceCommands = [
  { argv: ["npm", "ci", "--no-audit", "--no-fund"], cwd: "connect/service" },
  { argv: ["npm", "test"], cwd: "connect/service" },
  { argv: ["npm", "run", "test:mcp"], cwd: "connect/service" },
  { argv: ["npm", "run", "test:recipient"], cwd: "connect/service" },
];

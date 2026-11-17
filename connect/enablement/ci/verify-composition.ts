import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp)
  throw Error("RUNNER_TEMP is required for composition verification");
const publicSite = "public/site";
const service = "connect/service";
const web = "connect/web";
const publicInput = resolve(runnerTemp, "public-artifact");
const productionOrigin = "https://hosted.tryapparent.com";
const publicEnv = {
  APPARENT_PUBLIC_SITE: "1",
  VITE_HOSTED_API_ORIGIN: productionOrigin,
};

function run(
  cwd: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
) {
  console.log(`[${cwd}] ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: resolve(root, cwd),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      `${command} failed in ${cwd}: ${result.signal ?? result.status}`,
    );
}

run(service, "npm", ["ci", "--no-audit", "--no-fund"]);
run(service, "node", ["scripts/stage-migrations.ts"]);
run(service, "npm", ["run", "build:recipient"]);
run(web, "bun", ["install", "--frozen-lockfile"]);
run(web, "npm", ["run", "build"], { VITE_HOSTED_API_ORIGIN: productionOrigin });
run(publicSite, "npm", ["run", "build"], publicEnv);
run(
  publicSite,
  "node",
  ["../enablement/site-build/package-apparent.mjs"],
  publicEnv,
);
cpSync(resolve(root, publicSite, "dist-apparent"), publicInput, {
  recursive: true,
});
run(
  publicSite,
  "node",
  ["../enablement/connect/compose-connect.mjs"],
  publicEnv,
);
run(publicSite, "node", [
  "--test",
  "../enablement/connect/test-compose-connect.mjs",
  "../enablement/pages/test-pages-package.ts",
]);
run(publicSite, "node", ["../enablement/pages/prepare-pages.mjs"]);
run(publicSite, "node", ["../enablement/site-build/verify-composed.mjs"], {
  COMPOSE_PUBLIC_INPUT: publicInput,
});
run(publicSite, "node", ["../../shared/ui/test/appearance.mjs"], {
  PUBLIC_THEME_ARTIFACT: "public/site/dist-apparent",
  THEME_SURFACES: "connect,recipient",
});
run(publicSite, "npm", ["run", "build:pages-worker"]);
run(
  publicSite,
  "node",
  ["--test", "../enablement/pages/test-pages-video-runtime.ts"],
  { PAGES_WORKER: "dist-apparent/_worker.js" },
);
run(publicSite, "node", ["../enablement/pages/prepare-pages-video.mjs"]);
run(
  publicSite,
  "node",
  ["--test", "../enablement/pages/test-public-homepage.ts"],
  { SITE_ARTIFACT: "dist-apparent" },
);

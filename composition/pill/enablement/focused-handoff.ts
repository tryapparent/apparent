import { cp, mkdtemp, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runFocused } from "../../../handoff/enablement/performance/run.ts";

function packages(frontend: string) {
  return createRequire(join(frontend, "package.json"));
}

await runFocused(
  {
    forBuild(frontend) {
      const require = packages(frontend);
      const { _electron: electron, expect } = require("@playwright/test");
      const { wsServer: sockets } = require("playwright-core/lib/utilsBundle");
      return { executablePath: require("electron"), electron, expect, sockets };
    },
    async buildProbes(root, outfile) {
      const require = packages(join(root, "capture/desktop/ui/frontend"));
      const scratch = await mkdtemp(join(dirname(outfile), "probe-source-"));
      try {
        const probe = new URL(
          "../../../handoff/enablement/performance/probes.ts",
          import.meta.url,
        );
        const probeSource = join(scratch, "probes.ts");
        await cp(probe, probeSource);
        await require("esbuild").build({
          entryPoints: [join(root, "composition/handoff/main/entry.ts")],
          inject: [probeSource],
          outfile,
          bundle: true,
          external: ["electron"],
          platform: "node",
          format: "cjs",
          target: "node22",
          plugins: [
            {
              name: "prepared-handoff-probe",
              setup(build: { onResolve: Function }) {
                build.onResolve(
                  { filter: /^\.\.\/\.\.\/main\// },
                  (args: { importer: string; path: string }) => {
                    if (args.importer === probeSource)
                      return {
                        path: join(
                          root,
                          "handoff",
                          args.path.slice("../../".length),
                        ),
                      };
                  },
                );
              },
            },
          ],
        });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  },
  process.argv.slice(2),
);

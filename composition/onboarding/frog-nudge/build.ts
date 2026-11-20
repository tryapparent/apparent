import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { build as esbuild } from "esbuild";

const owner = fileURLToPath(
  new URL("../../../onboarding/renderer/frog-nudge/", import.meta.url),
);
const host = fileURLToPath(new URL("./entry.ts", import.meta.url));

export async function buildFrogNudge(build: typeof esbuild) {
  const outdir = fileURLToPath(new URL("../dist/frog-nudge/", import.meta.url));
  await Promise.all([
    build({
      entryPoints: [host],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      outfile: resolve(outdir, "entry.cjs"),
    }),
    build({
      entryPoints: [resolve(owner, "overlay.tsx")],
      bundle: true,
      nodePaths: [
        fileURLToPath(
          new URL(
            "../../../capture/desktop/ui/frontend/node_modules/",
            import.meta.url,
          ),
        ),
      ],
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: resolve(outdir, "overlay.js"),
    }),
  ]);
  for (const asset of ["index.html", "overlay.css", "wave.webp"])
    cpSync(resolve(owner, asset), resolve(outdir, asset));
}

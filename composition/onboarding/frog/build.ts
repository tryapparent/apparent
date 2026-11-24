import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { build as esbuild } from "esbuild";

const path = (part: string) => fileURLToPath(new URL(part, import.meta.url));

export async function buildDesktopFrog(build: typeof esbuild) {
  const owner = path("../../../onboarding/renderer/frog/");
  const outdir = path("../dist/desktop-frog/");
  await Promise.all([
    build({
      entryPoints: [path("./preload.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      outfile: resolve(outdir, "preload.cjs"),
    }),
    build({
      entryPoints: [resolve(owner, "desktop.tsx")],
      bundle: true,
      nodePaths: [path("../../../capture/desktop/ui/frontend/node_modules/")],
      loader: { ".png": "file" },
      jsx: "automatic",
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: resolve(outdir, "desktop.js"),
    }),
  ]);
  for (const asset of ["desktop.html", "desktop.css"])
    cpSync(resolve(owner, asset), resolve(outdir, asset));
  cpSync(
    path("../../../shared/assets/fonts/HostGrotesk-Variable.ttf"),
    resolve(outdir, "host-grotesk.ttf"),
  );
}

import { build } from "esbuild";
import { buildFrogNudge } from "./frog-nudge/build.ts";
import { fileURLToPath } from "node:url";
await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/entry.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  outfile: "dist/entry.cjs",
});
await buildFrogNudge(build);

import { createRequire } from "node:module";
import { cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL(".", import.meta.url));

export async function buildWhiteboard(dependencies: string, output: string) {
  const { build } = createRequire(join(dependencies, "package.json"))(
    "esbuild",
  );
  const outdir = resolve(output);
  await Promise.all([
    build({
      entryPoints: [join(source, "main.ts"), join(source, "preload.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      outdir,
      outExtension: { ".js": ".cjs" },
    }),
    build({
      entryPoints: [join(source, "view.tsx")],
      bundle: true,
      jsx: "automatic",
      minify: true,
      outdir,
      nodePaths: [join(dependencies, "node_modules")],
      loader: { ".ttf": "file", ".png": "file" },
      define: { "process.env.NODE_ENV": '"production"' },
    }),
  ]);
  await cp(join(source, "index.html"), join(outdir, "index.html"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dependencies, output] = process.argv.slice(2);
  if (!dependencies || !output)
    throw Error("Expected Whiteboard dependency and output directories");
  await buildWhiteboard(resolve(dependencies), output);
}

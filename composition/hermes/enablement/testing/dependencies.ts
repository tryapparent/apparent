import { createRequire } from "node:module";
import path from "node:path";

export const frontend = path.resolve(
  import.meta.dirname,
  "../../../../capture/desktop/ui/frontend",
);
const load = createRequire(path.join(frontend, "package.json"));
export const { _electron: electron } = load(
  "@playwright/test",
) as typeof import("@playwright/test");
export const { build } = load("esbuild") as typeof import("esbuild");

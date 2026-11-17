import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    fileURLToPath(
      new URL(
        "../../../../composition/enablement/release/mac/publication/version.ts",
        import.meta.url,
      ),
    ),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    fileURLToPath(
      new URL(
        "../../../../composition/enablement/release/mac/publication/version.test.ts",
        import.meta.url,
      ),
    ),
  ],
  { stdio: "inherit" },
);

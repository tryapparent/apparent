import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../sdk/", import.meta.url));
const output = mkdtempSync("/tmp/apparent-dev-engine-sdk-test-");
try {
  writeFileSync(
    join(output, "package.json"),
    '{"private":true,"type":"module"}',
  );
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      join(root, "tsconfig.json"),
      "--outDir",
      join(output, "dist"),
    ],
    { stdio: "inherit" },
  );
  cpSync(join(root, "test"), join(output, "test"), { recursive: true });
  const tests = readdirSync(join(output, "test"))
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => join(output, "test", file));
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--test", ...tests],
    { stdio: "inherit" },
  );
} finally {
  rmSync(output, { recursive: true, force: true });
}
